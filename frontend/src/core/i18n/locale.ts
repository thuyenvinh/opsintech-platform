export const SUPPORTED_LOCALES = ["en-US", "zh-CN", "ja", "ko", "vi"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en-US";

export function isLocale(value: string): value is Locale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

export function normalizeLocale(locale: string | null | undefined): Locale {
  if (!locale) {
    return DEFAULT_LOCALE;
  }

  if (isLocale(locale)) {
    return locale;
  }

  if (locale.toLowerCase().startsWith("zh")) {
    return "zh-CN";
  }

  if (locale.toLowerCase().startsWith("ja")) {
    return "ja";
  }

  if (locale.toLowerCase().startsWith("ko")) {
    return "ko";
  }

  if (locale.toLowerCase().startsWith("vi")) {
    return "vi";
  }

  return DEFAULT_LOCALE;
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
