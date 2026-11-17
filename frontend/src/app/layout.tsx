import "@/styles/globals.css";
import "katex/dist/katex.min.css";

import { type Metadata } from "next";

import { QueryProvider } from "@/components/providers/query-provider";
import { ThemeProvider } from "@/components/theme-provider";
import { getPlatformLogo, getPlatformName } from "@/core/config";
import { env } from "@/env";
import { I18nProvider } from "@/core/i18n/context";
import { detectLocaleServer } from "@/core/i18n/server";

export const metadata: Metadata = {
  title: getPlatformName(),
  description: "A LangChain-based framework for building super agents.",
  ...(env.NEXT_PUBLIC_PLATFORM_LOGO?.trim()
    ? { icons: { icon: getPlatformLogo() } }
    : {}),
};

export default async function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const locale = await detectLocaleServer();
  return (
    <html lang={locale} suppressContentEditableWarning suppressHydrationWarning>
      <body suppressHydrationWarning>
        <QueryProvider>
          <ThemeProvider attribute="class" enableSystem disableTransitionOnChange>
            <I18nProvider initialLocale={locale}>{children}</I18nProvider>
          </ThemeProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
