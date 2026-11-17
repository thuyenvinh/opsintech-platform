"use client";

import { Trash2Icon, UserPlusIcon, UsersIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { tr } from "@/core/i18n";
import { useI18n } from "@/core/i18n/hooks";
import { isTenantAdminRole } from "@/core/permissions/scope";
import type { TenantMemberRole } from "@/core/tenants/api";
import {
  useCurrentTenant,
  useAddTenantMember,
  useRemoveTenantMember,
  useTenantMembers,
  useUpdateTenantMemberRole,
  useUpdateTenantMemberStatus,
} from "@/core/tenants/hooks";

import { SettingsSection } from "./settings-section";

export function TenantGovernanceSettingsPage() {
  const { locale } = useI18n();
  const { data: currentTenant } = useCurrentTenant();
  const isTenantAdmin = isTenantAdminRole(currentTenant?.role);
  const { data: members = [], isLoading, error } = useTenantMembers({
    enabled: isTenantAdmin,
  });

  const { mutateAsync: addMember, isPending: adding } = useAddTenantMember();
  const { mutateAsync: updateRole } = useUpdateTenantMemberRole();
  const { mutateAsync: updateStatus } = useUpdateTenantMemberStatus();
  const { mutateAsync: removeMember } = useRemoveTenantMember();

  const [newUserId, setNewUserId] = useState("");
  const [newRole, setNewRole] = useState<TenantMemberRole>("tenant_member");

  const handleAdd = async () => {
    if (!newUserId.trim()) {
      toast.error(tr(locale, "请输入要添加的用户 ID", "Please enter a user ID to add", "Vui lòng nhập ID người dùng cần thêm"));
      return;
    }
    try {
      await addMember({ user_id: newUserId.trim(), role: newRole });
      toast.success(tr(locale, "成员已添加", "Member added", "Đã thêm thành viên"));
      setNewUserId("");
      setNewRole("tenant_member");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tr(locale, "添加成员失败", "Failed to add member", "Thêm thành viên thất bại"));
    }
  };

  const handleRoleChange = async (userId: string, role: TenantMemberRole) => {
    try {
      await updateRole({ userId, role });
      toast.success(tr(locale, "成员角色已更新", "Member role updated", "Đã cập nhật vai trò thành viên"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tr(locale, "更新角色失败", "Failed to update role", "Cập nhật vai trò thất bại"));
    }
  };

  const handleRemove = async (userId: string) => {
    if (!confirm(tr(locale, `确认移除成员 ${userId} ?`, `Confirm removing member ${userId}?`, `Xác nhận gỡ thành viên ${userId}?`))) return;
    try {
      await removeMember(userId);
      toast.success(tr(locale, "成员已移除", "Member removed", "Đã gỡ thành viên"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tr(locale, "移除成员失败", "Failed to remove member", "Gỡ thành viên thất bại"));
    }
  };

  const handleStatusToggle = async (userId: string, nextStatus: "active" | "inactive") => {
    try {
      await updateStatus({ userId, status: nextStatus });
      toast.success(
        nextStatus === "active"
          ? tr(locale, "成员已启用", "Member activated", "Đã kích hoạt thành viên")
          : tr(locale, "成员已停用", "Member deactivated", "Đã vô hiệu hóa thành viên")
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tr(locale, "更新成员状态失败", "Failed to update member status", "Cập nhật trạng thái thành viên thất bại"));
    }
  };

  return (
    <SettingsSection
      title={tr(locale, "工作空间治理", "Workspace Governance", "Quản trị không gian làm việc")}
      description={tr(
        locale,
        "工作空间管理员可在此管理当前工作空间成员。平台管理员不承担工作空间日常成员运营。",
        "Workspace admins can manage current workspace members here. Platform admins do not manage daily workspace member operations.",
        "Quản trị viên không gian làm việc có thể quản lý thành viên tại đây. Quản trị viên nền tảng không trực tiếp vận hành thành viên hàng ngày."
      )}
      action={
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <UsersIcon className="h-4 w-4" />
          {tr(locale, "当前角色", "Current Role", "Vai trò hiện tại")}: {(currentTenant?.role ?? "tenant_member").toUpperCase()}
        </div>
      }
    >
      {!isTenantAdmin ? (
        <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
          {tr(locale, "仅工作空间管理员可访问该页面。", "Only workspace admins can access this page.", "Chỉ quản trị viên không gian làm việc mới có thể truy cập trang này.")}
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 rounded-lg border p-4 md:grid-cols-[1fr_180px_auto]">
            <Input
              placeholder={tr(locale, "输入要添加的用户 ID", "Enter user ID to add", "Nhập ID người dùng cần thêm")}
              value={newUserId}
              onChange={(e) => setNewUserId(e.target.value)}
              disabled={adding}
            />
            <Select
              value={newRole}
              onValueChange={(value: TenantMemberRole) => setNewRole(value)}
              disabled={adding}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="tenant_member">tenant_member</SelectItem>
                <SelectItem value="tenant_admin">tenant_admin</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={() => void handleAdd()} disabled={adding || !newUserId.trim()}>
              <UserPlusIcon className="mr-2 h-4 w-4" />
              {tr(locale, "添加成员", "Add Member", "Thêm thành viên")}
            </Button>
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
                  <th className="px-4 py-2 font-medium">{tr(locale, "成员", "Member", "Thành viên")}</th>
                  <th className="px-4 py-2 font-medium">{tr(locale, "角色", "Role", "Vai trò")}</th>
                  <th className="px-4 py-2 font-medium">{tr(locale, "状态", "Status", "Trạng thái")}</th>
                  <th className="px-4 py-2 text-right font-medium">{tr(locale, "操作", "Actions", "Thao tác")}</th>
                </tr>
              </thead>
              <tbody>
                {isLoading ? (
                  <tr>
                    <td className="px-4 py-6 text-muted-foreground" colSpan={4}>
                      {tr(locale, "加载中...", "Loading...", "Đang tải...")}
                    </td>
                  </tr>
                ) : members.length === 0 ? (
                  <tr>
                    <td className="px-4 py-6 text-muted-foreground" colSpan={4}>
                      {tr(locale, "当前工作空间暂无成员", "No members in current workspace", "Chưa có thành viên trong không gian làm việc này")}
                    </td>
                  </tr>
                ) : (
                  members.map((member) => {
                    const label = member.name ?? member.email ?? member.user_id;
                    return (
                      <tr key={member.user_id} className="border-t">
                        <td className="px-4 py-3">
                          <div className="font-medium">{label}</div>
                          <div className="text-xs text-muted-foreground">{member.user_id}</div>
                        </td>
                        <td className="px-4 py-3">
                          <Select
                            value={member.role === "tenant_admin" ? "tenant_admin" : "tenant_member"}
                            onValueChange={(value: TenantMemberRole) =>
                              void handleRoleChange(member.user_id, value)
                            }
                            disabled={member.status !== "active"}
                          >
                            <SelectTrigger className="w-[170px]">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="tenant_member">tenant_member</SelectItem>
                              <SelectItem value="tenant_admin">tenant_admin</SelectItem>
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="px-4 py-3">
                          <span
                            className={
                              member.status === "active"
                                ? "text-emerald-600"
                                : "text-amber-600"
                            }
                          >
                            {member.status === "active" ? "active" : "inactive"}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex justify-end gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() =>
                                void handleStatusToggle(
                                  member.user_id,
                                  member.status === "active" ? "inactive" : "active",
                                )
                              }
                            >
                              {member.status === "active"
                                ? tr(locale, "停用", "Deactivate", "Vô hiệu hóa")
                                : tr(locale, "启用", "Activate", "Kích hoạt")}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                              onClick={() => void handleRemove(member.user_id)}
                            >
                              <Trash2Icon className="mr-1 h-4 w-4" />
                              {tr(locale, "移除", "Remove", "Gỡ bỏ")}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </SettingsSection>
  );
}
