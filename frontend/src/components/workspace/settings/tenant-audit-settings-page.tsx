"use client";

import { useMemo, useState } from "react";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { tr } from "@/core/i18n";
import { useI18n } from "@/core/i18n/hooks";
import { isTenantAdminRole } from "@/core/permissions/scope";
import type { TenantAuditScope } from "@/core/tenants/api";
import { useCurrentTenant, useTenantAuditLogs } from "@/core/tenants/hooks";

import { SettingsSection } from "./settings-section";

export function TenantAuditSettingsPage() {
  const { locale } = useI18n();
  const { data: currentTenant } = useCurrentTenant();
  const isTenantAdmin = isTenantAdminRole(currentTenant?.role);
  const [scope, setScope] = useState<"all" | TenantAuditScope>("all");

  const scopeOptions: Array<{ value: "all" | TenantAuditScope; label: string }> = [
    { value: "all", label: tr(locale, "全部", "All", "Tất cả") },
    { value: "tenant", label: "tenant" },
    { value: "user", label: "user" },
  ];

  const selectedScope = useMemo<TenantAuditScope | undefined>(
    () => (scope === "all" ? undefined : scope),
    [scope],
  );

  const { data, isLoading, error } = useTenantAuditLogs({
    enabled: isTenantAdmin,
    limit: 100,
    scope: selectedScope,
  });

  return (
    <SettingsSection
      title={tr(locale, "工作空间业务审计", "Workspace Business Audit", "Kiểm toán nghiệp vụ không gian làm việc")}
      description={tr(
        locale,
        "仅当前工作空间 tenant_admin 可查看本工作空间审计事件；平台审计与工作空间业务审计严格隔离。",
        "Only current workspace tenant_admin can view workspace audit events; platform and workspace audits are strictly isolated.",
        "Chỉ quản trị viên (tenant_admin) của không gian làm việc hiện tại mới có thể xem sự kiện kiểm toán; kiểm toán nền tảng và không gian làm việc được tách biệt hoàn toàn."
      )}
    >
      {!isTenantAdmin ? (
        <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          {tr(locale, "仅工作空间管理员可访问该页面。", "Only workspace admins can access this page.", "Chỉ quản trị viên không gian làm việc mới có thể truy cập trang này.")}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <span className="text-sm text-muted-foreground">{tr(locale, "范围过滤", "Scope Filter", "Lọc phạm vi")}</span>
            <Select value={scope} onValueChange={(value: "all" | TenantAuditScope) => setScope(value)}>
              <SelectTrigger className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {scopeOptions.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {error && (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
              {error.message}
            </div>
          )}

          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-left text-sm">
              <thead className="border-b bg-muted/30 text-muted-foreground">
                <tr>
                  <th className="px-4 py-2 font-medium">{tr(locale, "时间", "Time", "Thời gian")}</th>
                  <th className="px-4 py-2 font-medium">{tr(locale, "事件", "Event", "Sự kiện")}</th>
                  <th className="px-4 py-2 font-medium">{tr(locale, "范围", "Scope", "Phạm vi")}</th>
                  <th className="px-4 py-2 font-medium">{tr(locale, "操作者", "Actor", "Người thực hiện")}</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td className="px-4 py-6 text-muted-foreground" colSpan={4}>
                      {tr(locale, "加载中...", "Loading...", "Đang tải...")}
                    </td>
                  </tr>
                ) : (data?.events ?? []).length === 0 ? (
                  <tr>
                    <td className="px-4 py-6 text-muted-foreground" colSpan={4}>
                      {tr(locale, "当前筛选条件下暂无审计事件", "No audit events under current filter", "Không có sự kiện kiểm toán nào theo bộ lọc hiện tại")}
                    </td>
                  </tr>
                ) : (
                  (data?.events ?? []).map((event) => (
                    <tr key={`${event.ts}-${event.event_type}`} className="border-t">
                      <td className="px-4 py-3">{event.ts}</td>
                      <td className="px-4 py-3">{event.event_type}</td>
                      <td className="px-4 py-3">{event.scope ?? "unknown"}</td>
                      <td className="px-4 py-3">{event.actor_id ?? "system"}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </SettingsSection>
  );
}
