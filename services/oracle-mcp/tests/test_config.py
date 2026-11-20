"""The profile file is what separates one tenant's data from another's.

Every test here is about a way that separation could fail quietly: a token
short enough to guess, two profiles sharing one, a malformed entry that gets
skipped instead of noticed.
"""

from __future__ import annotations

import json

import pytest

from oracle_mcp.config import (
    ROW_CAP_CEILING,
    ConfigError,
    load_profiles,
)

TOKEN_A = "a" * 32
TOKEN_B = "b" * 32


def _write(tmp_path, document: dict) -> str:
    path = tmp_path / "profiles.json"
    path.write_text(json.dumps(document), encoding="utf-8")
    return str(path)


def _profile(**overrides) -> dict:
    base = {
        "dsn": "db.example.vn:1521/ORCLPDB1",
        "user": "RPT_READER",
        "password": "secret",
        "token": TOKEN_A,
        "allowed_objects": ["RPT.V_SUBSCRIBER"],
    }
    base.update(overrides)
    return base


# ---------------------------------------------------------------------------
# Token resolution
# ---------------------------------------------------------------------------


def test_a_token_resolves_to_its_own_profile(tmp_path) -> None:
    profiles = load_profiles(
        _write(
            tmp_path,
            {
                "profiles": {
                    "tenant-a": _profile(token=TOKEN_A, user="A_READER"),
                    "tenant-b": _profile(token=TOKEN_B, user="B_READER"),
                }
            },
        )
    )
    assert profiles.resolve_token(TOKEN_A).user == "A_READER"
    assert profiles.resolve_token(TOKEN_B).user == "B_READER"


@pytest.mark.parametrize("token", [None, "", "   ", "wrong", TOKEN_A[:-1], TOKEN_A + "x"])
def test_an_unrecognised_token_resolves_to_nothing(tmp_path, token) -> None:
    """Including a near miss: a prefix must not be accepted."""
    profiles = load_profiles(
        _write(tmp_path, {"profiles": {"tenant-a": _profile()}})
    )
    assert profiles.resolve_token(token) is None


def test_two_profiles_may_not_share_a_token(tmp_path) -> None:
    """Otherwise which tenant a token selects depends on dict ordering."""
    with pytest.raises(ConfigError, match="share a token"):
        load_profiles(
            _write(
                tmp_path,
                {
                    "profiles": {
                        "tenant-a": _profile(token=TOKEN_A),
                        "tenant-b": _profile(token=TOKEN_A),
                    }
                },
            )
        )


def test_a_short_token_is_refused(tmp_path) -> None:
    with pytest.raises(ConfigError, match="24 characters"):
        load_profiles(_write(tmp_path, {"profiles": {"tenant-a": _profile(token="short")}}))


# ---------------------------------------------------------------------------
# Secrets must not be printable
# ---------------------------------------------------------------------------


def test_repr_and_str_withhold_the_password_and_token(tmp_path) -> None:
    """These objects reach log lines and tracebacks."""
    profiles = load_profiles(_write(tmp_path, {"profiles": {"tenant-a": _profile()}}))
    profile = profiles.resolve_token(TOKEN_A)

    for rendered in (repr(profile), str(profile)):
        assert "secret" not in rendered
        assert TOKEN_A not in rendered
    # and the parts that are safe to log are still there
    assert "RPT_READER" in str(profile)


# ---------------------------------------------------------------------------
# Limits
# ---------------------------------------------------------------------------


def test_a_row_cap_above_the_ceiling_is_clamped(tmp_path) -> None:
    """A profile cannot raise the limit past what the server will serve."""
    profiles = load_profiles(
        _write(tmp_path, {"profiles": {"tenant-a": _profile(row_cap=10_000_000)}})
    )
    assert profiles.resolve_token(TOKEN_A).row_cap == ROW_CAP_CEILING


@pytest.mark.parametrize("value", [0, -1, "200", True, 1.5])
def test_a_nonsense_row_cap_is_refused(tmp_path, value) -> None:
    with pytest.raises(ConfigError):
        load_profiles(
            _write(tmp_path, {"profiles": {"tenant-a": _profile(row_cap=value)}})
        )


# ---------------------------------------------------------------------------
# Allow-list
# ---------------------------------------------------------------------------


def test_allowed_objects_are_folded_to_upper_case(tmp_path) -> None:
    profiles = load_profiles(
        _write(
            tmp_path,
            {"profiles": {"tenant-a": _profile(allowed_objects=["rpt.v_subscriber"])}},
        )
    )
    assert profiles.resolve_token(TOKEN_A).allowed_objects == {"RPT.V_SUBSCRIBER"}


def test_an_omitted_allow_list_means_grant_only(tmp_path) -> None:
    document = {"profiles": {"tenant-a": _profile()}}
    del document["profiles"]["tenant-a"]["allowed_objects"]
    profiles = load_profiles(_write(tmp_path, document))
    assert profiles.resolve_token(TOKEN_A).allowed_objects is None


def test_an_empty_allow_list_is_refused_rather_than_read_as_grant_only(tmp_path) -> None:
    """``[]`` and a missing key would otherwise mean the same thing.

    They are opposites in intent: ``[]`` reads as "nothing", a missing key
    means "whatever the grant allows". Accepting ``[]`` as the latter would
    turn a typo into the widest setting available.
    """
    with pytest.raises(ConfigError, match="empty"):
        load_profiles(
            _write(tmp_path, {"profiles": {"tenant-a": _profile(allowed_objects=[])}})
        )


@pytest.mark.parametrize("value", ["RPT.V_X", [""], ["  "], [1], {"a": "b"}])
def test_a_malformed_allow_list_is_refused(tmp_path, value) -> None:
    with pytest.raises(ConfigError, match="allowed_objects"):
        load_profiles(
            _write(tmp_path, {"profiles": {"tenant-a": _profile(allowed_objects=value)}})
        )


# ---------------------------------------------------------------------------
# Malformed files fail loudly
# ---------------------------------------------------------------------------


def test_a_missing_file_is_an_error(tmp_path) -> None:
    with pytest.raises(ConfigError, match="No profile file"):
        load_profiles(str(tmp_path / "absent.json"))


def test_invalid_json_is_an_error(tmp_path) -> None:
    path = tmp_path / "profiles.json"
    path.write_text("{not json", encoding="utf-8")
    with pytest.raises(ConfigError, match="not valid JSON"):
        load_profiles(str(path))


@pytest.mark.parametrize(
    "document",
    [{}, {"profiles": []}, {"profiles": None}, {"profile": {}}, []],
)
def test_a_document_without_profiles_is_an_error(tmp_path, document) -> None:
    with pytest.raises(ConfigError):
        load_profiles(_write(tmp_path, document))


def test_no_profiles_is_an_error(tmp_path) -> None:
    with pytest.raises(ConfigError, match="configures no profiles"):
        load_profiles(_write(tmp_path, {"profiles": {}}))


@pytest.mark.parametrize("missing", ["dsn", "user", "password", "token"])
def test_a_profile_missing_a_required_field_is_an_error(tmp_path, missing) -> None:
    """Loudly, rather than by dropping that one profile and looking healthy."""
    document = {"profiles": {"tenant-a": _profile()}}
    del document["profiles"]["tenant-a"][missing]
    with pytest.raises(ConfigError, match=missing):
        load_profiles(_write(tmp_path, document))
