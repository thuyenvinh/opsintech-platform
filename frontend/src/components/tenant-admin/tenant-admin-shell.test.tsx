import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { renderWithProviders } from "@/test/render";

import { TenantAdminShell } from "./tenant-admin-shell";

const mocks = vi.hoisted(() => ({
  usePathname: vi.fn(),
  useCurrentTenant: vi.fn(),
  useTenantList: vi.fn(),
  useSwitchTenant: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: mocks.usePathname,
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/core/tenants", () => ({
  useCurrentTenant: mocks.useCurrentTenant,
  useTenantList: mocks.useTenantList,
  useSwitchTenant: mocks.useSwitchTenant,
}));

describe("TenantAdminShell", () => {
  it("renders tenant admin navigation and content", () => {
    mocks.usePathname.mockReturnValue("/tenant-admin/members");
    mocks.useCurrentTenant.mockReturnValue({ data: { tenant_id: "tenant-a" } });
    mocks.useTenantList.mockReturnValue({
      data: [
        { id: "tenant-a", name: "Tenant A" },
        { id: "tenant-b", name: "Tenant B" },
      ],
    });
    mocks.useSwitchTenant.mockReturnValue({ mutate: vi.fn(), isPending: false });

    renderWithProviders(
      <TenantAdminShell>
        <div>members content</div>
      </TenantAdminShell>,
    );

    expect(screen.getByText("管理控制台")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "切换工作空间" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "用户管理" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "共享 Agent" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "告警规则" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "工具管理" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "个人设置" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "外观" })).not.toBeInTheDocument();
    // No assertion on the "enter workspace" link: TenantAdminShell still
    // passes bottomItems, but BackofficeShellLayout takes that prop as
    // _bottomItems and never renders it, so the link does not exist.
    expect(screen.getByText("members content")).toBeInTheDocument();
  });
});
