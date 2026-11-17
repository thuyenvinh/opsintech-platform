"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  AlertTriangleIcon,
  ClockIcon,
  ExternalLinkIcon,
  Loader2Icon,
  PlusIcon,
  SaveIcon,
  ShieldIcon,
  Trash2Icon,
  UserPlusIcon,
  ZapIcon,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useAlertRules, useCreateAlertRule, useDeleteAlertRule, useUpdateAlertRule } from "@/core/alerting";
import type { AlertRule } from "@/core/alerting/types";
import { tr, type Locale } from "@/core/i18n";
import { useI18n } from "@/core/i18n/hooks";

const SEVERITY_OPTIONS = ["critical", "major", "warning", "minor", "info"];
function getActionOptions(locale: Locale) {
  return [
    { value: "escalate_severity", label: tr(locale, "提升严重度", "Escalate Severity", "Nâng mức độ nghiêm trọng") },
    { value: "notify_channel", label: tr(locale, "发送通知", "Send Notification", "Gửi thông báo") },
    { value: "auto_assign", label: tr(locale, "自动指派", "Auto Assign", "Tự động phân công") },
    { value: "auto_ticket", label: tr(locale, "自动创建工单", "Auto Create Ticket", "Tự động tạo phiếu") },
  ];
}

export function EscalationRulesPanel() {
  const { locale } = useI18n();
  const ACTION_OPTIONS = getActionOptions(locale);
  const { data: allRules = [], isLoading } = useAlertRules();
  const escalationRules = allRules.filter(r => r.rule_type === "escalation");
  const { mutate: createRule, isPending: creating } = useCreateAlertRule();
  const { mutate: deleteRule } = useDeleteAlertRule();

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingRule, setEditingRule] = useState<AlertRule | null>(null);

  // Form state
  const [formName, setFormName] = useState("");
  const [formSeverity, setFormSeverity] = useState<string[]>(["critical"]);
  const [formService, setFormService] = useState("");
  const [formSource, setFormSource] = useState("");
  const [formMinDuration, setFormMinDuration] = useState(15);
  const [formAction, setFormAction] = useState("escalate_severity");
  const [formActionConfig, setFormActionConfig] = useState("");

  const openCreate = () => {
    setEditingRule(null);
    setFormName("");
    setFormSeverity(["critical"]);
    setFormService("");
    setFormSource("");
    setFormMinDuration(15);
    setFormAction("escalate_severity");
    setFormActionConfig("");
    setSheetOpen(true);
  };

  const openEdit = (rule: AlertRule) => {
    setEditingRule(rule);
    setFormName(rule.name);
    const conditions = (rule.condition_json || {}) as Record<string, unknown>;
    setFormSeverity((conditions.severity as string[]) || []);
    setFormService((conditions.service as string) || "");
    setFormSource((conditions.source as string) || "");
    setFormMinDuration((conditions.min_duration_minutes as number) || 15);
    const actions = (rule.action_json || {}) as Record<string, unknown>;
    setFormAction((actions.action as string) || "escalate_severity");
    setFormActionConfig((actions.user_id || actions.channel) as string || "");
    setSheetOpen(true);
  };

  const toggleSeverity = (sev: string) => {
    setFormSeverity(prev =>
      prev.includes(sev) ? prev.filter(s => s !== sev) : [...prev, sev]
    );
  };

  const handleSave = () => {
    if (!formName.trim()) {
      toast.error(tr(locale, "请输入规则名称", "Please enter a rule name", "Vui lòng nhập tên quy tắc"));
      return;
    }

    const condition_json: Record<string, unknown> = {};
    if (formSeverity.length > 0) condition_json.severity = formSeverity;
    if (formService.trim()) condition_json.service = formService.trim();
    if (formSource.trim()) condition_json.source = formSource.trim();
    condition_json.min_duration_minutes = formMinDuration;

    const action_json: Record<string, unknown> = { action: formAction };
    if (formAction === "auto_assign" && formActionConfig.trim()) {
      action_json.user_id = formActionConfig.trim();
    } else if (formAction === "notify_channel" && formActionConfig.trim()) {
      action_json.channel = formActionConfig.trim();
    }

    if (editingRule) {
      // Edit not supported yet via simple API; delete + recreate
      deleteRule(editingRule.id, {
        onSuccess: () => {
          createRule(
            { name: formName, rule_type: "escalation", enabled: true, condition_json, action_json },
            {
              onSuccess: () => {
                toast.success(tr(locale, "规则已更新", "Rule updated", "Đã cập nhật quy tắc"));
                setSheetOpen(false);
              },
              onError: (err) => toast.error(err instanceof Error ? err.message : tr(locale, "保存失败", "Save failed", "Lưu thất bại")),
            }
          );
        },
      });
    } else {
      createRule(
        { name: formName, rule_type: "escalation", enabled: true, condition_json, action_json },
        {
          onSuccess: () => {
            toast.success(tr(locale, "升级规则已创建", "Escalation rule created", "Đã tạo quy tắc leo thang"));
            setSheetOpen(false);
          },
          onError: (err) => toast.error(err instanceof Error ? err.message : tr(locale, "创建失败", "Creation failed", "Tạo thất bại")),
        }
      );
    }
  };

  const handleDelete = (ruleId: string) => {
    if (confirm(tr(locale, "确定要删除这条升级规则吗？", "Delete this escalation rule?", "Xác nhận xóa quy tắc leo thang này?"))) {
      deleteRule(ruleId, {
        onSuccess: () => toast.success(tr(locale, "规则已删除", "Rule deleted", "Đã xóa quy tắc")),
        onError: (err) => toast.error(err instanceof Error ? err.message : tr(locale, "删除失败", "Delete failed", "Xóa thất bại")),
      });
    }
  };

  return (
    <div className="rounded-2xl border border-zinc-200/80 bg-background p-6 shadow-sm dark:border-zinc-800/80">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
            <ZapIcon className="h-4 w-4 text-amber-500" />
            {tr(locale, "告警升级规则 (Escalation Rules)", "Escalation Rules", "Quy tắc leo thang cảnh báo (Escalation Rules)")}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {tr(locale, "当告警满足条件时自动触发升级操作：提升严重度、发送通知、指派人员或创建工单", "Automatically escalate alerts when conditions match: bump severity, notify, assign, or create ticket", "Tự động kích hoạt hành động leo thang khi thỏa điều kiện: nâng mức độ, gửi thông báo, phân công hoặc tạo phiếu")}
          </p>
        </div>
        <Sheet open={sheetOpen} onOpenChange={setSheetOpen}>
          <SheetTrigger asChild>
            <Button size="sm" onClick={openCreate} className="gap-1.5">
              <PlusIcon className="h-3.5 w-3.5" />
              {tr(locale, "添加规则", "Add Rule", "Thêm quy tắc")}
            </Button>
          </SheetTrigger>
          <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
            <SheetHeader>
              <SheetTitle>
                {editingRule
                  ? tr(locale, "编辑升级规则", "Edit Escalation Rule", "Sửa quy tắc leo thang")
                  : tr(locale, "新建升级规则", "New Escalation Rule", "Tạo quy tắc leo thang")}
              </SheetTitle>
              <SheetDescription>
                {tr(locale, "配置告警升级条件和触发动作", "Configure escalation conditions and actions", "Cấu hình điều kiện và hành động leo thang cảnh báo")}
              </SheetDescription>
            </SheetHeader>
            <div className="mt-6 space-y-5">
              {/* Rule Name */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold">{tr(locale, "规则名称", "Rule Name", "Tên quy tắc")}</label>
                <Input
                  placeholder={tr(locale, "如: Critical 告警 15 分钟无人认领自动升级", "e.g. Escalate unclaimed Critical after 15m", "vd: Tự động leo thang Critical sau 15 phút chưa nhận")}
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                />
              </div>

              {/* Severity Filter */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold">{tr(locale, "告警级别 (多选)", "Severities (Multi-select)", "Mức độ cảnh báo (Chọn nhiều)")}</label>
                <div className="flex flex-wrap gap-1.5">
                  {SEVERITY_OPTIONS.map(sev => (
                    <button
                      key={sev}
                      type="button"
                      onClick={() => toggleSeverity(sev)}
                      className={`px-2.5 py-1 rounded-md text-[10px] font-semibold uppercase border transition-colors ${
                        formSeverity.includes(sev)
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-background text-muted-foreground border-zinc-200 dark:border-zinc-700 hover:border-zinc-400"
                      }`}
                    >
                      {sev}
                    </button>
                  ))}
                </div>
              </div>

              {/* Service Filter */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold">{tr(locale, "限定服务 (可选)", "Service Filter (Optional)", "Lọc dịch vụ (Tùy chọn)")}</label>
                <Input
                  placeholder={tr(locale, "如: payment-service", "e.g. payment-service", "vd: payment-service")}
                  value={formService}
                  onChange={(e) => setFormService(e.target.value)}
                />
              </div>

              {/* Source Filter */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold">{tr(locale, "限定告警源 (可选)", "Alert Source Filter (Optional)", "Lọc nguồn cảnh báo (Tùy chọn)")}</label>
                <Input
                  placeholder={tr(locale, "如: prometheus-prod", "e.g. prometheus-prod", "vd: prometheus-prod")}
                  value={formSource}
                  onChange={(e) => setFormSource(e.target.value)}
                />
              </div>

              {/* Min Duration */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold">{tr(locale, "最低持续时间 (分钟)", "Min Duration (minutes)", "Thời gian tối thiểu (phút)")}</label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    min={1}
                    max={1440}
                    value={formMinDuration}
                    onChange={(e) => setFormMinDuration(Number(e.target.value))}
                    className="w-24"
                  />
                  <span className="text-xs text-muted-foreground">
                    {tr(locale, "告警触发超过此时间后执行升级", "Escalate after alert remains active for this duration", "Kích hoạt leo thang sau khi cảnh báo duy trì quá thời gian này")}
                  </span>
                </div>
              </div>

              {/* Action */}
              <div className="space-y-1.5">
                <label className="text-xs font-semibold">{tr(locale, "升级动作", "Escalation Action", "Hành động leo thang")}</label>
                <div className="grid grid-cols-2 gap-2">
                  {ACTION_OPTIONS.map(opt => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => { setFormAction(opt.value); setFormActionConfig(""); }}
                      className={`p-2.5 rounded-lg border text-left transition-colors ${
                        formAction === opt.value
                          ? "border-amber-300 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 text-amber-800 dark:text-amber-200"
                          : "border-zinc-200 dark:border-zinc-700 hover:border-zinc-400"
                      }`}
                    >
                      <div className="text-xs font-semibold">{opt.label}</div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">
                        {opt.value === "escalate_severity" && tr(locale, "提升至下一级别", "Escalate to next severity", "Nâng lên mức tiếp theo")}
                        {opt.value === "notify_channel" && tr(locale, "发送 IM 通知", "Send IM notification", "Gửi thông báo IM")}
                        {opt.value === "auto_assign" && tr(locale, "指派给指定用户", "Assign to user", "Phân công cho người dùng")}
                        {opt.value === "auto_ticket" && tr(locale, "自动创建外部工单", "Create external ticket", "Tự động tạo phiếu xử lý")}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Action Config */}
              {(formAction === "auto_assign" || formAction === "notify_channel") && (
                <div className="space-y-1.5">
                  <label className="text-xs font-semibold">
                    {formAction === "auto_assign"
                      ? tr(locale, "指派用户 ID", "Assignee User ID", "ID người được giao")
                      : tr(locale, "通知渠道名称", "Notification Channel", "Tên kênh thông báo")}
                  </label>
                  <Input
                    placeholder={formAction === "auto_assign" ? tr(locale, "如: user-123", "e.g. user-123", "vd: user-123") : tr(locale, "如: feishu-prod", "e.g. feishu-prod", "vd: feishu-prod")}
                    value={formActionConfig}
                    onChange={(e) => setFormActionConfig(e.target.value)}
                  />
                </div>
              )}

              {/* Save Button */}
              <Button onClick={handleSave} disabled={creating} className="w-full gap-1.5">
                {creating ? <Loader2Icon className="h-4 w-4 animate-spin" /> : <SaveIcon className="h-4 w-4" />}
                {editingRule ? tr(locale, "保存修改", "Save Changes", "Lưu thay đổi") : tr(locale, "创建规则", "Create Rule", "Tạo quy tắc")}
              </Button>
            </div>
          </SheetContent>
        </Sheet>
      </div>

      {/* Rules List */}
      <div className="mt-5">
        {isLoading ? (
          <div className="space-y-2">
            {[1, 2].map(i => (
              <div key={i} className="h-16 animate-pulse rounded-lg bg-zinc-100 dark:bg-zinc-800" />
            ))}
          </div>
        ) : escalationRules.length === 0 ? (
          <div className="py-8 text-center rounded-lg border border-dashed border-zinc-200 dark:border-zinc-800">
            <ShieldIcon className="h-8 w-8 mx-auto text-zinc-300 dark:text-zinc-600" />
            <p className="mt-2 text-sm text-muted-foreground">{tr(locale, "暂无升级规则", "No escalation rules", "Chưa có quy tắc leo thang nào")}</p>
            <p className="text-xs text-muted-foreground mt-1">
              {tr(locale, "点击\"添加规则\"配置第一条告警升级策略", "Click \"Add Rule\" to configure your first escalation rule", "Nhấn \"Thêm quy tắc\" để cấu hình chiến lược leo thang đầu tiên")}
            </p>
          </div>
        ) : (
          <div className="space-y-2">
            {escalationRules.map(rule => {
              const conditions = (rule.condition_json || {}) as Record<string, unknown>;
              const actions = (rule.action_json || {}) as Record<string, unknown>;
              const actionLabel = ACTION_OPTIONS.find(o => o.value === (actions.action as string))?.label ?? (actions.action as string) ?? "unknown";
              return (
                <div
                  key={rule.id}
                  className="flex items-center justify-between p-3 rounded-lg border border-zinc-200/80 dark:border-zinc-800/80 bg-zinc-50/50 dark:bg-zinc-900/20"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-zinc-800 dark:text-zinc-200 truncate">{rule.name}</span>
                      {rule.enabled ? (
                        <Badge variant="outline" className="text-[9px] px-1 py-0 text-emerald-600 border-emerald-300 bg-emerald-50">{tr(locale, "启用", "Enabled", "Bật")}</Badge>
                      ) : (
                        <Badge variant="outline" className="text-[9px] px-1 py-0 text-zinc-400">{tr(locale, "停用", "Disabled", "Tắt")}</Badge>
                      )}
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                      {Boolean(conditions.severity) && Array.isArray(conditions.severity) && (
                        <span className="flex items-center gap-1">
                          <AlertTriangleIcon className="h-3 w-3" />
                          {(conditions.severity as string[]).join(", ")}
                        </span>
                      )}
                      {Boolean(conditions.min_duration_minutes) && (
                        <span className="flex items-center gap-1">
                          <ClockIcon className="h-3 w-3" />
                          ≥{String(conditions.min_duration_minutes)}{tr(locale, "分钟", "m", " phút")}
                        </span>
                      )}
                      {Boolean(conditions.service) && (
                        <span>{tr(locale, "服务", "Service", "Dịch vụ")}: {String(conditions.service)}</span>
                      )}
                      <span className="text-zinc-400">→</span>
                      <span className="flex items-center gap-1 font-semibold text-amber-600 dark:text-amber-400">
                        <ZapIcon className="h-3 w-3" />
                        {String(actionLabel)}
                      </span>
                      {Boolean(actions.user_id) && <span className="text-zinc-400">({String(actions.user_id)})</span>}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 ml-3">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(rule)}>
                      <span className="text-[10px]">{tr(locale, "编辑", "Edit", "Sửa")}</span>
                    </Button>
                    <Button variant="ghost" size="icon" className="h-7 w-7 text-rose-500 hover:text-rose-600" onClick={() => handleDelete(rule.id)}>
                      <Trash2Icon className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
