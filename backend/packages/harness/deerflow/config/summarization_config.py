"""Configuration for conversation summarization.

Summarization config is managed via tenant-admin settings (stored in DB),
NOT in config.yaml. Default values are defined here as code constants.

The resolved config is held per tenant: readers get the config of the tenant
bound to the current execution flow, and a tenant with nothing stored gets the
code defaults. A single process-wide value would mean one tenant's write is
served to every other tenant on the same worker.
"""

import logging
from typing import Literal

from pydantic import BaseModel, Field

from deerflow.config.tenant_context import get_current_tenant_id

logger = logging.getLogger(__name__)

ContextSizeType = Literal["fraction", "tokens", "messages"]

# ── Default values (used when no DB config exists) ──────────────────────────
DEFAULT_ENABLED = True
DEFAULT_TRIGGER_TOKENS = 12000
DEFAULT_TRIGGER_MESSAGES = 30
DEFAULT_KEEP_MESSAGES = 15
DEFAULT_TRIM_TOKENS_TO_SUMMARIZE = 12000


class ContextSize(BaseModel):
    """Context size specification for trigger or keep parameters."""

    type: ContextSizeType = Field(description="Type of context size specification")
    value: int | float = Field(description="Value for the context size specification")

    def to_tuple(self) -> tuple[ContextSizeType, int | float]:
        """Convert to tuple format expected by SummarizationMiddleware."""
        return (self.type, self.value)


class SummarizationConfig(BaseModel):
    """Configuration for automatic conversation summarization."""

    enabled: bool = Field(
        default=DEFAULT_ENABLED,
        description="Whether to enable automatic conversation summarization",
    )
    model_name: str | None = Field(
        default=None,
        description="Model name to use for summarization (None = use conversation model)",
    )
    trigger: ContextSize | list[ContextSize] | None = Field(
        default=None,
        description="One or more thresholds that trigger summarization.",
    )
    keep: ContextSize = Field(
        default_factory=lambda: ContextSize(type="messages", value=DEFAULT_KEEP_MESSAGES),
        description="Context retention policy after summarization.",
    )
    trim_tokens_to_summarize: int | None = Field(
        default=DEFAULT_TRIM_TOKENS_TO_SUMMARIZE,
        description="Maximum tokens when preparing messages for summarization.",
    )
    summary_prompt: str | None = Field(
        default=None,
        description="Custom prompt template for generating summaries.",
    )

    @classmethod
    def default_config(cls) -> "SummarizationConfig":
        """Return a config with sensible defaults (no DB config needed)."""
        return cls(
            enabled=DEFAULT_ENABLED,
            trigger=[
                ContextSize(type="tokens", value=DEFAULT_TRIGGER_TOKENS),
                ContextSize(type="messages", value=DEFAULT_TRIGGER_MESSAGES),
            ],
            keep=ContextSize(type="messages", value=DEFAULT_KEEP_MESSAGES),
            trim_tokens_to_summarize=DEFAULT_TRIM_TOKENS_TO_SUMMARIZE,
        )


# ── Process state ───────────────────────────────────────────────────────────
#
# The setting is per tenant, so the resolved value is held per tenant id and
# the active tenant decides which one a reader sees. The module-level
# ``_summarization_config`` is only the fallback used when no tenant is bound
# (CLI runs, background jobs) or when the active tenant has no stored config;
# it is never written by a tenant's request, which is what used to make one
# tenant's write visible to every other tenant on the worker.

_summarization_config: SummarizationConfig = SummarizationConfig.default_config()
_tenant_summarization_configs: dict[str, SummarizationConfig] = {}


def _active_tenant_id() -> str | None:
    """Tenant bound to the current execution flow, if any."""
    tenant_id = get_current_tenant_id()
    if isinstance(tenant_id, str) and tenant_id.strip():
        return tenant_id.strip()
    return None


def get_summarization_config(tenant_id: str | None = None) -> SummarizationConfig:
    """Get the summarization configuration for a tenant.

    ``tenant_id`` defaults to the tenant bound to the current execution flow
    (:mod:`deerflow.config.tenant_context`). When that tenant has no stored
    config -- not yet loaded, or never configured -- the process fallback is
    returned, so an unconfigured tenant sees code defaults and never another
    tenant's values.
    """
    resolved = tenant_id.strip() if isinstance(tenant_id, str) and tenant_id.strip() else _active_tenant_id()
    if resolved is not None:
        config = _tenant_summarization_configs.get(resolved)
        if config is not None:
            return config
    return _summarization_config


def set_summarization_config(config: SummarizationConfig, tenant_id: str | None = None) -> None:
    """Set the summarization configuration.

    With ``tenant_id`` the config is bound to that tenant only. Without it the
    process fallback is replaced -- used by tests and by non-tenant callers, and
    deliberately *not* by the tenant settings API.
    """
    global _summarization_config

    if isinstance(tenant_id, str) and tenant_id.strip():
        _tenant_summarization_configs[tenant_id.strip()] = config
        return
    _summarization_config = config


def has_tenant_summarization_config(tenant_id: str) -> bool:
    """Whether a config is already bound for ``tenant_id`` on this worker."""
    return bool(isinstance(tenant_id, str) and tenant_id.strip() in _tenant_summarization_configs)


def clear_summarization_config(tenant_id: str | None = None) -> None:
    """Drop the cached config for one tenant, or for every tenant."""
    if isinstance(tenant_id, str) and tenant_id.strip():
        _tenant_summarization_configs.pop(tenant_id.strip(), None)
        return
    _tenant_summarization_configs.clear()


def load_summarization_config_from_payload(app_payload: dict) -> None:
    """Load summarization config from a DB app_payload dict.

    Called while resolving a user's AppConfig, so the active tenant decides
    where the parsed value lands. A payload with no usable ``summarization``
    block clears that tenant's entry rather than leaving whatever was there
    before, so a removed setting falls back to code defaults.
    """
    global _summarization_config

    tenant_id = _active_tenant_id()
    summarization_dict = app_payload.get("summarization")

    config: SummarizationConfig | None = None
    if isinstance(summarization_dict, dict) and summarization_dict:
        try:
            config = SummarizationConfig(**summarization_dict)
        except Exception:
            logger.warning(
                "Failed to parse summarization config from DB payload, keeping defaults",
                exc_info=True,
            )
            config = None

    if tenant_id is None:
        # No tenant bound: only an explicit payload may move the fallback.
        if config is not None:
            _summarization_config = config
            logger.info("Loaded summarization config from DB payload")
        return

    if config is None:
        _tenant_summarization_configs.pop(tenant_id, None)
        return

    _tenant_summarization_configs[tenant_id] = config
    logger.info("Loaded summarization config from DB payload for tenant %s", tenant_id)


# Legacy alias — kept for backward compatibility with any callers that still
# pass a flat dict (e.g. old config.yaml loading path, now unused).
load_summarization_config_from_dict = load_summarization_config_from_payload
