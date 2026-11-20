"""Oracle access: one connection pool per profile, reads only.

python-oracledb runs in thin mode here, which is pure Python and needs no
Oracle Instant Client. That keeps the image small and the build boring. Thick
mode is only required for things this server does not do (Oracle Wallet /
mTLS, Advanced Queuing); switching to it means installing the client libraries
and calling ``oracledb.init_oracle_client()`` before the first connect.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal
from typing import Any

import oracledb

from .config import Profile

logger = logging.getLogger(__name__)

#: Rows are fetched in batches no larger than this so that a query matching
#: millions of rows does not materialise them before the row cap applies.
_FETCH_BATCH = 200


class QueryFailed(Exception):
    """The database refused or could not finish the statement.

    Carries a message meant for the model. Oracle's own text is included
    because it is usually the most useful thing available ("table or view does
    not exist" tells the model to call describe first), but see
    :func:`_safe_oracle_message` for what is withheld.
    """


@dataclass(frozen=True)
class QueryResult:
    columns: list[str]
    rows: list[list[Any]]
    truncated: bool
    row_cap: int


#: What a caller is told when the failure is on our side of the query. Kept as
#: one constant so the connect path and the ORA- families below cannot drift
#: into saying different things about the same condition.
_CONNECTION_FAILED = (
    "The database could not be reached or the connection was rejected. This is "
    "a server configuration problem, not a problem with the query."
)


def _safe_oracle_message(exc: oracledb.Error) -> str:
    """Render a driver error for the model without leaking connection details.

    Oracle's connection-phase errors quote the DSN, and some include the
    account name. Those reach the model, which may put them in a reply, so the
    text is replaced with something actionable and the original is logged
    instead. Statement-phase errors (bad column, missing object) are passed
    through: they describe the query, which the model wrote.
    """
    error = exc.args[0] if exc.args else None
    code = getattr(error, "code", None)
    message = getattr(error, "message", str(exc)).strip()

    # ORA-12xxx is the listener/network family; ORA-01017 is bad credentials.
    if code in {1017} or (code is not None and 12000 <= code < 13000):
        return _CONNECTION_FAILED
    return message


def _to_jsonable(value: Any) -> Any:
    """Convert an Oracle value into something JSON can carry.

    Dates become ISO strings and numbers become floats or ints, because the
    consumer is a language model reading JSON, not a program doing arithmetic.
    A Decimal is rendered as int when it is integral so that a count does not
    arrive as ``42.0``.
    """
    if isinstance(value, Decimal):
        return int(value) if value == value.to_integral_value() else float(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, bytes):
        # A LOB or RAW column. The content is not useful to the model and may
        # be large, so it is described rather than sent.
        return f"<{len(value)} bytes>"
    return value


class OraclePools:
    """Lazily created connection pools, one per profile."""

    def __init__(self) -> None:
        self._pools: dict[str, oracledb.AsyncConnectionPool] = {}

    async def _pool_for(self, profile: Profile) -> oracledb.AsyncConnectionPool:
        pool = self._pools.get(profile.name)
        if pool is not None:
            return pool
        try:
            pool = oracledb.create_pool_async(
                user=profile.user,
                password=profile.password,
                dsn=profile.dsn,
                min=1,
                max=4,
                increment=1,
            )
        except Exception as exc:
            # Deliberately broader than oracledb.Error. A DSN that does not
            # resolve raises socket.gaierror, and a TLS failure raises an ssl
            # error -- neither is an oracledb.Error, so a narrow except let
            # them propagate verbatim to the model, quoting the internal
            # hostname. Everything reaching this point is an infrastructure
            # fault the caller can do nothing about, so all of it is logged in
            # full here and reported generically.
            logger.error(
                "Could not create a pool for %s: %r", profile, exc, exc_info=True
            )
            raise QueryFailed(_CONNECTION_FAILED) from exc
        self._pools[profile.name] = pool
        logger.info("Opened a connection pool for %s", profile)
        return pool

    async def close(self) -> None:
        for name, pool in self._pools.items():
            try:
                await pool.close(force=True)
            except oracledb.Error as exc:  # pragma: no cover - shutdown path
                logger.warning("Error closing the pool for profile %r: %s", name, exc)
        self._pools.clear()

    async def fetch_with_binds(
        self, profile: Profile, sql: str, binds: dict[str, Any]
    ) -> QueryResult:
        """Run one of this server's own parameterised statements.

        Separate from :meth:`fetch` because the SQL here is written in this
        repository and carries bind values, so it does not go through the
        guard -- the guard exists to judge statements the model wrote, and
        sqlglot would have to be taught about bind placeholders to parse these.
        Nothing from a caller is ever interpolated into these statements.
        """
        return await self._run(profile, sql, binds)

    async def fetch(self, profile: Profile, sql: str) -> QueryResult:
        """Run one checked SELECT and return at most ``profile.row_cap`` rows.

        The cap is applied by stopping the fetch, not by rewriting the SQL into
        a ``FETCH FIRST n ROWS ONLY``. Rewriting changes the statement the
        operator sees in the audit log and in ``V$SQL``, and silently changes
        the meaning of a query that already carries its own row limiting.
        """
        return await self._run(profile, sql, None)

    async def _run(
        self, profile: Profile, sql: str, binds: dict[str, Any] | None
    ) -> QueryResult:
        pool = await self._pool_for(profile)
        try:
            async with pool.acquire() as connection:
                # Milliseconds. Guards against a statement that Oracle's own
                # resource profile would eventually kill, but not quickly.
                connection.call_timeout = profile.call_timeout_s * 1000
                with connection.cursor() as cursor:
                    cursor.arraysize = _FETCH_BATCH
                    # Redundant next to a SELECT-only grant, and kept anyway:
                    # it costs one round trip and makes the read consistent as
                    # of a single point in time, so a multi-table report cannot
                    # straddle a concurrent commit.
                    await cursor.execute("SET TRANSACTION READ ONLY")
                    if binds is None:
                        await cursor.execute(sql)
                    else:
                        await cursor.execute(sql, binds)

                    if cursor.description is None:
                        raise QueryFailed(
                            "The statement returned no result set. Send a SELECT."
                        )
                    columns = [str(column[0]) for column in cursor.description]

                    rows: list[list[Any]] = []
                    truncated = False
                    while len(rows) < profile.row_cap:
                        batch = await cursor.fetchmany(
                            min(_FETCH_BATCH, profile.row_cap - len(rows))
                        )
                        if not batch:
                            break
                        rows.extend([_to_jsonable(v) for v in row] for row in batch)
                    else:
                        # The cap was reached; find out whether anything is left
                        # so the caller is told the truth about completeness
                        # rather than being handed a silently short answer.
                        truncated = bool(await cursor.fetchmany(1))

        except oracledb.Error as exc:
            # Statement-level errors are passed through: "table or view does
            # not exist" and "invalid identifier" describe the query the model
            # wrote, and are what let it correct itself.
            logger.warning("Query failed on %s: %s", profile, exc)
            raise QueryFailed(_safe_oracle_message(exc)) from exc
        except QueryFailed:
            raise
        except Exception as exc:
            # A connection dropped mid-statement surfaces as OSError rather
            # than oracledb.Error, and carries the peer address.
            logger.error(
                "Non-Oracle failure running a query on %s: %r",
                profile, exc, exc_info=True,
            )
            raise QueryFailed(_CONNECTION_FAILED) from exc

        return QueryResult(
            columns=columns,
            rows=rows,
            truncated=truncated,
            row_cap=profile.row_cap,
        )
