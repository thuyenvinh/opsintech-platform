"""Which outbound (channel, chat) pairs a tenant is allowed to publish to.

The IM channel pool is process-wide: one ``ChannelService`` holds one bot
connection per platform and every tenant on the worker shares it. The only
thing that makes an outbound message *belong* to a tenant is the target --
``channel_name`` plus ``chat_id`` -- so that pair is the authorization
boundary, and it has to be checked against what the caller's own tenant has
configured rather than taken from a request body.

The configured targets live in ``AlertingSettings.notification_config``, written
by ``PUT /api/tenant-im/settings`` and read by the alerting notifier. This module
is the single reader of that shape:

``channels``
    list of channel names the tenant has set up (``["feishu", "slack"]``).
``chat_ids``
    channel name -> comma-separated chat ids (``{"feishu": "oc_a,oc_b"}``).
``selected_chat_ids``
    channel name -> explicit list of chat ids. When present as a list it wins
    over the ``chat_ids`` string for that channel, matching the notifier.

NOTE: ``app/alerting/notify.py:_publish`` still inlines the same resolution.
It should call :func:`resolve_tenant_targets` when that module is next touched;
until then the two must be kept in step.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any


def _split_chat_ids(raw: Any) -> list[str]:
    """Split the comma-separated ``chat_ids`` form into individual ids."""
    if not isinstance(raw, str):
        return []
    return [part.strip() for part in raw.split(",") if part.strip()]


def tenant_channel_names(notification_config: Mapping[str, Any] | None) -> list[str]:
    """Channel names the tenant has configured, in configured order."""
    channels = (notification_config or {}).get("channels")
    if not isinstance(channels, list):
        return []
    return [name.strip() for name in channels if isinstance(name, str) and name.strip()]


def tenant_chat_ids(
    notification_config: Mapping[str, Any] | None,
    channel_name: str,
) -> list[str]:
    """Chat ids the tenant has configured for ``channel_name``.

    Returns an empty list when the channel is not configured for the tenant at
    all, so an unconfigured channel can never resolve to a target.
    """
    cfg = notification_config or {}
    name = channel_name.strip()
    if not name or name not in tenant_channel_names(cfg):
        return []

    selected = cfg.get("selected_chat_ids")
    if isinstance(selected, Mapping):
        picked = selected.get(name)
        if isinstance(picked, list):
            return [cid.strip() for cid in picked if isinstance(cid, str) and cid.strip()]

    chat_ids = cfg.get("chat_ids")
    if isinstance(chat_ids, Mapping):
        return _split_chat_ids(chat_ids.get(name))
    return []


def resolve_tenant_targets(
    notification_config: Mapping[str, Any] | None,
) -> list[tuple[str, str]]:
    """Every ``(channel_name, chat_id)`` pair the tenant has configured."""
    cfg = notification_config or {}
    targets: list[tuple[str, str]] = []
    for name in tenant_channel_names(cfg):
        targets.extend((name, chat_id) for chat_id in tenant_chat_ids(cfg, name))
    return targets


def is_tenant_target(
    notification_config: Mapping[str, Any] | None,
    channel_name: str,
    chat_id: str,
) -> bool:
    """Whether ``chat_id`` on ``channel_name`` is configured for this tenant."""
    target = chat_id.strip()
    if not target:
        return False
    return target in tenant_chat_ids(notification_config, channel_name)
