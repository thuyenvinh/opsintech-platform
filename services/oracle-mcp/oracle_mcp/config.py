"""Connection profiles, loaded from a secret file the platform never sees.

One profile is one Oracle account. A tenant is pointed at a profile by the
bearer token it presents, and the token is the only part of this that leaves
the container.

That split is the point. The platform stores an MCP registration's headers as
plaintext JSON in Postgres (``tenant_mcp_servers.headers``), so anything put
there should be treated as readable by whoever can read that database. A token
that selects a profile is safe to keep there: leaking it grants the access the
tenant already had. An Oracle password is not, and never appears outside this
file.

The file is read once at startup. A profile added later needs a restart, which
is deliberate -- reloading on change would mean a malformed edit silently
drops a tenant's access mid-run instead of failing visibly at deploy time.
"""

from __future__ import annotations

import hmac
import json
import os
from dataclasses import dataclass, field
from pathlib import Path

#: Where the secret is expected. Override for local runs; in the compose file
#: this is a mounted docker secret.
PROFILES_PATH_ENV = "ORACLE_MCP_PROFILES_FILE"
DEFAULT_PROFILES_PATH = "/run/secrets/oracle-mcp-profiles.json"

#: Hard ceiling on rows returned, whatever a profile asks for. A model that
#: receives fifty thousand rows cannot use them and the context cost is real,
#: so this is a product limit as much as a safety one.
ROW_CAP_CEILING = 1000
DEFAULT_ROW_CAP = 200

#: Hard ceiling on how long one statement may run, whatever a profile asks
#: for. Oracle enforces its own limit through the account's resource profile;
#: this one stops the server from holding a connection while that plays out.
CALL_TIMEOUT_CEILING_S = 120
DEFAULT_CALL_TIMEOUT_S = 30


class ConfigError(Exception):
    """The profile file is missing, malformed, or internally inconsistent."""


@dataclass(frozen=True)
class Profile:
    """One Oracle account, and the limits that apply to queries run through it."""

    name: str
    dsn: str
    user: str
    password: str = field(repr=False)
    token: str = field(repr=False)
    allowed_objects: frozenset[str] | None
    row_cap: int
    call_timeout_s: int
    description: str = ""

    def __str__(self) -> str:  # pragma: no cover - diagnostic only
        return f"profile {self.name!r} as {self.user}@{self.dsn}"


@dataclass(frozen=True)
class Profiles:
    """Every configured profile, addressable by token."""

    _by_name: dict[str, Profile]

    def resolve_token(self, token: str | None) -> Profile | None:
        """Return the profile this token selects, or ``None``.

        Comparison is constant-time against every profile rather than a dict
        lookup. A dict lookup on a secret leaks its prefix through timing;
        there are a handful of profiles, so comparing them all costs nothing
        worth measuring.
        """
        if not token:
            return None
        found: Profile | None = None
        for profile in self._by_name.values():
            if hmac.compare_digest(profile.token, token):
                found = profile
        return found

    def names(self) -> list[str]:
        return sorted(self._by_name)

    def all(self) -> list[Profile]:
        """Every profile, for startup logging. Not addressable by callers."""
        return [self._by_name[name] for name in sorted(self._by_name)]

    def __len__(self) -> int:
        return len(self._by_name)


def _require_str(raw: dict, key: str, profile_name: str) -> str:
    value = raw.get(key)
    if not isinstance(value, str) or not value.strip():
        raise ConfigError(
            f"Profile {profile_name!r} is missing a non-empty string {key!r}."
        )
    return value.strip()


def _bounded_int(raw: dict, key: str, default: int, ceiling: int, profile_name: str) -> int:
    value = raw.get(key, default)
    if isinstance(value, bool) or not isinstance(value, int):
        raise ConfigError(f"Profile {profile_name!r} has a non-integer {key!r}.")
    if value < 1:
        raise ConfigError(f"Profile {profile_name!r} has {key!r} below 1.")
    return min(value, ceiling)


def _parse_profile(name: str, raw: object) -> Profile:
    if not isinstance(raw, dict):
        raise ConfigError(f"Profile {name!r} is not an object.")

    objects = raw.get("allowed_objects")
    if objects is None:
        # Deliberately allowed: the Oracle grant is then the only thing
        # deciding what is readable, which is the right configuration when the
        # account was created narrow. The server logs this at startup so it is
        # a visible choice rather than an oversight.
        allowed: frozenset[str] | None = None
    elif isinstance(objects, list) and all(isinstance(o, str) and o.strip() for o in objects):
        allowed = frozenset(o.strip().upper() for o in objects)
        if not allowed:
            raise ConfigError(
                f"Profile {name!r} has an empty 'allowed_objects' list. Omit the "
                "key to rely on the Oracle grant, or list the objects to allow."
            )
    else:
        raise ConfigError(
            f"Profile {name!r} has a malformed 'allowed_objects'; expected a list "
            "of non-empty 'SCHEMA.OBJECT' strings."
        )

    token = _require_str(raw, "token", name)
    if len(token) < 24:
        raise ConfigError(
            f"Profile {name!r} has a token shorter than 24 characters. This value "
            "is stored in the platform database and is the only thing separating "
            "one tenant's data from another's."
        )

    return Profile(
        name=name,
        dsn=_require_str(raw, "dsn", name),
        user=_require_str(raw, "user", name),
        password=_require_str(raw, "password", name),
        token=token,
        allowed_objects=allowed,
        row_cap=_bounded_int(raw, "row_cap", DEFAULT_ROW_CAP, ROW_CAP_CEILING, name),
        call_timeout_s=_bounded_int(
            raw, "call_timeout_s", DEFAULT_CALL_TIMEOUT_S, CALL_TIMEOUT_CEILING_S, name
        ),
        description=str(raw.get("description", "")),
    )


def load_profiles(path: str | os.PathLike[str] | None = None) -> Profiles:
    """Read and validate the profile file.

    Raises :class:`ConfigError` rather than starting with partial
    configuration: a server that comes up having silently dropped a
    malformed profile looks healthy while one tenant is broken.
    """
    resolved = Path(path or os.environ.get(PROFILES_PATH_ENV) or DEFAULT_PROFILES_PATH)
    try:
        text = resolved.read_text(encoding="utf-8")
    except FileNotFoundError as exc:
        raise ConfigError(
            f"No profile file at {resolved}. Mount one, or set "
            f"{PROFILES_PATH_ENV} to its path."
        ) from exc
    except OSError as exc:
        raise ConfigError(f"Could not read {resolved}: {exc}") from exc

    try:
        document = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ConfigError(f"{resolved} is not valid JSON: {exc}") from exc

    if not isinstance(document, dict) or not isinstance(document.get("profiles"), dict):
        raise ConfigError(
            f"{resolved} must be an object with a 'profiles' object, keyed by "
            "profile name."
        )

    raw_profiles: dict = document["profiles"]
    if not raw_profiles:
        raise ConfigError(f"{resolved} configures no profiles.")

    parsed = {name: _parse_profile(name, raw) for name, raw in raw_profiles.items()}

    # Two profiles sharing a token would make tenant separation depend on dict
    # ordering. Catch it here rather than discovering it as a data leak.
    seen: dict[str, str] = {}
    for name, profile in parsed.items():
        clash = seen.get(profile.token)
        if clash is not None:
            raise ConfigError(
                f"Profiles {clash!r} and {name!r} share a token. Each profile "
                "needs its own."
            )
        seen[profile.token] = name

    return Profiles(_by_name=parsed)
