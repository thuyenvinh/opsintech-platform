"""Decide whether one statement is a read the agent may run.

This is the second of two independent controls, and the weaker one. The first
is the Oracle grant: the account the server connects with holds SELECT on the
allow-listed objects and nothing else, so a statement that gets past this
module still cannot write. Everything here exists to give a clear refusal
before the round trip, and to stop a read that is legal but ruinous (a
cartesian join across a billing table) from reaching the database at all.

Validation is a parse, never a pattern match. A regex over SQL text is wrong
in ways that are easy to demonstrate -- ``SELECT 'delete'`` is a read,
``/*select*/ DELETE FROM x`` is a write, and both fool a keyword scan -- so
the statement is parsed with sqlglot in the Oracle dialect and judged on the
resulting tree. Anything that fails to parse is refused rather than guessed
at.
"""

from __future__ import annotations

from dataclasses import dataclass

import sqlglot
from sqlglot import exp

#: Expression types permitted at the root of a statement. ``Select`` covers an
#: ordinary query; ``Union``/``Except``/``Intersect`` cover set operations;
#: ``Subquery`` covers a parenthesised select. A ``With`` (common table
#: expression) parses with the CTE attached to the inner select, so it does not
#: need an entry of its own.
_ALLOWED_ROOTS: tuple[type[exp.Expression], ...] = (
    exp.Select,
    exp.Union,
    exp.Except,
    exp.Intersect,
    exp.Subquery,
)

#: Node types that make a statement something other than a read.
#:
#: Every one of these is also excluded by ``_ALLOWED_ROOTS``, because in the
#: Oracle grammar sqlglot implements today each of them parses *as* the root --
#: there is no statement reaching this module with, say, a DELETE nested inside
#: a SELECT. So this scan is redundant, by measurement rather than assumption.
#:
#: It stays because the redundancy is free and the failure it guards against is
#: not hypothetical: sqlglot's Oracle dialect gains nodes between releases, and
#: a construct that starts parsing into a Select-rooted tree with a write
#: inside it would otherwise pass. ``_find_forbidden`` is tested directly on a
#: constructed tree for exactly that reason, since no SQL string can currently
#: exercise it.
_FORBIDDEN_NODES: dict[type[exp.Expression], str] = {
    exp.Insert: "INSERT",
    exp.Update: "UPDATE",
    exp.Delete: "DELETE",
    exp.Merge: "MERGE",
    exp.Drop: "DROP",
    exp.Create: "CREATE",
    exp.Alter: "ALTER",
    exp.TruncateTable: "TRUNCATE",
    exp.Grant: "GRANT",
    exp.Command: "an unparsed command",
}


class SqlRefused(Exception):
    """The statement is not a read this server will run.

    The message is written to be shown to the model: it says what was rejected
    and what shape is accepted, because a refusal the model cannot act on just
    becomes a retry loop.
    """


@dataclass(frozen=True)
class CheckedQuery:
    """A statement that passed every check, with the objects it touches."""

    sql: str
    referenced_objects: frozenset[str]


def _find_forbidden(root: exp.Expression) -> str | None:
    """Name the first write-or-DDL construct in the tree, or return ``None``.

    Separate from :func:`check` so it can be tested against a hand-built tree.
    No SQL string reaches this with a nested match today -- see
    ``_FORBIDDEN_NODES`` -- so a test that only went through :func:`check`
    would leave the scan unexercised and free to rot.
    """
    for node_type, label in _FORBIDDEN_NODES.items():
        if isinstance(root, node_type):
            return label
        if next(root.find_all(node_type), None) is not None:
            return label
    return None


def _normalise_object_name(table: exp.Table) -> str:
    """Render a table reference the way the allow-list is written.

    Oracle folds unquoted identifiers to upper case, so ``rpt.v_subscriber``
    and ``RPT.V_SUBSCRIBER`` are the same object and must compare equal. A
    quoted identifier is case-sensitive in Oracle, but the allow-list is
    configuration written by an operator rather than SQL, so it is compared
    case-insensitively too -- being stricter here would reject the object the
    operator meant to allow, with no gain, since the grant is what actually
    decides.
    """
    parts = [part.name for part in (table.args.get("catalog"), table.args.get("db")) if part]
    parts.append(table.name)
    return ".".join(part.upper() for part in parts if part)


def check(
    sql: str,
    *,
    allowed_objects: frozenset[str] | None = None,
) -> CheckedQuery:
    """Return the statement if it is a single read, else raise :class:`SqlRefused`.

    ``allowed_objects`` is an optional allow-list of ``SCHEMA.OBJECT`` names.
    When given, every table the statement references must appear in it. When
    ``None`` the reference check is skipped and the Oracle grant is the only
    thing deciding which objects are reachable -- which is the intended
    configuration for a connection whose grants are already narrow.
    """
    text = sql.strip().rstrip(";").strip()
    if not text:
        raise SqlRefused("The statement is empty. Send one SELECT.")

    try:
        statements = sqlglot.parse(text, dialect="oracle")
    except sqlglot.errors.ParseError as exc:
        raise SqlRefused(
            f"The statement could not be parsed as Oracle SQL: {exc}. "
            "Send one syntactically valid SELECT."
        ) from exc

    statements = [stmt for stmt in statements if stmt is not None]
    if not statements:
        raise SqlRefused("The statement is empty. Send one SELECT.")
    if len(statements) > 1:
        # Refusing the batch outright rather than running the first statement.
        # Running a prefix of what was asked for is its own hazard: the caller
        # is told the query succeeded while part of it silently did not run.
        raise SqlRefused(
            f"{len(statements)} statements were sent. Send exactly one SELECT, "
            "with no semicolon-separated batch."
        )

    root = statements[0]

    found = _find_forbidden(root)
    if found is not None:
        raise SqlRefused(
            f"This connection is read-only and the statement contains {found}. "
            "Send a SELECT."
        )

    if not isinstance(root, _ALLOWED_ROOTS):
        raise SqlRefused(
            f"Only a SELECT is accepted here; this is a {type(root).__name__.upper()}. "
            "Send a SELECT."
        )

    # ``SELECT ... FOR UPDATE`` reads, but it takes row locks that persist for
    # the transaction and can block a production writer. It is not a read for
    # this purpose.
    if next(root.find_all(exp.Lock), None) is not None:
        raise SqlRefused(
            "FOR UPDATE takes row locks on a production database. "
            "Send a plain SELECT."
        )

    referenced = {
        _normalise_object_name(table)
        for table in root.find_all(exp.Table)
        if table.name
    }

    # A CTE is referenced like a table but is defined by the statement itself,
    # so it must not be matched against the allow-list.
    cte_names = {
        cte.alias_or_name.upper()
        for cte in root.find_all(exp.CTE)
        if cte.alias_or_name
    }
    referenced -= cte_names

    if allowed_objects is not None:
        allowed_upper = frozenset(name.upper() for name in allowed_objects)
        unlisted = sorted(referenced - allowed_upper)
        if unlisted:
            raise SqlRefused(
                "The statement references objects this connection may not read: "
                f"{', '.join(unlisted)}. Readable objects: "
                f"{', '.join(sorted(allowed_upper)) or '(none configured)'}."
            )

    return CheckedQuery(sql=text, referenced_objects=frozenset(referenced))
