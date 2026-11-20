"""An MCP server exposing curated Oracle reads over streamable HTTP.

Shape of the thing: the platform registers this as a tenant-level MCP server
(``tenant_mcp_servers`` with ``transport_type='http'``), one registration per
tenant, each carrying its own bearer token in the registration headers. The
token selects a connection profile here, and the profile is an Oracle account
whose grants decide what is readable.

Tenancy is deliberately *not* a tool argument. An earlier class of bug in this
platform was exactly that -- a request naming its own tenant, and the server
believing it -- so there is nothing a caller can say that changes which
account its query runs under. The token does that, and the token is checked at
the ASGI edge below, before the MCP protocol layer sees the request at all.
"""

from __future__ import annotations

import contextlib
import contextvars
import logging
import os
from typing import Any

from mcp.server.fastmcp import FastMCP
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.types import ASGIApp, Receive, Scope, Send

from .config import ConfigError, Profile, Profiles, load_profiles
from .db import OraclePools, QueryFailed
from .sql_guard import SqlRefused, check

logger = logging.getLogger(__name__)

#: The profile resolved for the request being served. Set by
#: :class:`ProfileAuthMiddleware`, read by the tools.
_current_profile: contextvars.ContextVar[Profile | None] = contextvars.ContextVar(
    "oracle_mcp_current_profile", default=None
)

_pools = OraclePools()

mcp = FastMCP(
    name="oracle",
    instructions=(
        "Read-only access to curated Oracle reporting views.\n\n"
        "Call list_views first to see what is readable, then describe_view to get "
        "the columns before writing SQL -- guessing column names produces "
        "confident wrong answers. run_query accepts exactly one SELECT. Results "
        "are capped; when a result says it was truncated, narrow the query with a "
        "WHERE clause or aggregate rather than asking for more rows."
    ),
)


def _require_profile() -> Profile:
    """Return the profile for this request.

    A tool reaching this with nothing set means the middleware did not run,
    which would be a wiring mistake rather than an unauthenticated caller. It
    raises instead of falling back to a default profile: a default here would
    silently run one tenant's query against another's account.
    """
    profile = _current_profile.get()
    if profile is None:
        raise RuntimeError(
            "No connection profile is bound to this request. The authentication "
            "middleware is not installed."
        )
    return profile


@mcp.tool()
async def list_views() -> dict[str, Any]:
    """List the Oracle objects this connection may read.

    Returns the configured allow-list. When no allow-list is configured the
    readable set is whatever the Oracle account has been granted, which this
    server cannot enumerate without querying the dictionary, so the answer
    says so rather than implying the set is empty.
    """
    profile = _require_profile()
    if profile.allowed_objects is None:
        return {
            "objects": [],
            "note": (
                "No allow-list is configured for this connection; readable objects "
                "are whatever the database account has been granted SELECT on. "
                "Use describe_view on an object you expect to exist."
            ),
        }
    return {
        "objects": sorted(profile.allowed_objects),
        "note": profile.description or "",
    }


@mcp.tool()
async def describe_view(object_name: str) -> dict[str, Any]:
    """Return the columns, types and comments of one readable object.

    ``object_name`` is ``SCHEMA.OBJECT``. The lookup reads Oracle's own
    dictionary, so it reflects the live shape of the object rather than a
    checked-in copy that can drift.
    """
    profile = _require_profile()
    name = object_name.strip().upper()

    if "." in name:
        owner, _, bare = name.partition(".")
    else:
        # Without a schema the dictionary query would match a same-named object
        # in any schema this account can see, so the answer could describe a
        # different table than the one the query will read.
        raise ValueError(
            f"Give the object as SCHEMA.OBJECT; {object_name!r} has no schema. "
            "Call list_views to see the full names."
        )

    if profile.allowed_objects is not None and name not in profile.allowed_objects:
        raise ValueError(
            f"{name} is not readable by this connection. "
            f"Readable objects: {', '.join(sorted(profile.allowed_objects))}."
        )

    # Bound parameters, not interpolation: this is the one place the server
    # builds SQL around caller-supplied text.
    sql = """
        SELECT c.column_name,
               c.data_type,
               c.nullable,
               cc.comments
          FROM all_tab_columns c
          LEFT JOIN all_col_comments cc
                 ON cc.owner = c.owner
                AND cc.table_name = c.table_name
                AND cc.column_name = c.column_name
         WHERE c.owner = :owner
           AND c.table_name = :object_name
         ORDER BY c.column_id
    """
    result = await _pools.fetch_with_binds(
        profile, sql, {"owner": owner, "object_name": bare}
    )
    if not result.rows:
        raise ValueError(
            f"{name} was not found, or this account cannot see it in the data "
            "dictionary. Call list_views for the readable objects."
        )

    return {
        "object": name,
        "columns": [
            {
                "name": row[0],
                "type": row[1],
                "nullable": row[2] == "Y",
                "comment": row[3] or "",
            }
            for row in result.rows
        ],
    }


@mcp.tool()
async def run_query(sql: str) -> dict[str, Any]:
    """Run exactly one read-only SELECT and return the rows.

    Writes, DDL, multi-statement batches and ``FOR UPDATE`` are refused before
    the database is contacted. Results are capped; the response says whether
    rows were left behind.
    """
    profile = _require_profile()

    try:
        checked = check(sql, allowed_objects=profile.allowed_objects)
    except SqlRefused as exc:
        # Surfaced as the tool's error so the model sees why and can correct,
        # rather than as a server fault.
        raise ValueError(str(exc)) from exc

    logger.info(
        "profile=%s objects=%s sql=%s",
        profile.name,
        ",".join(sorted(checked.referenced_objects)) or "-",
        " ".join(checked.sql.split()),
    )

    try:
        result = await _pools.fetch(profile, checked.sql)
    except QueryFailed as exc:
        raise ValueError(str(exc)) from exc

    payload: dict[str, Any] = {
        "columns": result.columns,
        "rows": result.rows,
        "row_count": len(result.rows),
    }
    if result.truncated:
        payload["truncated"] = True
        payload["note"] = (
            f"Only the first {result.row_cap} rows are shown and more matched. "
            "Narrow the query with a WHERE clause, or aggregate, rather than "
            "paging through it."
        )
    return payload


class ProfileAuthMiddleware:
    """Resolve the bearer token to a profile, or refuse the request.

    This sits outside the MCP app on purpose. Checking the token inside a tool
    would mean an unauthenticated caller could still open a session, list the
    tools and learn the shape of the deployment; here it gets a 401 and
    nothing else.
    """

    def __init__(self, app: ASGIApp, profiles: Profiles) -> None:
        self._app = app
        self._profiles = profiles

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self._app(scope, receive, send)
            return

        request = Request(scope)
        if request.url.path == "/healthz":
            # Liveness only: it reports that the process is up, and says
            # nothing about the database or the profiles, so it needs no token
            # and leaks nothing to an unauthenticated caller.
            await Response(status_code=204)(scope, receive, send)
            return

        header = request.headers.get("authorization", "")
        scheme, _, token = header.partition(" ")
        if scheme.lower() != "bearer" or not token.strip():
            await self._refuse(
                scope, receive, send, "Send 'Authorization: Bearer <token>'."
            )
            return

        profile = self._profiles.resolve_token(token.strip())
        if profile is None:
            logger.warning(
                "Rejected a request with an unrecognised token from %s",
                request.client.host if request.client else "unknown",
            )
            await self._refuse(scope, receive, send, "The token is not recognised.")
            return

        reset = _current_profile.set(profile)
        try:
            await self._app(scope, receive, send)
        finally:
            _current_profile.reset(reset)

    @staticmethod
    async def _refuse(
        scope: Scope, receive: Receive, send: Send, detail: str
    ) -> None:
        response = JSONResponse(
            {"error": "unauthorized", "detail": detail},
            status_code=401,
            headers={"WWW-Authenticate": "Bearer"},
        )
        await response(scope, receive, send)


def build_app() -> Starlette:
    """Build the ASGI app, refusing to start on bad configuration."""
    profiles = load_profiles()
    for profile in profiles.all():
        logger.info("Loaded %s", profile)
        if profile.allowed_objects is None:
            logger.warning(
                "Profile %r has no allowed_objects; the Oracle grant is the only "
                "control over what it can read.",
                profile.name,
            )

    app = mcp.streamable_http_app()
    app.add_middleware(ProfileAuthMiddleware, profiles=profiles)

    # Starlette 1.x dropped add_event_handler, and FastMCP has already set a
    # lifespan here to run its session manager -- so the pool cleanup wraps
    # that one rather than replacing it. Dropping it would leave the MCP
    # session manager unstarted and every request would fail.
    inner_lifespan = app.router.lifespan_context

    @contextlib.asynccontextmanager
    async def lifespan(scope_app: Starlette):
        async with inner_lifespan(scope_app):
            try:
                yield
            finally:
                # Closing the pools last: a connection held open past process
                # exit sits in Oracle until its idle timeout, and with
                # SESSIONS_PER_USER set that leaks the tenant's session budget
                # across a restart loop.
                await _pools.close()

    app.router.lifespan_context = lifespan
    return app


def main() -> None:
    import uvicorn

    logging.basicConfig(
        level=os.environ.get("ORACLE_MCP_LOG_LEVEL", "INFO").upper(),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    try:
        app = build_app()
    except ConfigError as exc:
        # Exit rather than serve: a server that starts without its profiles
        # answers every request with a 401 and looks like an auth problem.
        raise SystemExit(f"oracle-mcp cannot start: {exc}") from exc

    uvicorn.run(
        app,
        host=os.environ.get("ORACLE_MCP_HOST", "0.0.0.0"),
        port=int(os.environ.get("ORACLE_MCP_PORT", "8900")),
        access_log=False,
    )


if __name__ == "__main__":
    main()
