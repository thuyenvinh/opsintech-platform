import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, type RenderOptions, type RenderResult } from "@testing-library/react";
import type { ReactElement, ReactNode } from "react";

import type { Locale } from "@/core/i18n";
import { setLocaleInCookie } from "@/core/i18n/cookies";
import { I18nProvider } from "@/core/i18n/context";

/**
 * Locale the component suite is written against.
 *
 * Deliberately NOT `DEFAULT_LOCALE`: the product default is a shipping
 * decision that has already moved once (commit 7f114ae switched it from
 * zh-CN to vi) and will move again. Assertions on UI copy need a locale that
 * only changes when someone edits the tests, so the suite pins one here.
 * Individual tests can override it via `renderWithProviders(ui, { locale })`.
 */
export const TEST_LOCALE: Locale = "zh-CN";

/**
 * A QueryClient with retries and caching off, so a failing query surfaces
 * immediately instead of being retried past the end of the test, and nothing
 * leaks between renders.
 */
export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0, staleTime: 0, refetchOnWindowFocus: false },
      mutations: { retry: false },
    },
  });
}

export interface RenderWithProvidersOptions extends Omit<RenderOptions, "wrapper"> {
  /** Locale to render in. Defaults to {@link TEST_LOCALE}. */
  locale?: Locale;
  /** Reuse a client across renders, e.g. to seed or inspect the cache. */
  queryClient?: QueryClient;
}

export type RenderWithProvidersResult = RenderResult & { queryClient: QueryClient };

/**
 * Renders `ui` inside the providers every client component in this app assumes:
 * a `QueryClientProvider` and an `I18nProvider`.
 *
 * The locale cookie is written first because the app resolves the active
 * locale two ways -- `useI18n()` reads the provider but reconciles it against
 * the cookie on mount, and non-hook helpers such as `scopeLabel()` read the
 * cookie directly through `getActiveLocale()`. Seeding the cookie keeps both
 * paths on the pinned locale; without it the mount effect would immediately
 * switch the tree to the product default.
 */
export function renderWithProviders(
  ui: ReactElement,
  options: RenderWithProvidersOptions = {},
): RenderWithProvidersResult {
  const { locale = TEST_LOCALE, queryClient = createTestQueryClient(), ...renderOptions } = options;

  setLocaleInCookie(locale);

  function Providers({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>
        <I18nProvider initialLocale={locale}>{children}</I18nProvider>
      </QueryClientProvider>
    );
  }

  return {
    ...render(ui, { wrapper: Providers, ...renderOptions }),
    queryClient,
  };
}
