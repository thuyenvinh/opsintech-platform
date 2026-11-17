'use client';

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import {
  Shield,
  Settings2,
  X,
  Download,
  Upload,
  RotateCcw,
  AlertTriangle,
  Lock,
} from 'lucide-react';
import { useEffect } from 'react';
import { fetchAuthApi } from '@/core/api/auth-client';
import {
  getTerminalTenantPolicy,
  type TerminalPolicyAction,
  type TerminalTenantPolicy,
} from '@/core/terminal-policy/api';
import {
  DEFAULT_SECURITY_CONFIG,
  type SecurityConfig,
} from './security-config';
import {
  DEFAULT_AUTO_APPROVAL,
  type AutoApprovalSettings,
} from './auto-approval-settings';
import { tr } from '@/core/i18n';
import { useI18n } from '@/core/i18n/hooks';

interface SecuritySettingsPanelProps {
  open: boolean;
  onClose: () => void;
}

const EMPTY_TENANT_POLICY: TerminalTenantPolicy = {
  security_config: {},
  auto_approval: {},
};

const MAX_COMMAND_LENGTH_OPTIONS = [1000, 5000, 10000, 50000];

export function SecuritySettingsPanel({ open, onClose }: SecuritySettingsPanelProps) {
  const { locale } = useI18n();
  const [securityConfig, setSecurityConfig] = useState<SecurityConfig>(DEFAULT_SECURITY_CONFIG);
  const [autoSettings, setAutoSettings] = useState<AutoApprovalSettings>(DEFAULT_AUTO_APPROVAL);
  const [tenantPolicy, setTenantPolicy] = useState<TerminalTenantPolicy>(EMPTY_TENANT_POLICY);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) {
      setLoading(true);
      fetchAuthApi('/api/v1/terminal/security-settings')
        .then((res) => {
          if (!res.ok) throw new Error('Failed to load settings');
          return res.json();
        })
        .then((data) => {
          if (data.security_config) {
            setSecurityConfig(data.security_config);
          }
          if (data.auto_approval) {
            setAutoSettings(data.auto_approval);
          }
        })
        .catch((err) => console.error('Failed to load security settings', err))
        .finally(() => setLoading(false));

      getTerminalTenantPolicy()
        .then(setTenantPolicy)
        .catch((err) => console.error('Failed to load tenant terminal policy', err));
    }
  }, [open]);

  if (!open) return null;

  // Keys the workspace admin pinned. Only pins that actually remove a choice
  // lock the control: a pinned-on switch can only be loosened from here, while
  // a pinned-off auto-approval action can only be loosened. Anything the member
  // can still tighten stays editable.
  const pinnedSecurity = tenantPolicy.security_config ?? {};
  const pinnedAuto = tenantPolicy.auto_approval ?? {};
  const pinnedActions = pinnedAuto.actions ?? {};
  const lockCommandSecurity = pinnedSecurity.enableCommandSecurity === true;
  const lockStrictMode = pinnedSecurity.enableStrictMode === true;
  const lockAutoApproval = pinnedAuto.enabled === false;
  const isActionLocked = (action: TerminalPolicyAction) => pinnedActions[action] === false;
  const maxLengthCeiling = pinnedSecurity.maxCommandLength;
  const effectiveMaxLength =
    maxLengthCeiling === undefined
      ? securityConfig.maxCommandLength
      : Math.min(securityConfig.maxCommandLength, maxLengthCeiling);
  const pinnedBlacklist = pinnedSecurity.blacklistPatterns ?? [];
  const pinnedWhitelist = pinnedSecurity.whitelistPatterns;
  const hasTenantPolicy =
    Object.keys(pinnedSecurity).length > 0 || Object.keys(pinnedAuto).length > 0;

  const lockHint = (
    <p className="flex items-center gap-1 text-xs text-zinc-500 mt-0.5">
      <Lock className="w-3 h-3 shrink-0" />
      {tr(locale, '由工作区策略锁定', 'Locked by workspace policy', 'Bị khóa bởi chính sách workspace')}
    </p>
  );

  const saveSettings = async (cfg: SecurityConfig, auto: AutoApprovalSettings) => {
    try {
      const res = await fetchAuthApi('/api/v1/terminal/security-settings', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          security_config: cfg,
          auto_approval: auto,
        }),
      });
      if (!res.ok) {
        console.error('Failed to save settings:', res.statusText);
      }
    } catch (err) {
      console.error('Failed to save settings:', err);
    }
  };

  const updateSecurity = (updates: Partial<SecurityConfig>) => {
    setSecurityConfig((prev) => {
      const next = {
        ...prev,
        ...updates,
        securityPolicy: updates.securityPolicy
          ? { ...prev.securityPolicy, ...updates.securityPolicy }
          : prev.securityPolicy,
      };
      saveSettings(next, autoSettings);
      return next;
    });
  };

  const updateAuto = (updates: Partial<AutoApprovalSettings>) => {
    setAutoSettings((prev) => {
      const next = {
        ...prev,
        ...updates,
        actions: updates.actions
          ? { ...prev.actions, ...updates.actions }
          : prev.actions,
      };
      saveSettings(securityConfig, next);
      return next;
    });
  };

  const handleExport = () => {
    const json = JSON.stringify({ security_config: securityConfig, auto_approval: autoSettings }, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'opsintech-security-config.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImport = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e: any) => {
      const file = e.target?.files?.[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          const parsed = JSON.parse(reader.result as string);
          if (parsed.security_config && parsed.auto_approval) {
            setSecurityConfig(parsed.security_config);
            setAutoSettings(parsed.auto_approval);
            await saveSettings(parsed.security_config, parsed.auto_approval);
          } else {
            alert(tr(locale, '无效的配置文件格式', 'Invalid configuration file format', 'Định dạng tệp cấu hình không hợp lệ'));
          }
        } catch {
          alert(tr(locale, '无效的配置文件格式', 'Invalid configuration file format', 'Định dạng tệp cấu hình không hợp lệ'));
        }
      };
      reader.readAsText(file);
    };
    input.click();
  };

  const handleReset = async () => {
    if (confirm(tr(locale, '确定要恢复默认安全配置吗？', 'Reset security settings to default?', 'Khôi phục cài đặt bảo mật về mặc định?'))) {
      try {
        const res = await fetchAuthApi('/api/v1/terminal/security-settings/reset', {
          method: 'POST',
        });
        if (res.ok) {
          const data = await res.json();
          if (data.security_config) setSecurityConfig(data.security_config);
          if (data.auto_approval) setAutoSettings(data.auto_approval);
        }
      } catch (err) {
        console.error('Failed to reset settings:', err);
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-end">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/20" onClick={onClose} />

      {/* Panel */}
      <div className="relative w-[420px] h-full bg-white shadow-2xl border-l border-zinc-200 overflow-y-auto">
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-zinc-200 px-5 py-3 flex items-center justify-between z-10">
          <div className="flex items-center gap-2">
            <Shield className="w-4 h-4 text-blue-600" />
            <h2 className="font-semibold text-sm text-zinc-900">
              {tr(locale, '安全与自动审批设置', 'Security & Auto-Approval Settings', 'Cài đặt bảo mật & tự động phê duyệt')}
            </h2>
          </div>
          <button onClick={onClose} className="text-zinc-400 hover:text-zinc-600">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-5 space-y-6">
          <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
            <div className="flex items-start gap-2">
              <Shield className="w-4 h-4 text-blue-600 mt-0.5 shrink-0" />
              <p className="text-xs text-blue-700">
                {tr(locale, '命令执行以服务端安全策略为准。本页配置用于本地偏好和后续策略同步展示，危险操作仍会由服务端拦截或要求确认。', 'Server-side security policies always take precedence. Dangerous commands will still be blocked or require confirmation.', 'Chính sách bảo mật phía máy chủ luôn được ưu tiên. Các lệnh nguy hiểm vẫn sẽ bị chặn hoặc yêu cầu xác nhận.')}
              </p>
            </div>
          </div>

          {hasTenantPolicy && (
            <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
              <div className="flex items-start gap-2">
                <Lock className="w-4 h-4 text-zinc-500 mt-0.5 shrink-0" />
                <div className="space-y-1.5 text-xs text-zinc-600">
                  <p>
                    {tr(locale, '工作区管理员已为终端设置了安全下限。被锁定的项只能由管理员放松，其余项你仍可以调得更严格。', 'Your workspace admin has set a security floor for the terminal. Locked rows can only be loosened by an admin; everything else you can still make stricter.', 'Quản trị viên workspace đã đặt mức sàn bảo mật cho terminal. Các mục bị khóa chỉ quản trị viên mới nới lỏng được; các mục khác bạn vẫn có thể siết chặt hơn.')}
                  </p>
                  {pinnedBlacklist.length > 0 && (
                    <p>
                      {tr(locale, `强制黑名单（无法移除）：${pinnedBlacklist.join('、')}`, `Mandatory blacklist (cannot be removed): ${pinnedBlacklist.join(', ')}`, `Danh sách đen bắt buộc (không thể xóa): ${pinnedBlacklist.join(', ')}`)}
                    </p>
                  )}
                  {pinnedWhitelist !== undefined && (
                    <p>
                      {tr(locale, `严格模式白名单上限：${pinnedWhitelist.join('、') || '（空）'}`, `Strict-mode whitelist ceiling: ${pinnedWhitelist.join(', ') || '(empty)'}`, `Giới hạn danh sách trắng chế độ nghiêm ngặt: ${pinnedWhitelist.join(', ') || '(trống)'}`)}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ============================================
              Section 1: Command Security
              ============================================ */}
          <section>
            <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">
              {tr(locale, '命令安全', 'Command Security', 'Bảo mật lệnh')}
            </h3>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm font-medium text-zinc-800">{tr(locale, '启用命令安全检查', 'Enable Command Security Check', 'Bật kiểm tra bảo mật lệnh')}</span>
                  <p className="text-xs text-zinc-400 mt-0.5">{tr(locale, '在执行命令前进行安全验证', 'Validate commands before execution', 'Xác thực an toàn trước khi thực thi lệnh')}</p>
                  {lockCommandSecurity && lockHint}
                </div>
                <Switch
                  checked={lockCommandSecurity ? true : securityConfig.enableCommandSecurity}
                  onCheckedChange={(v) => updateSecurity({ enableCommandSecurity: v })}
                  disabled={lockCommandSecurity}
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm font-medium text-zinc-800">{tr(locale, '严格模式', 'Strict Mode', 'Chế độ nghiêm ngặt')}</span>
                  <p className="text-xs text-zinc-400 mt-0.5">{tr(locale, '仅允许白名单中的命令执行', 'Only allow whitelisted commands', 'Chỉ cho phép các lệnh trong danh sách trắng')}</p>
                  {lockStrictMode && lockHint}
                </div>
                <Switch
                  checked={lockStrictMode ? true : securityConfig.enableStrictMode}
                  onCheckedChange={(v) => updateSecurity({ enableStrictMode: v })}
                  disabled={lockStrictMode}
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm font-medium text-zinc-800">{tr(locale, '高危命令：询问用户', 'High-Risk Commands: Ask User', 'Lệnh rủi ro cao: Hỏi người dùng')}</span>
                  <p className="text-xs text-zinc-400 mt-0.5">{tr(locale, 'systemctl, chmod, chown 等高危命令', 'High-risk commands like systemctl, chmod, chown', 'Các lệnh rủi ro cao như systemctl, chmod, chown')}</p>
                </div>
                <Switch
                  checked={securityConfig.securityPolicy.askForHigh}
                  onCheckedChange={(v) =>
                    updateSecurity({ securityPolicy: { ...securityConfig.securityPolicy, askForHigh: v } })
                  }
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm font-medium text-zinc-800">{tr(locale, '中危命令：询问用户', 'Medium-Risk Commands: Ask User', 'Lệnh rủi ro trung bình: Hỏi người dùng')}</span>
                  <p className="text-xs text-zinc-400 mt-0.5">{tr(locale, 'iptables, sudo, su 等中危命令', 'Medium-risk commands like iptables, sudo, su', 'Các lệnh trung bình như iptables, sudo, su')}</p>
                </div>
                <Switch
                  checked={securityConfig.securityPolicy.askForMedium}
                  onCheckedChange={(v) =>
                    updateSecurity({ securityPolicy: { ...securityConfig.securityPolicy, askForMedium: v } })
                  }
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm font-medium text-zinc-800">{tr(locale, '最大命令长度', 'Max Command Length', 'Độ dài lệnh tối đa')}</span>
                  <p className="text-xs text-zinc-400 mt-0.5">
                    {tr(locale, `当前: ${effectiveMaxLength} 字符`, `Current: ${effectiveMaxLength} chars`, `Hiện tại: ${effectiveMaxLength} ký tự`)}
                  </p>
                  {maxLengthCeiling !== undefined && (
                    <p className="flex items-center gap-1 text-xs text-zinc-500 mt-0.5">
                      <Lock className="w-3 h-3 shrink-0" />
                      {tr(locale, `工作区上限 ${maxLengthCeiling}，只能选更小的值`, `Workspace ceiling is ${maxLengthCeiling}; only smaller values are available`, `Giới hạn workspace là ${maxLengthCeiling}; chỉ có thể chọn giá trị nhỏ hơn`)}
                    </p>
                  )}
                </div>
                <select
                  value={effectiveMaxLength}
                  onChange={(e) => updateSecurity({ maxCommandLength: parseInt(e.target.value) })}
                  className="text-xs border border-zinc-200 rounded px-2 py-1"
                >
                  {MAX_COMMAND_LENGTH_OPTIONS.filter(
                    (n) => maxLengthCeiling === undefined || n <= maxLengthCeiling,
                  ).map((n) => (
                    <option key={n} value={n}>{n.toLocaleString()}</option>
                  ))}
                </select>
              </div>
            </div>
          </section>

          {/* ============================================
              Section 2: Auto-Approval
              ============================================ */}
          <section>
            <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">
              {tr(locale, '自动审批', 'Auto-Approval', 'Tự động phê duyệt')}
            </h3>

            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                <p className="text-xs text-amber-700">
                  {tr(locale, '自动审批会让 Agent 自动执行命令而不等待你的确认。请谨慎启用。', 'Auto-approval lets the Agent run commands without waiting for your confirmation. Use with caution.', 'Tự động phê duyệt cho phép Agent chạy lệnh mà không cần chờ bạn xác nhận. Hãy cân nhắc kỹ.')}
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm font-medium text-zinc-800">{tr(locale, '启用自动审批', 'Enable Auto-Approval', 'Bật tự động phê duyệt')}</span>
                  <p className="text-xs text-zinc-400 mt-0.5">{tr(locale, '符合策略的命令自动执行', 'Automatically execute policy-compliant commands', 'Tự động thực thi các lệnh hợp lệ theo chính sách')}</p>
                  {lockAutoApproval && (
                    <p className="flex items-center gap-1 text-xs text-zinc-500 mt-0.5">
                      <Lock className="w-3 h-3 shrink-0" />
                      {tr(locale, '工作区策略已关闭自动审批，命令仍需你逐条确认', 'Workspace policy keeps auto-approval off; every command still needs your confirmation', 'Chính sách workspace tắt tự động phê duyệt; mọi lệnh vẫn cần bạn xác nhận')}
                    </p>
                  )}
                </div>
                <Switch
                  checked={lockAutoApproval ? false : autoSettings.enabled}
                  onCheckedChange={(v) => updateAuto({ enabled: v })}
                  disabled={lockAutoApproval}
                />
              </div>

              {!lockAutoApproval && autoSettings.enabled && (
                <>
                  <div className="flex items-center justify-between pl-4">
                    <div>
                      <span className="text-sm text-zinc-700">{tr(locale, '自动读取文件', 'Auto-read files', 'Tự động đọc tệp')}</span>
                      {isActionLocked('readFiles') && lockHint}
                    </div>
                    <Switch
                      checked={isActionLocked('readFiles') ? false : autoSettings.actions.readFiles}
                      onCheckedChange={(v) => updateAuto({ actions: { ...autoSettings.actions, readFiles: v } })}
                      disabled={isActionLocked('readFiles')}
                    />
                  </div>
                  <div className="flex items-center justify-between pl-4">
                    <div>
                      <span className="text-sm text-zinc-700">{tr(locale, '自动编辑文件', 'Auto-edit files', 'Tự động sửa tệp')}</span>
                      {isActionLocked('editFiles') && lockHint}
                    </div>
                    <Switch
                      checked={isActionLocked('editFiles') ? false : autoSettings.actions.editFiles}
                      onCheckedChange={(v) => updateAuto({ actions: { ...autoSettings.actions, editFiles: v } })}
                      disabled={isActionLocked('editFiles')}
                    />
                  </div>
                  <div className="flex items-center justify-between pl-4">
                    <div>
                      <span className="text-sm text-zinc-700">{tr(locale, '自动执行安全命令', 'Auto-execute safe commands', 'Tự động chạy lệnh an toàn')}</span>
                      {isActionLocked('executeSafeCommands') && lockHint}
                    </div>
                    <Switch
                      checked={isActionLocked('executeSafeCommands') ? false : autoSettings.actions.executeSafeCommands}
                      onCheckedChange={(v) => updateAuto({ actions: { ...autoSettings.actions, executeSafeCommands: v } })}
                      disabled={isActionLocked('executeSafeCommands')}
                    />
                  </div>
                  <div className="flex items-center justify-between pl-4">
                    <div>
                      <span className="text-sm text-zinc-700">{tr(locale, '自动执行所有命令', 'Auto-execute ALL commands', 'Tự động chạy MỌI lệnh')}</span>
                      <p className="text-xs text-red-500 mt-0.5">{tr(locale, '⚠️ 包括危险命令，极度危险', '⚠️ Includes dangerous commands, extremely risky', '⚠️ Bao gồm cả lệnh nguy hiểm, cực kỳ rủi ro')}</p>
                      {isActionLocked('executeAllCommands') && lockHint}
                    </div>
                    <Switch
                      checked={isActionLocked('executeAllCommands') ? false : autoSettings.actions.executeAllCommands}
                      onCheckedChange={(v) => updateAuto({ actions: { ...autoSettings.actions, executeAllCommands: v } })}
                      disabled={isActionLocked('executeAllCommands')}
                    />
                  </div>
                  <div className="flex items-center justify-between pl-4">
                    <div>
                      <span className="text-sm text-zinc-700">{tr(locale, '首次批准后自动执行只读命令', 'Auto-run read-only commands after first approval', 'Tự động chạy lệnh chỉ đọc sau lần duyệt đầu')}</span>
                      {isActionLocked('autoExecuteReadOnlyCommands') && lockHint}
                    </div>
                    <Switch
                      checked={isActionLocked('autoExecuteReadOnlyCommands') ? false : autoSettings.actions.autoExecuteReadOnlyCommands}
                      onCheckedChange={(v) =>
                        updateAuto({ actions: { ...autoSettings.actions, autoExecuteReadOnlyCommands: v } })
                      }
                      disabled={isActionLocked('autoExecuteReadOnlyCommands')}
                    />
                  </div>
                  <div className="flex items-center justify-between pl-4">
                    <div>
                      <span className="text-sm text-zinc-700">{tr(locale, '最大连续自动批准次数', 'Max Consecutive Auto-Approvals', 'Số lần tự động duyệt liên tiếp tối đa')}</span>
                      <p className="text-xs text-zinc-400 mt-0.5">{tr(locale, '防止无限循环', 'Prevent infinite loops', 'Ngăn chặn vòng lặp vô hạn')}</p>
                    </div>
                    <select
                      value={autoSettings.maxRequests}
                      onChange={(e) => updateAuto({ maxRequests: parseInt(e.target.value) })}
                      className="text-xs border border-zinc-200 rounded px-2 py-1"
                    >
                      {[1, 2, 3, 5, 10, 20].map((n) => (
                        <option key={n} value={n}>{n}</option>
                      ))}
                    </select>
                  </div>
                </>
              )}
            </div>
          </section>

          {/* ============================================
              Section 3: Config Management
              ============================================ */}
          <section>
            <h3 className="text-xs font-semibold text-zinc-500 uppercase tracking-wider mb-3">
              {tr(locale, '配置管理', 'Configuration', 'Quản lý cấu hình')}
            </h3>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={handleExport}
              >
                <Download className="w-3 h-3 mr-1" />
                {tr(locale, '导出配置', 'Export', 'Xuất cấu hình')}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-8 text-xs"
                onClick={handleImport}
              >
                <Upload className="w-3 h-3 mr-1" />
                {tr(locale, '导入配置', 'Import', 'Nhập cấu hình')}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-8 text-xs text-red-500 hover:text-red-700 hover:bg-red-50"
                onClick={handleReset}
              >
                <RotateCcw className="w-3 h-3 mr-1" />
                {tr(locale, '恢复默认', 'Reset', 'Mặc định')}
              </Button>
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
