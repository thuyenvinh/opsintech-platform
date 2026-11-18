"use client";

import { useEffect } from "react";

import { useI18nContext } from "./context";
import { getLocaleFromCookie } from "./cookies";
import { enUS } from "./locales/en-US";
import { zhCN } from "./locales/zh-CN";
import { ja } from "./locales/ja";
import { ko } from "./locales/ko";
import { vi } from "./locales/vi";

import {
  DEFAULT_LOCALE,
  detectLocale,
  getEnabledLocales,
  normalizeLocale,
  type Locale,
  type Translations,
} from "./index";

const translations: Record<Locale, Translations> = {
  "en-US": enUS,
  "zh-CN": zhCN,
  ja,
  ko,
  vi,
};

export function useI18n() {
  const { locale, setLocale } = useI18nContext();

  const t = translations[locale] ?? translations[DEFAULT_LOCALE];

  const changeLocale = (newLocale: Locale) => {
    if (!getEnabledLocales().includes(newLocale)) {
      return;
    }
    // setLocale persists through setLocaleInCookie, so the write that used
    // to sit here was the second of two, with different attributes.
    setLocale(newLocale);
  };

  // Initialize locale on mount. The server already resolved the locale from
  // the same cookie, so this is normally a no-op; it exists for the case where
  // the cookie changed after the page was rendered.
  useEffect(() => {
    const saved = getLocaleFromCookie();
    if (saved) {
      const normalizedSaved = normalizeLocale(saved);
      // Correct the value in memory only. This used to persist the normalized
      // value, and normalizeLocale returns the default for anything the
      // build's enabled set does not recognise -- so a stored choice that this
      // build cannot render was overwritten rather than merely ignored, and
      // was then unrecoverable even after the locale was enabled again.
      if (normalizedSaved !== locale) {
        setLocale(normalizedSaved);
      }
      return;
    }

    // No stored choice yet: fall back to the browser's language and keep it,
    // so the server renders the same thing on the next load. This cannot
    // destroy a choice, because there is none.
    const detected = detectLocale();
    if (detected !== locale) {
      setLocale(detected);
    }
  }, [locale, setLocale]);

  return {
    locale,
    t,
    changeLocale,
  };
}
