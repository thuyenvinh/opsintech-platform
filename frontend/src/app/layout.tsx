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
        {/* ThemeProvider sits outside QueryProvider on purpose. QueryProvider
            renders null until it has mounted, so anything nested inside it is
            absent from the server HTML -- including next-themes' blocking
            pre-paint script. With it nested, every hard load painted the light
            palette until hydration finished, and signing out is the one place
            the app forces a hard load, which is why the theme looked forgotten
            at exactly that moment. */}
        {/* defaultTheme is light rather than next-themes' "system" default:
            with no stored choice the app follows the product default, not the
            operating system. enableSystem stays on, so "system" is still one
            of the choices in the appearance settings. */}
        <ThemeProvider
          attribute="class"
          defaultTheme="light"
          enableSystem
          disableTransitionOnChange
        >
          <QueryProvider>
            <I18nProvider initialLocale={locale}>{children}</I18nProvider>
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
