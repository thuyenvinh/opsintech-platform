"""Gateway router for IM channel management.

The IM channel pool is process-wide, not per tenant: ``ChannelService`` is a
singleton built from the ``channels`` block of ``config.yaml``, holding one bot
connection per platform keyed by channel name alone, shared by every tenant on
the worker. Two consequences shape the guards here:

* A tenant's claim on a channel is its *target* -- the ``(channel_name,
  chat_id)`` pair it configured under ``/api/tenant-im/settings``. Publishing is
  therefore validated against the caller's own tenant settings
  (:mod:`app.channels.targets`), never against the request body alone.
* Lifecycle actions have no tenant scope at all. Restarting a channel drops
  every tenant's connection on that worker, so it is platform work and is
  guarded by a platform capability rather than ``tenant.channel.manage``.
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.channels.targets import is_tenant_target, tenant_channel_names
from app.gateway.authorization import require_tenant_context
from app.gateway.i18n import tr
from app.gateway.permissions import require_cap
from app.models.alerting import AlertingSettings
from deerflow.database.session import get_session

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/channels", tags=["channels"])


class ChannelStatusResponse(BaseModel):
    service_running: bool
    channels: dict[str, dict]


class ChannelRestartResponse(BaseModel):
    success: bool
    message: str


class TestNotificationRequest(BaseModel):
    channel_name: str
    chat_id: str


class TestNotificationResponse(BaseModel):
    success: bool
    message: str



@router.get(
    "/",
    response_model=ChannelStatusResponse,
    dependencies=[Depends(require_cap("tenant.channel.manage"))],
)
async def get_channels_status() -> ChannelStatusResponse:
    """Get the status of all IM channels."""
    from app.channels.service import get_channel_service

    service = get_channel_service()
    if service is None:
        return ChannelStatusResponse(service_running=False, channels={})
    status = service.get_status()
    return ChannelStatusResponse(**status)


@router.post(
    "/{name}/restart",
    response_model=ChannelRestartResponse,
    dependencies=[Depends(require_cap("platform.security.write"))],
)
async def restart_channel(name: str) -> ChannelRestartResponse:
    """Restart a specific IM channel for the whole worker.

    Blast radius: every tenant served by this process loses and re-establishes
    the channel's bot connection, and anything queued on it is interrupted.
    There is no per-tenant channel instance to restart instead -- the pool is
    global -- so this is platform work and requires a platform capability. A
    tenant admin with ``tenant.channel.manage`` can no longer reach it.
    """
    from app.channels.service import get_channel_service

    service = get_channel_service()
    if service is None:
        raise HTTPException(status_code=503, detail="Channel service is not running")

    success = await service.restart_channel(name)
    if success:
        logger.info("Channel %s restarted successfully", name)
        return ChannelRestartResponse(success=True, message=f"Channel {name} restarted successfully")
    else:
        logger.warning("Failed to restart channel %s", name)
        return ChannelRestartResponse(success=False, message=f"Failed to restart channel {name}")


async def _load_tenant_notification_config(tenant_id: str) -> dict:
    """Read one tenant's ``notification_config``, the configured-target record.

    Uses its own session rather than ``Depends(get_session)`` so the
    service-unavailable path answers without opening a connection. Fails closed:
    if the settings cannot be read, no target can be shown to belong to this
    tenant, so publishing is refused rather than allowed.
    """
    from deerflow.database.session import get_session_factory

    try:
        session_factory = get_session_factory()
        async with session_factory() as session:
            result = await session.exec(
                select(AlertingSettings).where(AlertingSettings.tenant_id == tenant_id)
            )
            settings = result.scalars().first()
    except Exception as exc:
        logger.exception("Could not read IM settings for tenant %s", tenant_id)
        raise HTTPException(
            status_code=503,
            detail="Channel settings are unavailable; cannot verify the target",
        ) from exc

    cfg = settings.notification_config if settings else None
    return dict(cfg) if isinstance(cfg, dict) else {}


async def _resolve_tenant_target(
    tenant_id: str,
    channel_name: str,
    chat_id: str,
) -> tuple[str, str]:
    """Return the normalized target, or 403 if the tenant did not configure it."""
    cfg = await _load_tenant_notification_config(tenant_id)

    if channel_name.strip() not in tenant_channel_names(cfg):
        logger.warning(
            "Rejected channel test for tenant %s: channel %r is not configured for it",
            tenant_id,
            channel_name,
        )
        raise HTTPException(
            status_code=403,
            detail=f"Channel '{channel_name}' is not configured for this tenant",
        )

    if not is_tenant_target(cfg, channel_name, chat_id):
        logger.warning(
            "Rejected channel test for tenant %s: chat %r is not configured on channel %r",
            tenant_id,
            chat_id,
            channel_name,
        )
        raise HTTPException(
            status_code=403,
            detail=(
                f"Chat '{chat_id}' is not configured on channel "
                f"'{channel_name}' for this tenant"
            ),
        )

    return channel_name.strip(), chat_id.strip()


@router.post(
    "/test",
    response_model=TestNotificationResponse,
    dependencies=[Depends(require_cap("tenant.channel.manage"))],
)
async def test_channel_notification(
    body: TestNotificationRequest,
    request: Request,
) -> TestNotificationResponse:
    """Send a test notification to one of the caller's own configured targets.

    ``tenant.channel.manage`` only says the caller governs channels *in their
    tenant*; the channel pool itself is shared. The target therefore has to be
    one this tenant configured under ``/api/tenant-im/settings`` -- otherwise a
    tenant admin could address another tenant's Feishu/Slack/Telegram chat
    simply by naming its chat id.
    """
    from datetime import datetime

    from app.channels.message_bus import OutboundMessage
    from app.channels.service import get_channel_service

    tenant_id = require_tenant_context(request)

    service = get_channel_service()
    if service is None or not service.bus:
        raise HTTPException(status_code=503, detail="Channel service is not running")

    channel_name, chat_id = await _resolve_tenant_target(
        tenant_id, body.channel_name, body.chat_id
    )

    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    text = tr(
        "🔔 **OpsInTech 告警通道连通性测试**\n\n"
        "这是一条自动生成的通道连通性测试消息。\n"
        "**测试状态**: 成功 ✅\n"
        f"**测试渠道**: {channel_name}\n"
        f"**推送群组**: {chat_id}\n"
        f"**时间**: {timestamp}",
        "🔔 **OpsInTech channel connectivity test**\n\n"
        "This is an automatically generated channel connectivity test message.\n"
        "**Status**: success ✅\n"
        f"**Channel**: {channel_name}\n"
        f"**Chat**: {chat_id}\n"
        f"**Time**: {timestamp}",
        "🔔 **Kiểm tra kết nối kênh OpsInTech**\n\n"
        "Đây là tin nhắn kiểm tra kết nối kênh được tạo tự động.\n"
        "**Trạng thái**: thành công ✅\n"
        f"**Kênh**: {channel_name}\n"
        f"**Nhóm nhận**: {chat_id}\n"
        f"**Thời gian**: {timestamp}",
    )

    msg = OutboundMessage(
        channel_name=channel_name,
        chat_id=chat_id,
        thread_id="",
        text=text,
    )
    try:
        await service.bus.publish_outbound(msg)
        logger.info("Test notification published successfully to %s/%s", channel_name, chat_id)
        return TestNotificationResponse(success=True, message=f"Test message sent to {channel_name}")
    except Exception as e:
        logger.exception("Failed to publish test message")
        return TestNotificationResponse(success=False, message=f"Error sending test message: {str(e)}")


# ---------------------------------------------------------------------------
# Tenant IM Settings
# ---------------------------------------------------------------------------

im_settings_router = APIRouter(prefix="/api/tenant-im", tags=["tenant-im"])


class TenantImSettingsResponse(BaseModel):
    enabled: bool = False
    channels: list[str] = []
    chat_ids: dict[str, str] = {}


class TenantImSettingsUpdate(BaseModel):
    enabled: bool = False
    channels: list[str] = []
    chat_ids: dict[str, str] = {}


@im_settings_router.get(
    "/settings",
    response_model=TenantImSettingsResponse,
    summary="Get tenant IM channel settings",
)
async def get_im_settings(
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> TenantImSettingsResponse:
    tenant_id = require_tenant_context(request)
    result = await session.exec(
        select(AlertingSettings).where(AlertingSettings.tenant_id == tenant_id)
    )
    settings = result.scalars().first()
    cfg = settings.notification_config if settings else {}

    return TenantImSettingsResponse(
        enabled=cfg.get("enabled", False),
        channels=cfg.get("channels", []),
        chat_ids=cfg.get("chat_ids", {}),
    )


@im_settings_router.put(
    "/settings",
    response_model=TenantImSettingsResponse,
    summary="Update tenant IM channel settings",
    dependencies=[Depends(require_cap("tenant.channel.manage"))],
)
async def update_im_settings(
    body: TenantImSettingsUpdate,
    request: Request,
    session: AsyncSession = Depends(get_session),
) -> TenantImSettingsResponse:
    """Update only channel infrastructure (channels + chat_ids).
    Does NOT touch alerting-specific notification preferences."""
    tenant_id = require_tenant_context(request)

    result = await session.exec(
        select(AlertingSettings).where(AlertingSettings.tenant_id == tenant_id)
    )
    settings = result.scalars().first()

    if settings is None:
        import uuid
        settings = AlertingSettings(
            id=str(uuid.uuid4()),
            tenant_id=tenant_id,
            notification_config={},
        )

    # Merge: only update channel keys, preserve alerting keys
    cfg = dict(settings.notification_config or {})
    cfg["enabled"] = body.enabled
    cfg["channels"] = body.channels
    cfg["chat_ids"] = body.chat_ids
    settings.notification_config = cfg

    session.add(settings)
    await session.commit()

    return TenantImSettingsResponse(
        enabled=body.enabled,
        channels=body.channels,
        chat_ids=body.chat_ids,
    )

