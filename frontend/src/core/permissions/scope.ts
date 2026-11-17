import { getActiveLocale, tr } from "@/core/i18n";

export function isTenantAdminRole(role?: string | null): boolean {
  return (role ?? "").toLowerCase() === "tenant_admin";
}

export function canManageScopedResource(
  scope: string | undefined,
  managedByCurrentUser: boolean | undefined,
): boolean {
  return scope !== "global" && managedByCurrentUser === true;
}

export function scopeLabel(scope: string | undefined): string {
  const locale = getActiveLocale();
  if (scope === "global") return tr(locale, "平台内置", "Platform Built-in", "Tích hợp nền tảng");
  if (scope === "tenant") return tr(locale, "工作空间共享", "Workspace Shared", "Dùng chung không gian làm việc");
  if (scope === "user") return tr(locale, "个人私有", "Personal Private", "Riêng tư cá nhân");
  return scope ?? tr(locale, "未知", "Unknown", "Không rõ");
}
