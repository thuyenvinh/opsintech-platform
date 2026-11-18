"use client";

import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

import type { Locale } from "@/core/i18n";
import { setLocaleInCookie } from "@/core/i18n/cookies";

export interface I18nContextType {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

export const I18nContext = createContext<I18nContextType | null>(null);

export function I18nProvider({
  children,
  initialLocale,
}: {
  children: ReactNode;
  initialLocale: Locale;
}) {
  const [locale, setLocale] = useState<Locale>(initialLocale);

  // Memoized: this is the context's setLocale, and the initializer in
  // useI18n depends on it. Recreated every render, it turned a mount effect
  // into a per-render one.
  //
  // Writing through setLocaleInCookie rather than document.cookie by hand
  // leaves one writer. The hand-rolled line skipped LOCALE_COOKIE_NAME,
  // encodeURIComponent and SameSite, so the two writers could drift apart and
  // the reader would stop finding what the writer stored.
  const handleSetLocale = useCallback((newLocale: Locale) => {
    setLocale(newLocale);
    setLocaleInCookie(newLocale);
  }, []);

  return (
    <I18nContext.Provider value={{ locale, setLocale: handleSetLocale }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18nContext() {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error("useI18n must be used within I18nProvider");
  }
  return context;
}
