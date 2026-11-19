import { env } from "@/env";

export const SUPPORTED_LOCALES = ["en-US", "zh-CN", "ja", "ko", "vi"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
// Vietnamese is the product default, and the gateway already assumes it
// (backend/app/gateway/i18n.py defaults its locale ContextVar to "vi").
export const DEFAULT_LOCALE: Locale = "vi";

export function isLocale(value: string): value is Locale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

function parseLocaleToken(token: string): Locale | null {
  const trimmed = token.trim();
  if (!trimmed) return null;
  if (isLocale(trimmed)) return trimmed;
  const lower = trimmed.toLowerCase();
  if (lower.startsWith("en")) return "en-US";
  if (lower.startsWith("zh")) return "zh-CN";
  if (lower.startsWith("ja")) return "ja";
  if (lower.startsWith("ko")) return "ko";
  if (lower.startsWith("vi")) return "vi";
  return null;
}

export function getEnabledLocales(): Locale[] {
  const raw = env.NEXT_PUBLIC_SUPPORTED_LOCALES?.trim();
  if (!raw) {
    return [...SUPPORTED_LOCALES];
  }
  const parsed: Locale[] = [];
  for (const part of raw.split(",")) {
    const loc = parseLocaleToken(part);
    if (loc && !parsed.includes(loc)) {
      parsed.push(loc);
    }
  }
  return parsed.length > 0 ? parsed : [...SUPPORTED_LOCALES];
}

export function getDefaultLocale(): Locale {
  const enabled = getEnabledLocales();
  return enabled.includes(DEFAULT_LOCALE) ? DEFAULT_LOCALE : (enabled[0] ?? DEFAULT_LOCALE);
}

export function normalizeLocale(locale: string | null | undefined): Locale {
  const enabled = getEnabledLocales();
  const fallback = getDefaultLocale();
  if (!locale) {
    return fallback;
  }

  const candidate = parseLocaleToken(locale);
  if (candidate && enabled.includes(candidate)) {
    return candidate;
  }

  return fallback;
}

// There is deliberately no browser-language detection. It used to decide the
// UI language whenever the cookie was missing, so on an English machine the
// app came up in English no matter what the product default said -- and any
// single loss of the cookie looked like "my language was forgotten".
export function getActiveLocale(): Locale {
  if (typeof document !== "undefined") {
    const match = document.cookie.match(/(?:^|;\s*)locale=([^;]*)/);
    if (match?.[1]) {
      return normalizeLocale(decodeURIComponent(match[1]));
    }
    return getDefaultLocale();
  }
  return getDefaultLocale();
}

export function tr(
  locale: Locale | string | null | undefined,
  zh: string,
  en: string,
  vi: string,
): string {
  if (locale === "vi") return vi;
  if (locale?.toLowerCase().startsWith("zh")) return zh;
  return en;
}
