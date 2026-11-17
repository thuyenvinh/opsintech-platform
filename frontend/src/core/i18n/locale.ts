import { env } from "@/env";

export const SUPPORTED_LOCALES = ["en-US", "zh-CN", "ja", "ko", "vi"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en-US";

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

// Helper function to detect browser locale
export function detectLocale(): Locale {
  if (typeof window === "undefined") {
    return DEFAULT_LOCALE;
  }

  const browserLang =
    navigator.language ||
    (navigator as unknown as { userLanguage: string }).userLanguage;

  return normalizeLocale(browserLang);
}

export function getActiveLocale(): Locale {
  if (typeof document !== "undefined") {
    const match = document.cookie.match(/(?:^|;\s*)locale=([^;]*)/);
    if (match?.[1]) {
      return normalizeLocale(decodeURIComponent(match[1]));
    }
    return detectLocale();
  }
  return DEFAULT_LOCALE;
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
