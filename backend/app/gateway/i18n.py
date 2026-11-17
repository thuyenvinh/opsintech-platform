"""Lightweight request-scoped i18n helper for FastAPI gateway & alerting."""

from contextvars import ContextVar

_current_lang: ContextVar[str] = ContextVar("current_lang", default="vi")


def normalize_lang(raw: str | None) -> str:
    """Normalize a locale cookie or Accept-Language value into 'vi', 'zh', or 'en'."""
    if not raw:
        return "vi"
    lowered = raw.strip().lower()
    if lowered.startswith("vi"):
        return "vi"
    if lowered.startswith("zh"):
        return "zh"
    if lowered.startswith("en"):
        return "en"
    return "en"


def set_current_lang(lang: str):
    """Set the current request language and return the ContextVar token."""
    return _current_lang.set(normalize_lang(lang))


def reset_current_lang(token) -> None:
    """Reset the ContextVar to its previous value."""
    _current_lang.reset(token)


def get_current_lang() -> str:
    """Return the active language ('vi', 'zh', or 'en')."""
    return _current_lang.get()


def tr(zh: str, en: str, vi: str, lang: str | None = None) -> str:
    """Return the localized string for the active (or explicit) language."""
    active = normalize_lang(lang) if lang is not None else get_current_lang()
    if active == "zh":
        return zh
    if active == "vi":
        return vi
    return en
