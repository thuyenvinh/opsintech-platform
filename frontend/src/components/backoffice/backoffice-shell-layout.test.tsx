import { screen } from "@testing-library/react";
import { ShieldCheck } from "lucide-react";
import { describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "@/test/render";

import { BackofficeShellLayout } from "./backoffice-shell-layout";

const mocks = vi.hoisted(() => ({
  usePathname: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: mocks.usePathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

describe("BackofficeShellLayout", () => {
  it("renders unified sidebar width and main container classes", () => {
    mocks.usePathname.mockReturnValue("/admin");

    const navItems = [
      { href: "/admin", label: "总览", icon: ShieldCheck },
      { href: "/admin/users", label: "用户管理", icon: ShieldCheck },
    ];

    renderWithProviders(
      <BackofficeShellLayout
        moduleTitle="平台管理"
        moduleDescription="平台级治理"
        moduleIcon={ShieldCheck}
        navItems={navItems}
        bottomItems={[{ href: "/admin/security", label: "安全与设置", icon: ShieldCheck }]}
      >
        <div>content</div>
      </BackofficeShellLayout>,
    );

    expect(screen.getByText("平台管理")).toBeInTheDocument();
    expect(screen.getByText("平台级治理")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "总览" })).toBeInTheDocument();

    const sidebar = screen.getByText("平台管理").closest("aside");
    expect(sidebar).toHaveClass("w-[240px]");

    const content = screen.getByText("content");
    // The layout wraps children in "w-full px-6 py-6"; the old
    // max-w-7xl container it used to assert is no longer there.
    expect(content.closest("div.w-full")).toBeTruthy();
  });
});
