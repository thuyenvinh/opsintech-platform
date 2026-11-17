"use client";

import {
  AlertTriangle,
  Loader2Icon,
  SaveIcon,
  ShieldAlertIcon,
  TerminalIcon,
  Trash2Icon,
} from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { tr } from "@/core/i18n";
import { useI18n } from "@/core/i18n/hooks";
import { isTenantAdminRole } from "@/core/permissions/scope";
import { useCurrentTenant } from "@/core/tenants/hooks";
import {
  useTerminalTenantPolicy,
  useUpdateTerminalTenantPolicy,
  type TerminalPolicyAction,
  type TerminalTenantPolicyUpdate,
} from "@/core/terminal-policy";

const MAX_COMMAND_LENGTH_OPTIONS = [1000, 5000, 10000, 50000];

const AUTO_APPROVAL_ACTIONS: TerminalPolicyAction[] = [
  "readFiles",
  "editFiles",
  "executeSafeCommands",
  "executeAllCommands",
  "autoExecuteReadOnlyCommands",
];

interface PolicyForm {
  pinCommandSecurity: boolean;
  commandSecurity: boolean;
  pinStrictMode: boolean;
  strictMode: boolean;
  pinMaxCommandLength: boolean;
  maxCommandLength: number;
  pinBlacklist: boolean;
  blacklist: string;
  pinWhitelist: boolean;
  whitelist: string;
  pinAutoApprovalEnabled: boolean;
  autoApprovalEnabled: boolean;
  pinnedActions: Record<TerminalPolicyAction, boolean>;
  actions: Record<TerminalPolicyAction, boolean>;
}

const EMPTY_FORM: PolicyForm = {
  pinCommandSecurity: false,
  commandSecurity: true,
  pinStrictMode: false,
  strictMode: false,
  pinMaxCommandLength: false,
  maxCommandLength: 10000,
  pinBlacklist: false,
  blacklist: "",
  pinWhitelist: false,
  whitelist: "",
  pinAutoApprovalEnabled: false,
  autoApprovalEnabled: false,
  pinnedActions: {
    readFiles: false,
    editFiles: false,
    executeSafeCommands: false,
    executeAllCommands: false,
    autoExecuteReadOnlyCommands: false,
  },
  actions: {
    readFiles: true,
    editFiles: false,
    executeSafeCommands: true,
    executeAllCommands: false,
    autoExecuteReadOnlyCommands: false,
  },
};

function toLines(patterns: string[] | undefined) {
  return (patterns ?? []).join("\n");
}

function fromLines(value: string) {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

export function TenantAdminTerminalPolicyPage() {
  const { locale } = useI18n();
  const { data: currentTenant } = useCurrentTenant();
  const isTenantAdmin = isTenantAdminRole(currentTenant?.role);

  const { data: policy, isLoading, error } = useTerminalTenantPolicy();
  const { mutate: savePolicy, isPending: isSaving } = useUpdateTerminalTenantPolicy();

  const [form, setForm] = useState<PolicyForm>(EMPTY_FORM);

  useEffect(() => {
    if (!policy) return;
    const security = policy.security_config ?? {};
    const auto = policy.auto_approval ?? {};
    const pinnedActions = { ...EMPTY_FORM.pinnedActions };
    const actions = { ...EMPTY_FORM.actions };
    for (const action of AUTO_APPROVAL_ACTIONS) {
      const pinned = auto.actions?.[action];
      if (pinned !== undefined) {
        pinnedActions[action] = true;
        actions[action] = pinned;
      }
    }
    setForm({
      pinCommandSecurity: security.enableCommandSecurity !== undefined,
      commandSecurity: security.enableCommandSecurity ?? EMPTY_FORM.commandSecurity,
      pinStrictMode: security.enableStrictMode !== undefined,
      strictMode: security.enableStrictMode ?? EMPTY_FORM.strictMode,
      pinMaxCommandLength: security.maxCommandLength !== undefined,
      maxCommandLength: security.maxCommandLength ?? EMPTY_FORM.maxCommandLength,
      pinBlacklist: security.blacklistPatterns !== undefined,
      blacklist: toLines(security.blacklistPatterns),
      pinWhitelist: security.whitelistPatterns !== undefined,
      whitelist: toLines(security.whitelistPatterns),
      pinAutoApprovalEnabled: auto.enabled !== undefined,
      autoApprovalEnabled: auto.enabled ?? EMPTY_FORM.autoApprovalEnabled,
      pinnedActions,
      actions,
    });
  }, [policy]);

  const buildPayload = (source: PolicyForm): TerminalTenantPolicyUpdate => {
    const payload: TerminalTenantPolicyUpdate = { security_config: {}, auto_approval: {} };
    if (source.pinCommandSecurity) {
      payload.security_config.enableCommandSecurity = source.commandSecurity;
    }
    if (source.pinStrictMode) {
      payload.security_config.enableStrictMode = source.strictMode;
    }
    if (source.pinMaxCommandLength) {
      payload.security_config.maxCommandLength = source.maxCommandLength;
    }
    if (source.pinBlacklist) {
      payload.security_config.blacklistPatterns = fromLines(source.blacklist);
    }
    if (source.pinWhitelist) {
      payload.security_config.whitelistPatterns = fromLines(source.whitelist);
    }
    if (source.pinAutoApprovalEnabled) {
      payload.auto_approval.enabled = source.autoApprovalEnabled;
    }
    const actions: Partial<Record<TerminalPolicyAction, boolean>> = {};
    for (const action of AUTO_APPROVAL_ACTIONS) {
      if (source.pinnedActions[action]) {
        actions[action] = source.actions[action];
      }
    }
    if (Object.keys(actions).length > 0) {
      payload.auto_approval.actions = actions;
    }
    return payload;
  };

  const handleSave = () => savePolicy(buildPayload(form));

  const handleClear = () => {
    if (
      confirm(
        tr(
          locale,
          "确定要移除整个租户终端策略吗？移除后成员将完全按自己的设置执行。",
          "Remove the whole tenant terminal policy? Members will then run entirely on their own settings.",
          "Xóa toàn bộ chính sách terminal của workspace? Thành viên sẽ chạy hoàn toàn theo cài đặt riêng.",
        ),
      )
    ) {
      setForm(EMPTY_FORM);
      savePolicy({ security_config: {}, auto_approval: {} });
    }
  };

  const actionLabel = (action: TerminalPolicyAction) => {
    switch (action) {
      case "readFiles":
        return tr(locale, "自动读取文件", "Auto-read files", "Tự động đọc tệp");
      case "editFiles":
        return tr(locale, "自动编辑文件", "Auto-edit files", "Tự động sửa tệp");
      case "executeSafeCommands":
        return tr(locale, "自动执行安全命令", "Auto-execute safe commands", "Tự động chạy lệnh an toàn");
      case "executeAllCommands":
        return tr(locale, "自动执行所有命令", "Auto-execute ALL commands", "Tự động chạy MỌI lệnh");
      case "autoExecuteReadOnlyCommands":
        return tr(
          locale,
          "首次批准后自动执行只读命令",
          "Auto-run read-only commands after first approval",
          "Tự động chạy lệnh chỉ đọc sau lần duyệt đầu",
        );
    }
  };

  if (!isTenantAdmin) {
    return (
      <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
        {tr(
          locale,
          "只有工作区管理员可以访问此页面。",
          "Only workspace admins can access this page.",
          "Chỉ quản trị viên workspace có thể truy cập trang này.",
        )}
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] rounded-xl border border-zinc-200 dark:border-zinc-800 bg-background/30 p-8">
        <Loader2Icon className="h-10 w-10 animate-spin text-zinc-500" />
        <p className="mt-3 text-sm text-muted-foreground animate-pulse">
          {tr(
            locale,
            "正在载入终端策略...",
            "Loading terminal policy...",
            "Đang tải chính sách terminal...",
          )}
        </p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] rounded-xl border border-dashed border-red-200 dark:border-red-800/50 bg-red-50/5 dark:bg-red-950/5 p-8 text-center">
        <ShieldAlertIcon className="h-12 w-12 text-red-500" />
        <h3 className="mt-4 text-base font-semibold text-zinc-800 dark:text-zinc-200">
          {tr(locale, "策略加载失败", "Failed to load policy", "Tải chính sách thất bại")}
        </h3>
        <p className="mt-2 text-xs text-muted-foreground max-w-sm">
          {error instanceof Error ? error.message : ""}
        </p>
      </div>
    );
  }

  const pinColumnLabel = tr(locale, "强制", "Pinned", "Bắt buộc");

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2.5 text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          <TerminalIcon className="h-6 w-6 text-zinc-800 dark:text-zinc-200" />
          {tr(locale, "终端安全策略", "Terminal Security Policy", "Chính sách bảo mật terminal")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {tr(
            locale,
            "设置工作区的终端安全下限。成员只能把自己的设置调得更严格，不能放松你强制的项。",
            "Set the workspace floor for terminal security. Members may only make their own settings stricter — never looser than what you pin here.",
            "Đặt mức sàn bảo mật terminal cho workspace. Thành viên chỉ có thể siết chặt hơn, không thể nới lỏng những mục bạn bắt buộc.",
          )}
        </p>
      </div>

      <div className="rounded-lg border border-blue-200 dark:border-blue-900/50 bg-blue-50 dark:bg-blue-950/20 p-3">
        <div className="flex items-start gap-2">
          <ShieldAlertIcon className="h-4 w-4 text-blue-600 mt-0.5 shrink-0" />
          <p className="text-xs text-blue-700 dark:text-blue-300">
            {tr(
              locale,
              "只有被标记为“强制”的项会写入策略。黑名单取并集（成员只能新增），白名单取交集（成员只能收窄），开关取逻辑或，长度上限取最小值，自动审批取逻辑与。未强制的项仍由成员自己决定。",
              "Only rows marked as pinned are stored in the policy. Blacklists are unioned (members may only add), whitelists intersected (members may only narrow), switches OR-ed, length limits min-ed, and auto-approval AND-ed. Unpinned rows stay entirely up to the member.",
              "Chỉ các dòng được đánh dấu bắt buộc mới được lưu. Danh sách đen hợp nhất (thành viên chỉ có thể thêm), danh sách trắng giao nhau (chỉ có thể thu hẹp), công tắc dùng OR, giới hạn độ dài lấy nhỏ nhất, tự động phê duyệt dùng AND. Các dòng không bắt buộc vẫn do thành viên tự quyết.",
            )}
          </p>
        </div>
      </div>

      {/* Command security floor */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-background overflow-hidden">
        <div className="p-5 border-b border-zinc-100 dark:border-zinc-900 bg-zinc-50/50 dark:bg-zinc-900/20">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <ShieldAlertIcon className="h-4 w-4 text-zinc-500" />
              <div>
                <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                  {tr(locale, "命令安全下限", "Command Security Floor", "Mức sàn bảo mật lệnh")}
                </h3>
                <p className="text-[11px] mt-0.5 text-muted-foreground">
                  {tr(
                    locale,
                    "强制开启的检查成员无法关闭",
                    "Checks you turn on here cannot be turned off by a member",
                    "Các kiểm tra bạn bật ở đây thành viên không thể tắt",
                  )}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="sm"
                className="h-8 px-3 text-xs text-red-500 hover:text-red-700 hover:bg-red-50 dark:hover:bg-red-950/30"
                onClick={handleClear}
                disabled={isSaving}
              >
                <Trash2Icon className="h-3.5 w-3.5 mr-1" />
                {tr(locale, "移除策略", "Remove policy", "Xóa chính sách")}
              </Button>
              <Button
                className="gap-1.5 h-8 px-3 text-xs"
                onClick={handleSave}
                disabled={isSaving}
              >
                {isSaving ? (
                  <Loader2Icon className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <SaveIcon className="h-3.5 w-3.5" />
                )}
                {tr(locale, "保存", "Save", "Lưu")}
              </Button>
            </div>
          </div>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                {tr(locale, "启用命令安全检查", "Enable Command Security Check", "Bật kiểm tra bảo mật lệnh")}
              </span>
              <p className="text-xs text-muted-foreground mt-0.5">
                {tr(
                  locale,
                  "强制开启后，成员无法关闭服务端的命令检查",
                  "Once pinned on, a member cannot disable server-side command checking",
                  "Khi đã bắt buộc, thành viên không thể tắt kiểm tra lệnh phía máy chủ",
                )}
              </p>
            </div>
            <div className="flex items-center gap-4 shrink-0">
              <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
                {pinColumnLabel}
                <Switch
                  checked={form.pinCommandSecurity}
                  onCheckedChange={(v) => setForm({ ...form, pinCommandSecurity: v })}
                  disabled={isSaving}
                />
              </label>
              <Switch
                checked={form.commandSecurity}
                onCheckedChange={(v) => setForm({ ...form, commandSecurity: v })}
                disabled={isSaving || !form.pinCommandSecurity}
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                {tr(locale, "严格模式", "Strict Mode", "Chế độ nghiêm ngặt")}
              </span>
              <p className="text-xs text-muted-foreground mt-0.5">
                {tr(
                  locale,
                  "仅允许白名单中的命令执行",
                  "Only allow whitelisted commands",
                  "Chỉ cho phép các lệnh trong danh sách trắng",
                )}
              </p>
            </div>
            <div className="flex items-center gap-4 shrink-0">
              <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
                {pinColumnLabel}
                <Switch
                  checked={form.pinStrictMode}
                  onCheckedChange={(v) => setForm({ ...form, pinStrictMode: v })}
                  disabled={isSaving}
                />
              </label>
              <Switch
                checked={form.strictMode}
                onCheckedChange={(v) => setForm({ ...form, strictMode: v })}
                disabled={isSaving || !form.pinStrictMode}
              />
            </div>
          </div>

          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                {tr(locale, "最大命令长度", "Max Command Length", "Độ dài lệnh tối đa")}
              </span>
              <p className="text-xs text-muted-foreground mt-0.5">
                {tr(
                  locale,
                  "成员只能设置更小的值",
                  "A member may only set a smaller value",
                  "Thành viên chỉ có thể đặt giá trị nhỏ hơn",
                )}
              </p>
            </div>
            <div className="flex items-center gap-4 shrink-0">
              <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
                {pinColumnLabel}
                <Switch
                  checked={form.pinMaxCommandLength}
                  onCheckedChange={(v) => setForm({ ...form, pinMaxCommandLength: v })}
                  disabled={isSaving}
                />
              </label>
              <select
                value={form.maxCommandLength}
                onChange={(e) =>
                  setForm({ ...form, maxCommandLength: parseInt(e.target.value) })
                }
                disabled={isSaving || !form.pinMaxCommandLength}
                className="text-xs border border-zinc-200 dark:border-zinc-800 bg-background rounded px-2 py-1 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {MAX_COMMAND_LENGTH_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n.toLocaleString()}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                  {tr(locale, "强制黑名单", "Mandatory Blacklist", "Danh sách đen bắt buộc")}
                </span>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {tr(
                    locale,
                    "每行一条，支持 * 通配符。成员可以再添加，但不能移除这些条目。",
                    "One pattern per line, * wildcard supported. Members may add more but cannot remove these.",
                    "Mỗi dòng một mẫu, hỗ trợ ký tự *. Thành viên có thể thêm nhưng không thể xóa các mục này.",
                  )}
                </p>
              </div>
              <label className="flex items-center gap-2 text-[11px] text-muted-foreground shrink-0">
                {pinColumnLabel}
                <Switch
                  checked={form.pinBlacklist}
                  onCheckedChange={(v) => setForm({ ...form, pinBlacklist: v })}
                  disabled={isSaving}
                />
              </label>
            </div>
            <textarea
              value={form.blacklist}
              onChange={(e) => setForm({ ...form, blacklist: e.target.value })}
              disabled={isSaving || !form.pinBlacklist}
              rows={5}
              spellCheck={false}
              placeholder={"rm -rf /\ncurl * | sh"}
              className="w-full font-mono text-xs border border-zinc-200 dark:border-zinc-800 bg-background rounded px-2 py-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
            />
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                  {tr(locale, "白名单上限", "Whitelist Ceiling", "Giới hạn danh sách trắng")}
                </span>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {tr(
                    locale,
                    "严格模式下的最大允许集合。成员只能收窄，不能加入这里没有的命令。",
                    "The widest allowed set under strict mode. Members may narrow it but cannot add anything absent here.",
                    "Tập hợp cho phép rộng nhất ở chế độ nghiêm ngặt. Thành viên chỉ có thể thu hẹp.",
                  )}
                </p>
              </div>
              <label className="flex items-center gap-2 text-[11px] text-muted-foreground shrink-0">
                {pinColumnLabel}
                <Switch
                  checked={form.pinWhitelist}
                  onCheckedChange={(v) => setForm({ ...form, pinWhitelist: v })}
                  disabled={isSaving}
                />
              </label>
            </div>
            <textarea
              value={form.whitelist}
              onChange={(e) => setForm({ ...form, whitelist: e.target.value })}
              disabled={isSaving || !form.pinWhitelist}
              rows={5}
              spellCheck={false}
              placeholder={"ls\npwd\ncat"}
              className="w-full font-mono text-xs border border-zinc-200 dark:border-zinc-800 bg-background rounded px-2 py-1.5 disabled:opacity-50 disabled:cursor-not-allowed"
            />
          </div>
        </div>
      </div>

      {/* Auto-approval ceiling */}
      <div className="rounded-xl border border-zinc-200 dark:border-zinc-800 bg-background overflow-hidden">
        <div className="p-5 border-b border-zinc-100 dark:border-zinc-900 bg-zinc-50/50 dark:bg-zinc-900/20">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="h-4 w-4 text-zinc-500" />
            <div>
              <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                {tr(locale, "自动审批上限", "Auto-Approval Ceiling", "Giới hạn tự động phê duyệt")}
              </h3>
              <p className="text-[11px] mt-0.5 text-muted-foreground">
                {tr(
                  locale,
                  "关闭即为硬上限：成员无法为自己重新打开",
                  "Pinning one off is a hard ceiling: a member cannot turn it back on for themselves",
                  "Tắt là giới hạn cứng: thành viên không thể tự bật lại",
                )}
              </p>
            </div>
          </div>
        </div>

        <div className="p-5 space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
                {tr(locale, "启用自动审批", "Enable Auto-Approval", "Bật tự động phê duyệt")}
              </span>
              <p className="text-xs text-muted-foreground mt-0.5">
                {tr(
                  locale,
                  "强制关闭后，任何成员的自动审批都不生效",
                  "Pinned off means auto-approval never applies for any member",
                  "Khi bắt buộc tắt, tự động phê duyệt không áp dụng cho bất kỳ thành viên nào",
                )}
              </p>
            </div>
            <div className="flex items-center gap-4 shrink-0">
              <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
                {pinColumnLabel}
                <Switch
                  checked={form.pinAutoApprovalEnabled}
                  onCheckedChange={(v) => setForm({ ...form, pinAutoApprovalEnabled: v })}
                  disabled={isSaving}
                />
              </label>
              <Switch
                checked={form.autoApprovalEnabled}
                onCheckedChange={(v) => setForm({ ...form, autoApprovalEnabled: v })}
                disabled={isSaving || !form.pinAutoApprovalEnabled}
              />
            </div>
          </div>

          {AUTO_APPROVAL_ACTIONS.map((action) => (
            <div key={action} className="flex items-center justify-between gap-4 pl-4">
              <span className="text-sm text-zinc-700 dark:text-zinc-300 min-w-0">
                {actionLabel(action)}
              </span>
              <div className="flex items-center gap-4 shrink-0">
                <label className="flex items-center gap-2 text-[11px] text-muted-foreground">
                  {pinColumnLabel}
                  <Switch
                    checked={form.pinnedActions[action]}
                    onCheckedChange={(v) =>
                      setForm({
                        ...form,
                        pinnedActions: { ...form.pinnedActions, [action]: v },
                      })
                    }
                    disabled={isSaving}
                  />
                </label>
                <Switch
                  checked={form.actions[action]}
                  onCheckedChange={(v) =>
                    setForm({ ...form, actions: { ...form.actions, [action]: v } })
                  }
                  disabled={isSaving || !form.pinnedActions[action]}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      {policy?.updated_at && (
        <p className="text-xs text-muted-foreground">
          {tr(
            locale,
            `最后更新：${new Date(policy.updated_at).toLocaleString()}`,
            `Last updated: ${new Date(policy.updated_at).toLocaleString()}`,
            `Cập nhật lần cuối: ${new Date(policy.updated_at).toLocaleString()}`,
          )}
        </p>
      )}
    </div>
  );
}
