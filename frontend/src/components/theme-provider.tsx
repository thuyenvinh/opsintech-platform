"use client";

import { ThemeProvider as NextThemesProvider } from "next-themes";

// This used to pass forcedTheme={pathname === "/" ? "dark" : undefined}, which
// was the only thing in the app that overrode the stored theme: on that route
// next-themes applies the forced value and the theme picker's clicks have no
// visible effect. It was written for the landing page under components/landing,
// which nothing imports, and "/" redirects unconditionally in app/page.tsx. So
// it protected a page that does not render while being able to ignore the
// user's choice.
export function ThemeProvider({
  children,
  ...props
}: React.ComponentProps<typeof NextThemesProvider>) {
  return <NextThemesProvider {...props}>{children}</NextThemesProvider>;
}
