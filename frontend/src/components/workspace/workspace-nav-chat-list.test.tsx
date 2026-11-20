import { screen } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

import { renderWithProviders } from "@/test/render";

import { WorkspaceNavChatList } from "./workspace-nav-chat-list";

const mocks = vi.hoisted(() => ({
  usePathname: vi.fn(),
  useSession: vi.fn(),
  useActiveAnnouncements: vi.fn(),
  useCurrentTenant: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: mocks.usePathname,
}));

vi.mock("@/core/auth/hooks", () => ({
  useSession: mocks.useSession,
}));

vi.mock("@/core/announcements", () => ({
  useActiveAnnouncements: mocks.useActiveAnnouncements,
}));

vi.mock("@/core/tenants", () => ({
  useCurrentTenant: mocks.useCurrentTenant,
}));

describe("WorkspaceNavChatList", () => {
  beforeEach(() => {
    mocks.useActiveAnnouncements.mockReturnValue({ announcements: [] });
    mocks.useCurrentTenant.mockReturnValue({ data: { tenant_id: "tenant-a", tenant_type: "ops" } });
  });

  it("points intelligent workspace entry to valid chats route", () => {
    mocks.usePathname.mockReturnValue("/workspace/overview");
    mocks.useSession.mockReturnValue({ data: { user: { role: "user" } } });

    renderWithProviders(<WorkspaceNavChatList />);

    expect(screen.getByRole("link", { name: "智能工作台" })).toHaveAttribute(
      "href",
      "/workspace/chats/new",
    );
  });

  it("shows unread announcement badge on announcements nav item", () => {
    mocks.usePathname.mockReturnValue("/workspace/overview");
    mocks.useSession.mockReturnValue({ data: { user: { role: "user" } } });
    mocks.useActiveAnnouncements.mockReturnValue({
      announcements: [
        { id: 1, read_state: { is_read: false } },
        { id: 2, read_state: { is_read: false } },
        { id: 3, read_state: { is_read: true } },
      ],
    });

    renderWithProviders(<WorkspaceNavChatList />);

    expect(screen.getByText("2")).toBeInTheDocument();
  });
});
