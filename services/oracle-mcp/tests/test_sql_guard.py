"""What the guard must refuse, and what it must not get in the way of.

The refusal cases carry the weight here. Each one is a statement that a
keyword scan over the SQL text would have got wrong in one direction or the
other, which is why this is a parse.
"""

from __future__ import annotations

import pytest

from oracle_mcp.sql_guard import SqlRefused, check

ALLOWED = frozenset({"RPT.V_SUBSCRIBER", "RPT.V_INVOICE"})


# ---------------------------------------------------------------------------
# Reads that must be allowed
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "sql",
    [
        "SELECT * FROM rpt.v_subscriber",
        "select msisdn, status from RPT.V_SUBSCRIBER where status = 'ACTIVE'",
        "SELECT * FROM rpt.v_subscriber FETCH FIRST 10 ROWS ONLY",
        "SELECT COUNT(*) FROM rpt.v_invoice",
        # A trailing semicolon is how a person types SQL; it is not a batch.
        "SELECT * FROM rpt.v_subscriber;",
        # Join across two allowed objects.
        """
        SELECT s.msisdn, i.amount
          FROM rpt.v_subscriber s
          JOIN rpt.v_invoice i ON i.subscriber_id = s.id
        """,
        # Set operation at the root.
        "SELECT msisdn FROM rpt.v_subscriber UNION SELECT msisdn FROM rpt.v_invoice",
        # A subquery in the FROM clause.
        "SELECT * FROM (SELECT msisdn FROM rpt.v_subscriber) WHERE msisdn IS NOT NULL",
        # A string literal that happens to contain a DML keyword. A regex
        # scanning for "delete" rejects this; it is a read.
        "SELECT 'delete me' AS label FROM rpt.v_subscriber",
        # A column named after a keyword.
        "SELECT s.update_time FROM rpt.v_subscriber s",
    ],
)
def test_allows_reads(sql: str) -> None:
    assert check(sql, allowed_objects=ALLOWED).sql


def test_cte_is_not_checked_against_the_allow_list() -> None:
    """A WITH clause defines its own name; it is not an object to authorise."""
    result = check(
        """
        WITH active AS (SELECT * FROM rpt.v_subscriber WHERE status = 'ACTIVE')
        SELECT COUNT(*) FROM active
        """,
        allowed_objects=ALLOWED,
    )
    assert "ACTIVE" not in result.referenced_objects
    assert "RPT.V_SUBSCRIBER" in result.referenced_objects


def test_reports_the_objects_it_found() -> None:
    result = check(
        "SELECT * FROM rpt.v_subscriber s JOIN rpt.v_invoice i ON i.id = s.id",
        allowed_objects=ALLOWED,
    )
    assert result.referenced_objects == {"RPT.V_SUBSCRIBER", "RPT.V_INVOICE"}


def test_case_and_whitespace_do_not_affect_the_allow_list() -> None:
    """Oracle folds unquoted identifiers, so the check must too."""
    assert check("  select * from RpT.V_sUbScRiBeR  ", allowed_objects=ALLOWED)


# ---------------------------------------------------------------------------
# Writes and DDL
# ---------------------------------------------------------------------------


@pytest.mark.parametrize(
    "sql",
    [
        "DELETE FROM rpt.v_subscriber",
        "UPDATE rpt.v_subscriber SET status = 'X'",
        "INSERT INTO rpt.v_subscriber (msisdn) VALUES ('1')",
        "DROP TABLE rpt.v_subscriber",
        "TRUNCATE TABLE rpt.v_subscriber",
        "CREATE TABLE t AS SELECT * FROM rpt.v_subscriber",
        "ALTER SESSION SET current_schema = other",
        "GRANT SELECT ON rpt.v_subscriber TO someone",
        "MERGE INTO rpt.v_subscriber d USING rpt.v_invoice s ON (d.id = s.id) "
        "WHEN MATCHED THEN UPDATE SET d.status = 'X'",
    ],
)
def test_refuses_writes_and_ddl(sql: str) -> None:
    with pytest.raises(SqlRefused):
        check(sql, allowed_objects=ALLOWED)


def test_refuses_a_write_hidden_behind_a_comment() -> None:
    """A comment that looks like a SELECT does not make a DELETE a read.

    This is the case that motivates parsing: a scan for a leading "select"
    accepts this statement.
    """
    with pytest.raises(SqlRefused, match="DELETE"):
        check("/* select */ DELETE FROM rpt.v_subscriber", allowed_objects=ALLOWED)


def test_refuses_a_batch() -> None:
    """A trailing statement must not ride along behind a legitimate read."""
    with pytest.raises(SqlRefused, match="2 statements"):
        check(
            "SELECT * FROM rpt.v_subscriber; DELETE FROM rpt.v_subscriber",
            allowed_objects=ALLOWED,
        )


def test_refuses_select_for_update() -> None:
    """It reads, but it locks rows a production writer needs."""
    with pytest.raises(SqlRefused, match="FOR UPDATE"):
        check("SELECT * FROM rpt.v_subscriber FOR UPDATE", allowed_objects=ALLOWED)


def test_refuses_a_pl_sql_block() -> None:
    with pytest.raises(SqlRefused):
        check("BEGIN DELETE FROM rpt.v_subscriber; END;", allowed_objects=ALLOWED)


# ---------------------------------------------------------------------------
# Object scoping
# ---------------------------------------------------------------------------


def test_refuses_an_object_outside_the_allow_list() -> None:
    with pytest.raises(SqlRefused, match="CORE.BILLING"):
        check("SELECT * FROM core.billing", allowed_objects=ALLOWED)


def test_refuses_an_unlisted_object_joined_to_a_listed_one() -> None:
    """The listed table must not launder access to the unlisted one."""
    with pytest.raises(SqlRefused, match="CORE.BILLING"):
        check(
            "SELECT * FROM rpt.v_subscriber s JOIN core.billing b ON b.id = s.id",
            allowed_objects=ALLOWED,
        )


def test_refuses_an_unlisted_object_inside_a_subquery() -> None:
    with pytest.raises(SqlRefused, match="CORE.BILLING"):
        check(
            "SELECT * FROM rpt.v_subscriber WHERE id IN (SELECT id FROM core.billing)",
            allowed_objects=ALLOWED,
        )


def test_refuses_the_data_dictionary_when_it_is_not_listed() -> None:
    """Dictionary views are how an unlisted schema gets enumerated."""
    with pytest.raises(SqlRefused):
        check("SELECT table_name FROM all_tables", allowed_objects=ALLOWED)


def test_without_an_allow_list_the_grant_is_the_only_control() -> None:
    """Documented behaviour, asserted so it cannot change silently."""
    assert check("SELECT * FROM core.billing", allowed_objects=None)


# ---------------------------------------------------------------------------
# Malformed input
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("sql", ["", "   ", ";", "   ;  "])
def test_refuses_empty_input(sql: str) -> None:
    with pytest.raises(SqlRefused, match="empty"):
        check(sql, allowed_objects=ALLOWED)


def test_refuses_unparseable_input() -> None:
    with pytest.raises(SqlRefused):
        check("SELECT FROM WHERE ((", allowed_objects=ALLOWED)


# ---------------------------------------------------------------------------
# The nested scan
#
# No Oracle statement sqlglot parses today produces a Select-rooted tree with
# a write inside it, so the scan cannot be reached through check(). It is
# tested directly: the point is that the layer works if a future parser
# release ever does nest one.
# ---------------------------------------------------------------------------


def test_nested_scan_finds_a_write_below_a_select_root() -> None:
    import sqlglot
    from sqlglot import exp

    from oracle_mcp.sql_guard import _find_forbidden

    select = sqlglot.parse_one("SELECT * FROM rpt.v_subscriber", dialect="oracle")
    assert _find_forbidden(select) is None, "a plain SELECT must not trip the scan"

    # Graft a DELETE under the SELECT. Not valid Oracle; the question is only
    # whether the scan sees past the root.
    select.set("where", exp.Where(this=sqlglot.parse_one("DELETE FROM t", dialect="oracle")))
    assert _find_forbidden(select) == "DELETE"


@pytest.mark.parametrize(
    ("sql", "label"),
    [
        ("DELETE FROM rpt.v_subscriber", "DELETE"),
        ("UPDATE rpt.v_subscriber SET status = 'X'", "UPDATE"),
        ("INSERT INTO rpt.v_subscriber (msisdn) VALUES ('1')", "INSERT"),
        ("DROP TABLE rpt.v_subscriber", "DROP"),
        ("GRANT SELECT ON rpt.v_subscriber TO u", "GRANT"),
        ("ALTER SESSION SET current_schema = other", "an unparsed command"),
    ],
)
def test_the_refusal_names_the_construct(sql: str, label: str) -> None:
    """The model has to be told what it did wrong, or it retries blindly."""
    with pytest.raises(SqlRefused) as caught:
        check(sql, allowed_objects=ALLOWED)
    assert label in str(caught.value)
