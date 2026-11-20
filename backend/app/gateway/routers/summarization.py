"""Summarization settings API router for tenant-admin settings.

The setting governs every agent run in one tenant, so it is tenant state, not
process state. It is stored in the tenant-shared ``user_configs`` row (see
``deerflow.database.user_config_service.set_tenant_shared_app_payload``) and
read back into the per-tenant config registry in
``deerflow.config.summarization_config`` -- the same place
``AppConfig`` resolution loads it from on a cache miss, so the API and the agent
runtime agree on one value per tenant.
"""

import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, Field
from sqlalchemy.exc import SQLAlchemyError

from app.gateway.authorization import require_tenant_context
from app.gateway.permissions import require_cap
from deerflow.config.app_config import invalidate_user_app_config_cache
from deerflow.config.summarization_config import (
    DEFAULT_KEEP_MESSAGES,
    DEFAULT_TRIGGER_MESSAGES,
    DEFAULT_TRIGGER_TOKENS,
    ContextSize,
    SummarizationConfig,
    clear_summarization_config,
    get_summarization_config,
    has_tenant_summarization_config,
    set_summarization_config,
)
from deerflow.database.user_config_service import (
    get_tenant_shared_app_payload,
    set_tenant_shared_app_payload,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["summarization"])

#: Errors that mean "the config database is not reachable or not migrated here".
#: ``asyncpg`` surfaces a DNS/connect failure as a bare :class:`OSError`, which
#: SQLAlchemy does not wrap, so both families are needed.
_DB_UNAVAILABLE = (SQLAlchemyError, OSError)


# ── Response model ───────────────────────────────────────────────────────────

class ContextSizeResponse(BaseModel):
    type: str = Field(..., description="Type: tokens, messages, or fraction")
    value: int | float = Field(..., description="Value for the context size")


class SummarizationSettingsResponse(BaseModel):
    enabled: bool = Field(..., description="Whether summarization is enabled")
    trigger_tokens: int = Field(..., description="Token threshold to trigger summarization")
    trigger_messages: int = Field(..., description="Message count threshold to trigger summarization")
    keep_messages: int = Field(..., description="Number of recent messages to preserve after summarization")
    trim_tokens_to_summarize: int | None = Field(..., description="Max tokens when preparing messages for summarization")


class SummarizationSettingsUpdate(BaseModel):
    enabled: bool | None = Field(default=None, description="Enable/disable summarization")
    trigger_tokens: int | None = Field(default=None, description="Token threshold to trigger summarization")
    trigger_messages: int | None = Field(default=None, description="Message count threshold to trigger summarization")
    keep_messages: int | None = Field(default=None, description="Number of recent messages to preserve")
    trim_tokens_to_summarize: int | None = Field(default=None, description="Max tokens for summary preparation")


# ── Helpers ──────────────────────────────────────────────────────────────────

def _build_response(config: SummarizationConfig) -> SummarizationSettingsResponse:
    """Build a flat response from the current config."""
    trigger_tokens = DEFAULT_TRIGGER_TOKENS
    trigger_messages = DEFAULT_TRIGGER_MESSAGES

    triggers = config.trigger
    if isinstance(triggers, ContextSize):
        triggers = [triggers]
    if triggers:
        for t in triggers:
            tup = t.to_tuple() if isinstance(t, ContextSize) else t
            if tup[0] == "tokens":
                trigger_tokens = int(tup[1])
            elif tup[0] == "messages":
                trigger_messages = int(tup[1])

    keep = config.keep.to_tuple()
    keep_messages = int(keep[1]) if keep[0] == "messages" else DEFAULT_KEEP_MESSAGES

    return SummarizationSettingsResponse(
        enabled=config.enabled,
        trigger_tokens=trigger_tokens,
        trigger_messages=trigger_messages,
        keep_messages=keep_messages,
        trim_tokens_to_summarize=config.trim_tokens_to_summarize,
    )


async def _load_tenant_config(tenant_id: str) -> SummarizationConfig:
    """Resolve one tenant's config: process registry first, then the DB row.

    The registry is kept warm by ``AppConfig`` resolution, which reads the same
    stored payload. It can still be cold -- a worker that has not resolved a
    config for this tenant yet -- so a cold read falls through to the DB and
    warms it. A DB that cannot be reached degrades to whatever this worker
    holds, which is the tenant's own value or code defaults, never another
    tenant's.
    """
    if has_tenant_summarization_config(tenant_id):
        return get_summarization_config(tenant_id)

    try:
        payload = await get_tenant_shared_app_payload(tenant_id)
    except _DB_UNAVAILABLE:
        logger.warning(
            "Could not read stored summarization settings for tenant %s; "
            "serving the value held by this worker",
            tenant_id,
            exc_info=True,
        )
        return get_summarization_config(tenant_id)

    stored = payload.get("summarization")
    if not isinstance(stored, dict) or not stored:
        clear_summarization_config(tenant_id)
        return SummarizationConfig.default_config()

    try:
        config = SummarizationConfig(**stored)
    except Exception:
        logger.warning(
            "Stored summarization settings for tenant %s are unreadable; using defaults",
            tenant_id,
            exc_info=True,
        )
        return SummarizationConfig.default_config()

    set_summarization_config(config, tenant_id=tenant_id)
    return config


def _apply_update(
    current: SummarizationConfig,
    body: SummarizationSettingsUpdate,
) -> SummarizationConfig:
    """Return a new config with ``body``'s set fields applied.

    A copy, never an in-place edit: ``current`` is the live object this tenant's
    in-flight agent runs are reading, and a request that fails afterwards must
    leave it untouched.
    """
    config = current.model_copy(deep=True)
    resolved = _build_response(current)

    if body.enabled is not None:
        config.enabled = body.enabled

    trigger_tokens = body.trigger_tokens if body.trigger_tokens is not None else resolved.trigger_tokens
    trigger_messages = body.trigger_messages if body.trigger_messages is not None else resolved.trigger_messages
    config.trigger = [
        ContextSize(type="tokens", value=trigger_tokens),
        ContextSize(type="messages", value=trigger_messages),
    ]

    if body.keep_messages is not None:
        config.keep = ContextSize(type="messages", value=body.keep_messages)

    if body.trim_tokens_to_summarize is not None:
        config.trim_tokens_to_summarize = body.trim_tokens_to_summarize

    return config


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.get(
    "/tenant-admin/settings/summarization",
    response_model=SummarizationSettingsResponse,
    summary="Get Summarization Settings",
    description="Retrieve current summarization (context compression) settings for the tenant.",
)
async def get_summarization_settings(request: Request) -> SummarizationSettingsResponse:
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="Missing user context")
    tenant_id = require_tenant_context(request)

    return _build_response(await _load_tenant_config(tenant_id))


@router.put(
    "/tenant-admin/settings/summarization",
    response_model=SummarizationSettingsResponse,
    summary="Update Summarization Settings",
    description="Update summarization (context compression) settings for the tenant.",
    dependencies=[Depends(require_cap("tenant.summarization.write"))],
)
async def update_summarization_settings(
    request: Request,
    body: SummarizationSettingsUpdate,
) -> SummarizationSettingsResponse:
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="Missing user context")
    tenant_id = require_tenant_context(request)

    config = _apply_update(await _load_tenant_config(tenant_id), body)

    try:
        await set_tenant_shared_app_payload(
            tenant_id, {"summarization": config.model_dump(mode="json")}
        )
    except _DB_UNAVAILABLE as exc:
        # Report the failure instead of returning 200. This used to log an
        # error and fall through, applying the value to this worker only: the
        # admin saw their change accepted, every other worker kept serving the
        # old value, and a restart silently reverted it. A settings write that
        # cannot be stored has not happened, and the caller is the only one who
        # can decide what to do about it -- so say so, and leave the in-process
        # binding below untouched so this worker does not diverge from the
        # stored value either.
        logger.error(
            "Summarization settings for tenant %s could not be persisted",
            tenant_id,
            exc_info=True,
        )
        raise HTTPException(
            status_code=503,
            detail="Settings could not be saved; the configuration store is unavailable",
        ) from exc

    # Bind the new value for this tenant only, then drop the AppConfig entries
    # that cached the old payload so every member of the tenant picks it up on
    # their next request instead of waiting for an unrelated eviction.
    set_summarization_config(config, tenant_id=tenant_id)
    invalidate_user_app_config_cache(tenant_id=tenant_id)

    return _build_response(config)
