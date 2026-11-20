import { describe, expect, it } from "vitest";

import { setLocaleInCookie } from "@/core/i18n/cookies";

import {
  canManageScopedResource,
  isTenantAdminRole,
  scopeLabel,
} from "./scope";

describe("scope permissions", () => {
  it("isTenantAdminRole only accepts tenant_admin", () => {
    expect(isTenantAdminRole("tenant_admin")).toBe(true);
    expect(isTenantAdminRole("tenant_member")).toBe(false);
    expect(isTenantAdminRole("admin")).toBe(false);
    expect(isTenantAdminRole(undefined)).toBe(false);
  });

  it("canManageScopedResource respects global protection and ownership", () => {
    expect(canManageScopedResource("user", true)).toBe(true);
    expect(canManageScopedResource("tenant", true)).toBe(true);
    expect(canManageScopedResource("global", true)).toBe(false);
    expect(canManageScopedResource("user", false)).toBe(false);
  });

  // scopeLabel resolves its locale through getActiveLocale(), which reads the
  // locale cookie and falls back to the product default. Each case pins the
  // locale explicitly: this test previously asserted Chinese labels while
  // relying on zh-CN being the default, and broke when 7f114ae made
  // Vietnamese the default. Pinning means a future default change cannot
  // silently rewrite what these labels are expected to say.
  it("scopeLabel maps known scopes in Chinese", () => {
    setLocaleInCookie("zh-CN");

    expect(scopeLabel("global")).toBe("平台内置");
    expect(scopeLabel("tenant")).toBe("工作空间共享");
    expect(scopeLabel("user")).toBe("个人私有");
  });

  it("scopeLabel maps known scopes in Vietnamese", () => {
    setLocaleInCookie("vi");

    expect(scopeLabel("global")).toBe("Tích hợp nền tảng");
    expect(scopeLabel("tenant")).toBe("Dùng chung không gian làm việc");
    expect(scopeLabel("user")).toBe("Riêng tư cá nhân");
  });

  it("scopeLabel maps known scopes in English", () => {
    setLocaleInCookie("en-US");

    expect(scopeLabel("global")).toBe("Platform Built-in");
    expect(scopeLabel("tenant")).toBe("Workspace Shared");
    expect(scopeLabel("user")).toBe("Personal Private");
  });

  it("scopeLabel passes through unknown scopes and localises the empty case", () => {
    setLocaleInCookie("zh-CN");
    expect(scopeLabel("something-else")).toBe("something-else");
    expect(scopeLabel(undefined)).toBe("未知");

    setLocaleInCookie("vi");
    expect(scopeLabel(undefined)).toBe("Không rõ");
  });
});
