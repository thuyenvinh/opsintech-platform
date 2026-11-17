"use client";

import { useState } from "react";
import {
  PlusIcon,
  Trash2Icon,
  FilterIcon,
  VolumeXIcon,
  LayersIcon,
  SparklesIcon,
  SearchIcon,
  ShieldCheckIcon,
  SlidersIcon,
  ActivityIcon,
  CheckIcon,
  Loader2Icon,
  ChevronDownIcon,
  ChevronUpIcon
} from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  useAlertRules,
  useCreateAlertRule,
  useUpdateAlertRule,
  useDeleteAlertRule,
  type AlertRule,
  type AlertRuleCreate
} from "@/core/alerting";
import { tr, type Locale } from "@/core/i18n";
import { useI18n } from "@/core/i18n/hooks";

function getPresetRuleTemplates(locale: Locale): AlertRuleCreate[] {
  return [
    {
      name: tr(locale, "Kube Pod 崩溃多副本去重聚合策略", "Kube Pod CrashLoop Multi-Replica Aggregation", "Chiến lược gộp trùng lặp sự cố Kube Pod CrashLoop"),
      rule_type: "aggregation",
      enabled: true,
      condition_json: {
        logic: "and",
        conditions: [
          { field: "service", op: "eq", value: "k8s" },
          { field: "title", op: "contains", value: "CrashLoopBackOff" }
        ]
      },
      action_json: { action: tr(locale, "指纹去重 + 5分钟滑动窗口智能降噪", "Fingerprint dedup + 5m sliding window noise reduction", "Khử trùng lặp dấu vân tay + giảm nhiễu cửa sổ trượt 5 phút") }
    },
    {
      name: tr(locale, "数据库夜间维护静默规则", "Database Nightly Maintenance Suppression", "Quy tắc tắt tiếng bảo trì CSDL ban đêm"),
      rule_type: "suppression",
      enabled: true,
      condition_json: {
        logic: "and",
        conditions: [
          { field: "service", op: "eq", value: "postgres" },
          { field: "severity", op: "eq", value: "warning" }
        ]
      },
      action_json: { action: tr(locale, "工作日夜间维护自动静默 (Suppress)", "Auto suppress during nightly maintenance", "Tự động tắt tiếng khi bảo trì ban đêm") }
    },
    {
      name: tr(locale, "测试环境 (Staging) 噪音降级策略", "Staging Environment Noise Suppression", "Chiến lược giảm nhiễu môi trường Staging"),
      rule_type: "suppression",
      enabled: false,
      condition_json: {
        logic: "and",
        conditions: [
          { field: "environment", op: "eq", value: "staging" },
          { field: "severity", op: "eq", value: "minor" }
        ]
      },
      action_json: { action: tr(locale, "自动标记静默并抑制即时通知", "Auto suppress and mute instant alerts", "Tự động đánh dấu tắt tiếng và chặn thông báo tức thời") }
    }
  ];
}

interface ConditionInputRow {
  field: string;
  op: "eq" | "neq" | "in" | "not_in" | "contains" | "starts_with" | "regex" | "gt" | "lt";
  value: string;
}

export function AlertRulesTab() {
  const { locale } = useI18n();
  const { data: rules = [], isLoading, refetch, isFetching } = useAlertRules();
  const { mutateAsync: createRule, isPending: creating } = useCreateAlertRule();
  const { mutateAsync: updateRule } = useUpdateAlertRule();
  const { mutateAsync: deleteRule, isPending: deleting } = useDeleteAlertRule();



  const [isPipelineExpanded, setIsPipelineExpanded] = useState(true);
  const [searchTerm, setSearchTerm] = useState("");
  const [isNewDialogOpen, setIsNewDialogOpen] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(false);

  // 表单状态
  const [name, setName] = useState("");
  const [ruleType, setRuleType] = useState<"suppression" | "aggregation">("suppression");
  const [logic, setLogic] = useState<"and" | "or">("and");
  const [conditions, setConditions] = useState<ConditionInputRow[]>([
    { field: "service", op: "eq", value: "" }
  ]);

  // Schedule state
  const [scheduleEnabled, setScheduleEnabled] = useState(false);
  const [scheduleDays, setScheduleDays] = useState<number[]>([]);
  const [scheduleStart, setScheduleStart] = useState("02:00");
  const [scheduleEnd, setScheduleEnd] = useState("04:00");

  const DAY_LABELS = locale === "zh-CN"
    ? ["一", "二", "三", "四", "五", "六", "日"]
    : locale === "vi"
      ? ["T2", "T3", "T4", "T5", "T6", "T7", "CN"]
      : ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  const toggleScheduleDay = (day: number) => {
    setScheduleDays(prev => prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]);
  };

  const handleToggleActive = async (rule: AlertRule) => {
    try {
      await updateRule({
        ruleId: rule.id,
        data: { enabled: !rule.enabled }
      });
    } catch {
      // 错误由 Hook 处理
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteRule(id);
    } catch {
      // 错误由 Hook 处理
    }
  };

  // 添加条件行
  const handleAddConditionRow = () => {
    setConditions([...conditions, { field: "service", op: "eq", value: "" }]);
  };

  // 删除条件行
  const handleRemoveConditionRow = (index: number) => {
    if (conditions.length === 1) return;
    setConditions(conditions.filter((_, idx) => idx !== index));
  };

  const handleConditionChange = (index: number, key: "field" | "op" | "value", val: string) => {
    setConditions(conditions.map((item, idx) => {
      if (idx === index) {
        return { ...item, [key]: val };
      }
      return item;
    }));
  };

  // 初始化预置策略
  const handleBootstrapPresets = async () => {
    setBootstrapping(true);
    try {
      for (const preset of getPresetRuleTemplates(locale)) {
        await createRule(preset);
      }
      toast.success(tr(locale, "已成功初始化 3 个预置治理规则！", "Initialized 3 preset governance rules!", "Đã khởi tạo thành công 3 quy tắc mẫu!"));
      await refetch();
    } catch {
      toast.error(tr(locale, "初始化预置策略失败", "Failed to initialize preset rules", "Khởi tạo quy tắc mẫu thất bại"));
    } finally {
      setBootstrapping(false);
    }
  };

  // 打开创建弹窗
  const handleOpenCreateDialog = () => {
    setName("");
    setRuleType("suppression");
    setLogic("and");
    setConditions([{ field: "service", op: "eq", value: "" }]);
    setScheduleEnabled(false);
    setScheduleDays([]);
    setScheduleStart("02:00");
    setScheduleEnd("04:00");
    setIsNewDialogOpen(true);
  };

  // 提交新建
  const handleCreateSubmit = async () => {
    if (!name.trim()) {
      toast.error(tr(locale, "请输入策略名称", "Please enter a rule name", "Vui lòng nhập tên quy tắc"));
      return;
    }

    const filteredConditions = conditions.filter(c => c.value.trim() !== "");
    if (filteredConditions.length === 0) {
      toast.error(tr(locale, "请至少配置一个有效的过滤匹配条件", "Please configure at least one valid match condition", "Vui lòng cấu hình ít nhất một điều kiện khớp hợp lệ"));
      return;
    }

    try {
      const conditionJson: Record<string, unknown> & { schedule?: Record<string, unknown> } = {
        logic,
        conditions: filteredConditions
      } as Record<string, unknown> & { schedule?: Record<string, unknown> };
      if (scheduleEnabled) {
        conditionJson.schedule = {
          days: scheduleDays.length > 0 ? scheduleDays : undefined,
          start: scheduleStart,
          end: scheduleEnd,
        };
      }

      const actionJson = {
        action: ruleType === "suppression"
          ? tr(locale, "自动标记静默", "Auto suppress", "Tự động tắt tiếng")
          : tr(locale, "智能指纹去重合并", "Smart fingerprint aggregation", "Gộp trùng lặp dấu vân tay thông minh")
      };

      await createRule({
        name,
        rule_type: ruleType,
        enabled: true,
        condition_json: conditionJson,
        action_json: actionJson
      });

      setIsNewDialogOpen(false);
    } catch {
      // 错误由 Hook 处理
    }
  };

  const getConditionLabel = (item: any) => {
    const opLabels: Record<string, string> = {
      eq: tr(locale, "等于", "==", "bằng"),
      neq: tr(locale, "不等于", "!=", "khác"),
      contains: tr(locale, "包含", "contains", "chứa"),
      starts_with: tr(locale, "开头是", "starts with", "bắt đầu bằng"),
      gt: tr(locale, "大于", ">", "lớn hơn"),
      lt: tr(locale, "小于", "<", "nhỏ hơn"),
    };
    const fieldLabels: Record<string, string> = {
      service: tr(locale, "服务", "service", "dịch vụ"),
      environment: tr(locale, "环境", "environment", "môi trường"),
      severity: tr(locale, "严重度", "severity", "mức độ"),
      title: tr(locale, "标题", "title", "tiêu đề"),
    };
    return `${fieldLabels[item.field] || item.field} ${opLabels[item.op] || item.op} "${item.value}"`;
  };

  const filteredRules = rules.filter(rule =>
    rule.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* 顶部操作行 */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-50 flex items-center gap-2">
            <SlidersIcon className="h-4.5 w-4.5 text-zinc-800 dark:text-zinc-200" />
            {tr(locale, "智能治理规则 (Alert Rules)", "Alert Rules", "Quy tắc quản trị cảnh báo (Alert Rules)")}
          </h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            {tr(locale, "配置自定义过滤、聚合与静默机制，实时降低系统告警噪音。", "Configure custom filtering, aggregation, and suppression rules to reduce alert noise.", "Cấu hình lọc, gộp và tắt tiếng tùy chỉnh để giảm nhiễu cảnh báo theo thời gian thực.")}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-xs font-semibold gap-1.5"
            onClick={() => refetch()}
            disabled={isLoading || isFetching}
          >
            <Loader2Icon className={`h-3 w-3 ${isFetching ? "animate-spin" : ""}`} />
            {tr(locale, "刷新", "Refresh", "Làm mới")}
          </Button>

          <Button
            size="sm"
            onClick={handleOpenCreateDialog}
            className="h-8 text-xs font-semibold gap-1 bg-zinc-900 text-zinc-50 hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-900 dark:hover:bg-zinc-100"
          >
            <PlusIcon className="h-3.5 w-3.5" />
            {tr(locale, "创建治理规则", "Create Rule", "Tạo quy tắc")}
          </Button>
        </div>
      </div>

      {/* 调度流水线逻辑说明卡 */}
      <div className="rounded-xl border border-zinc-200/60 bg-zinc-50/30 p-5 dark:border-zinc-800/60 dark:bg-zinc-950/20">
        <div
          className="flex items-center justify-between cursor-pointer select-none"
          onClick={() => setIsPipelineExpanded(!isPipelineExpanded)}
        >
          <span className="font-bold text-xs text-zinc-800 dark:text-zinc-200 flex items-center gap-1.5">
            <ActivityIcon className="h-4 w-4 text-indigo-500 animate-pulse" />
            {tr(locale, "三层告警过滤与聚合治理流水线 (Orchestration Pipeline)", "3-Tier Alert Orchestration Pipeline", "Quy trình lọc & gộp cảnh báo 3 lớp (Orchestration Pipeline)")}
          </span>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6 text-zinc-400 hover:text-zinc-700 dark:hover:text-zinc-200 hover:bg-zinc-200/50 dark:hover:bg-zinc-800/50 rounded-md shrink-0"
            onClick={(e) => {
              e.stopPropagation();
              setIsPipelineExpanded(!isPipelineExpanded);
            }}
          >
            {isPipelineExpanded ? (
              <ChevronUpIcon className="h-3.5 w-3.5" />
            ) : (
              <ChevronDownIcon className="h-3.5 w-3.5" />
            )}
          </Button>
        </div>

        {isPipelineExpanded && (
          <div className="space-y-4 pt-4 animate-in fade-in duration-200">
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              {tr(locale, "告警信号 (Signal) 流入系统后，将按如下严密的优先级判定链路实时流转与降噪：", "Incoming alert signals flow through the following priority pipeline for real-time noise reduction:", "Tín hiệu cảnh báo (Signal) đi vào hệ thống sẽ được xử lý theo thứ tự ưu tiên sau để giảm nhiễu theo thời gian thực:")}
            </p>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 pt-1">
              <div className="rounded-lg border border-amber-500/10 bg-amber-500/5 p-3.5 dark:border-amber-500/20 dark:bg-amber-950/10">
                <span className="font-bold text-xs text-amber-700 dark:text-amber-400 block mb-1">
                  {tr(locale, "第一层：自定义静默 (Suppression)", "Tier 1: Custom Suppression", "Lớp 1: Tắt tiếng tùy chỉnh (Suppression)")}
                </span>
                <p className="text-[11px] text-zinc-500 leading-relaxed">
                  {tr(locale, "匹配用户启用的静默规则 ➔ 命中则直接标记为", "Matches enabled suppression rules ➔ marks signal as", "Khớp quy tắc tắt tiếng đang bật ➔ đánh dấu là")}{" "}
                  <code className="font-mono bg-amber-100/50 px-1 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 rounded text-[10px]">suppressed</code>{" "}
                  {tr(locale, "并返回，不创建 active 告警事件。", "without creating an active incident.", "và không tạo sự cố active.")}
                </p>
              </div>

              <div className="rounded-lg border border-indigo-500/10 bg-indigo-500/5 p-3.5 dark:border-indigo-500/20 dark:bg-indigo-950/10">
                <span className="font-bold text-xs text-indigo-700 dark:text-indigo-400 block mb-1">
                  {tr(locale, "第二层：自定义聚合 (Aggregation)", "Tier 2: Custom Aggregation", "Lớp 2: Gộp tùy chỉnh (Aggregation)")}
                </span>
                <p className="text-[11px] text-zinc-500 leading-relaxed">
                  {tr(locale, "匹配用户启用的聚合去重规则 ➔ 命中则使用用户自定义的", "Matches enabled aggregation rules ➔ aggregates using custom", "Khớp quy tắc gộp đang bật ➔ gộp theo thuộc tính")}{" "}
                  <code className="font-mono bg-indigo-100/50 px-1 dark:bg-indigo-950/40 text-indigo-800 dark:text-indigo-300 rounded text-[10px]">group_by</code>{" "}
                  {tr(locale, "属性及", "fields and", "và cửa sổ")}{" "}
                  <code className="font-mono bg-indigo-100/50 px-1 dark:bg-indigo-950/40 text-indigo-800 dark:text-indigo-300 rounded text-[10px]">window_minutes</code>{" "}
                  {tr(locale, "窗口执行聚合。", "window.", "tùy chỉnh.")}
                </p>
              </div>

              <div className="rounded-lg border border-zinc-200 bg-zinc-100/30 p-3.5 dark:border-zinc-800/80 dark:bg-zinc-900/40">
                <span className="font-bold text-xs text-zinc-700 dark:text-zinc-400 block mb-1">
                  {tr(locale, "第三层：系统内置默认 (System Default)", "Tier 3: System Default", "Lớp 3: Mặc định hệ thống (System Default)")}
                </span>
                <p className="text-[11px] text-zinc-500 leading-relaxed">
                  {tr(locale, "未命中任何自定义规则 ➔ 执行系统内置开箱即用默认机制：", "No custom rule matched ➔ applies built-in defaults:", "Không khớp quy tắc tùy chỉnh ➔ áp dụng cơ chế mặc định:")}<br />
                  • <span className="font-medium text-zinc-800 dark:text-zinc-300">{tr(locale, "去重", "Dedup", "Khử trùng lặp")}</span>：{tr(locale, "基于 Source|Service|Env|Severity|Labels 的 SHA256 指纹；", "SHA256 fingerprint on Source|Service|Env|Severity|Labels;", "Dấu vân tay SHA256 dựa trên Source|Service|Env|Severity|Labels;")}<br />
                  • <span className="font-medium text-zinc-800 dark:text-zinc-300">{tr(locale, "聚合", "Aggregate", "Gộp")}</span>：{tr(locale, "按照 Service + Environment 自动建立 30 分钟滑动合并周期窗口。", "30-minute sliding window grouped by Service + Environment.", "Tự động gộp theo Service + Environment trong cửa sổ trượt 30 phút.")}
                </p>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* 规则大盘列表渲染 */}
      <div className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="relative flex-1 max-w-md">
            <SearchIcon className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder={tr(locale, "搜索静默或去重规则...", "Search suppression or aggregation rules...", "Tìm quy tắc tắt tiếng hoặc gộp...")}
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="pl-9 h-9 text-xs"
            />
          </div>

          <div className="flex gap-2">
            <Badge variant="outline" className="h-7 text-[10px] px-2 bg-zinc-50 dark:bg-zinc-900 gap-1 rounded">
              <LayersIcon className="h-3 w-3" />
              {tr(locale, "去重策略", "Aggregation", "Gộp")}: {rules.filter(r => r.rule_type === "aggregation" || r.rule_type === "dedup").length}
            </Badge>
            <Badge variant="outline" className="h-7 text-[10px] px-2 bg-zinc-50 dark:bg-zinc-900 gap-1 rounded">
              <VolumeXIcon className="h-3 w-3" />
              {tr(locale, "静默规则", "Suppression", "Tắt tiếng")}: {rules.filter(r => r.rule_type === "suppression").length}
            </Badge>
          </div>
        </div>

        {/* 加载态 */}
        {isLoading ? (
          <div className="space-y-3">
            {Array.from({ length: 2 }).map((_, idx) => (
              <div key={idx} className="h-28 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-background/50 animate-pulse" />
            ))}
          </div>
        ) : rules.length === 0 ? (
          /* 空白导入态 */
          <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-200 dark:border-zinc-800 py-16 text-center bg-background/30">
            <SlidersIcon className="h-10 w-10 text-zinc-400" />
            <h3 className="mt-4 text-sm font-semibold text-zinc-800 dark:text-zinc-200">
              {tr(locale, "当前工作空间未配置任何治理策略", "No governance rules configured", "Chưa có quy tắc quản trị nào được cấu hình")}
            </h3>
            <p className="mt-1.5 text-xs text-muted-foreground max-w-sm leading-relaxed px-4">
              {tr(locale, "为了防范海量外部告警引发警报风暴，建议初始化系统为您精心预置的三大运维治理规则模版。", "To prevent alert storms, initialize the 3 built-in governance rule templates.", "Để phòng tránh bão cảnh báo, nên khởi tạo 3 mẫu quy tắc quản trị vận hành có sẵn.")}
            </p>
            <div className="mt-5 flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleBootstrapPresets}
                disabled={bootstrapping}
                className="h-8.5 text-xs font-semibold gap-1"
              >
                {bootstrapping && <Loader2Icon className="h-3 w-3 animate-spin" />}
                {tr(locale, "初始化 3 个预置模板", "Initialize 3 Preset Templates", "Khởi tạo 3 mẫu có sẵn")}
              </Button>
              <Button
                size="sm"
                onClick={handleOpenCreateDialog}
                className="h-8.5 text-xs font-semibold gap-1"
              >
                <PlusIcon className="h-3.5 w-3.5" /> {tr(locale, "手动创建自定义规则", "Create Custom Rule", "Tạo quy tắc thủ công")}
              </Button>
            </div>
          </div>
        ) : (
          /* 规则大盘实际数据列表 */
          <div className="overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800 shadow-sm bg-background">
            <table className="w-full text-left text-xs">
              <thead className="bg-zinc-50 text-zinc-500 border-b border-zinc-200 dark:bg-zinc-900/50 dark:border-zinc-800">
                <tr>
                  <th className="px-5 py-3.5 font-semibold w-1/3">{tr(locale, "规则名称 & 说明", "Rule Name & Description", "Tên quy tắc & Mô tả")}</th>
                  <th className="px-5 py-3.5 font-semibold">{tr(locale, "治理类型", "Type", "Loại")}</th>
                  <th className="px-5 py-3.5 font-semibold">{tr(locale, "触发匹配条件 (Match Criteria)", "Match Criteria", "Điều kiện khớp (Match Criteria)")}</th>
                  <th className="px-5 py-3.5 font-semibold">{tr(locale, "执行动作 (Action)", "Action", "Hành động (Action)")}</th>
                  <th className="px-5 py-3.5 font-semibold w-24 text-center">{tr(locale, "启用状态", "Status", "Trạng thái")}</th>
                  <th className="px-5 py-3.5 font-semibold w-16 text-center">{tr(locale, "操作", "Actions", "Thao tác")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
                {filteredRules.map((rule) => {
                  const conditionsList = ((rule.condition_json as Record<string, unknown> | null)?.conditions as Array<Record<string, unknown>> | null) || [];
                  const ruleAction = (rule.action_json as any)?.action || "-";

                  return (
                    <tr key={rule.id} className="hover:bg-zinc-50/50 dark:hover:bg-zinc-900/10 transition-colors">
                      <td className="px-5 py-4">
                        <div className="font-semibold text-zinc-950 dark:text-zinc-50">{rule.name}</div>
                        <p className="mt-1 text-[11px] text-muted-foreground leading-relaxed max-w-sm">
                          {rule.rule_type === "suppression"
                            ? tr(locale, "静默规则：当匹配下述条件时直接静默返回，不触发 active 告警事件。", "Suppression rule: matching signals are suppressed without creating active incidents.", "Quy tắc tắt tiếng: tín hiệu khớp điều kiện sẽ bị tắt tiếng, không tạo sự cố active.")
                            : tr(locale, "聚合规则：覆盖默认聚合行为，在此微服务或标签指纹上建立自定义滑动窗口降噪。", "Aggregation rule: overrides default aggregation with a custom sliding window.", "Quy tắc gộp: ghi đè gộp mặc định bằng cửa sổ trượt tùy chỉnh.")}
                        </p>
                      </td>

                      <td className="px-5 py-4">
                        {rule.rule_type === "aggregation" || rule.rule_type === "dedup" ? (
                          <Badge variant="secondary" className="px-2 py-0.5 rounded text-[10px] bg-indigo-50 border-indigo-100 text-indigo-700 dark:bg-indigo-950/20 dark:border-indigo-900/50">
                            <LayersIcon className="h-3 w-3 mr-1 shrink-0" />
                            {tr(locale, "去重聚合", "Aggregation", "Gộp")}
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="px-2 py-0.5 rounded text-[10px] bg-amber-50 border-amber-100 text-amber-700 dark:bg-amber-950/20 dark:border-amber-900/50">
                            <VolumeXIcon className="h-3 w-3 mr-1 shrink-0" />
                            {tr(locale, "自动静默", "Suppression", "Tắt tiếng")}
                          </Badge>
                        )}
                      </td>

                      <td className="px-5 py-4">
                        <div className="flex flex-wrap gap-1.5 max-w-md">
                          {conditionsList.length === 0 ? (
                            <span className="text-muted-foreground font-mono text-[10px]">{tr(locale, "无条件限制", "No conditions", "Không có điều kiện")}</span>
                          ) : (
                            conditionsList.map((cond, cIdx) => (
                              <code
                                key={cIdx}
                                className="font-mono text-[10px] bg-zinc-100 dark:bg-zinc-800 px-2 py-0.5 rounded text-zinc-700 dark:text-zinc-300 border border-zinc-200/50 dark:border-zinc-700/50"
                              >
                                {getConditionLabel(cond)}
                              </code>
                            ))
                          )}
                          {conditionsList.length > 1 && (
                            <Badge variant="outline" className="px-1 py-0 text-[8px] leading-none uppercase font-bold bg-zinc-50 border border-zinc-200">
                              {String((rule.condition_json as Record<string, unknown> | null)?.logic || "AND")}
                            </Badge>
                          )}
                          {(rule.condition_json as any)?.schedule && (
                            <Badge variant="outline" className="px-1 py-0 text-[8px] bg-amber-50 border-amber-100 text-amber-700 dark:bg-amber-950/20 dark:border-amber-900/50">
                              {((rule.condition_json as any).schedule as Record<string, unknown>).start as string}-{((rule.condition_json as any).schedule as Record<string, unknown>).end as string}
                            </Badge>
                          )}
                        </div>
                      </td>

                      <td className="px-5 py-4 text-zinc-800 dark:text-zinc-200 font-medium">
                        {ruleAction}
                      </td>

                      <td className="px-5 py-4 text-center">
                        <div className="flex justify-center">
                          <Switch
                            checked={rule.enabled}
                            onCheckedChange={() => void handleToggleActive(rule)}
                          />
                        </div>
                      </td>

                      <td className="px-5 py-4 text-center">
                        <div className="flex justify-center">
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={deleting}
                            className="h-7 w-7 rounded-md text-zinc-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/20 transition-colors"
                            onClick={() => handleDelete(rule.id)}
                            title={tr(locale, "删除规则", "Delete rule", "Xóa quy tắc")}
                          >
                            <Trash2Icon className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 弹窗：创建新治理规则 */}
      <Dialog open={isNewDialogOpen} onOpenChange={setIsNewDialogOpen}>
        <DialogContent className="max-w-2xl overflow-y-auto max-h-[85vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-zinc-950 dark:text-zinc-50">
              <SlidersIcon className="h-5 w-5 text-indigo-500" />
              {tr(locale, "创建治理规则", "Create Governance Rule", "Tạo quy tắc quản trị")}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-5 py-3">
            {/* 规则名与类型 */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                  {tr(locale, "规则策略名称", "Rule Name", "Tên quy tắc")}
                </label>
                <Input
                  placeholder={tr(locale, "e.g. 维护期间告警屏蔽规则", "e.g. Maintenance Alert Suppression", "vd: Quy tắc tắt tiếng khi bảo trì")}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="h-9.5 text-xs"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">
                  {tr(locale, "治理动作分类", "Rule Type", "Loại hành động")}
                </label>
                <select
                  aria-label={tr(locale, "治理动作分类", "Rule Type", "Loại hành động")}
                  value={ruleType}
                  onChange={(e) => setRuleType(e.target.value as any)}
                  className="w-full h-9.5 px-3 text-xs rounded-md border border-zinc-200 dark:border-zinc-800 bg-background outline-none cursor-pointer"
                >
                  <option value="suppression">{tr(locale, "自动静默 (Suppression)", "Auto Suppression", "Tự động tắt tiếng (Suppression)")}</option>
                  <option value="aggregation">{tr(locale, "去重合并 (Aggregation)", "Aggregation", "Gộp trùng lặp (Aggregation)")}</option>
                </select>
              </div>
            </div>

            {/* 匹配条件编辑器 */}
            <div className="rounded-xl border border-zinc-200/80 bg-zinc-50/50 p-4 dark:border-zinc-800 dark:bg-zinc-900/10 space-y-4">
              <div className="flex items-center justify-between border-b pb-2 border-zinc-200/60 dark:border-zinc-800">
                <div className="flex items-center gap-1.5">
                  <FilterIcon className="h-4 w-4 text-zinc-500" />
                  <span className="text-xs font-bold text-zinc-800 dark:text-zinc-200">
                    {tr(locale, "触发匹配逻辑条件 (Match Criteria)", "Match Criteria", "Điều kiện khớp (Match Criteria)")}
                  </span>
                </div>

                {conditions.length > 1 && (
                  <div className="flex gap-1 bg-background p-0.5 rounded-md border text-xs">
                    <button
                      type="button"
                      onClick={() => setLogic("and")}
                      className={`px-2 py-0.5 text-[10px] font-bold rounded transition ${logic === "and"
                        ? "bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900"
                        : "text-zinc-500"
                        }`}
                    >
                      AND
                    </button>
                    <button
                      type="button"
                      onClick={() => setLogic("or")}
                      className={`px-2 py-0.5 text-[10px] font-bold rounded transition ${logic === "or"
                        ? "bg-zinc-900 text-zinc-50 dark:bg-zinc-100 dark:text-zinc-900"
                        : "text-zinc-500"
                        }`}
                    >
                      OR
                    </button>
                  </div>
                )}
              </div>

              {/* 条件列表编辑器每一行 */}
              <div className="space-y-3">
                {conditions.map((item, idx) => (
                  <div key={idx} className="flex items-center gap-2.5">
                    {/* 字段选择 */}
                    <select
                      aria-label={tr(locale, "条件匹配字段", "Match Field", "Trường khớp")}
                      value={item.field}
                      onChange={(e) => handleConditionChange(idx, "field", e.target.value)}
                      className="h-8.5 px-2.5 text-xs rounded-md border border-zinc-200 bg-background"
                    >
                      <option value="service">{tr(locale, "服务 (service)", "service", "Dịch vụ (service)")}</option>
                      <option value="environment">{tr(locale, "环境 (environment)", "environment", "Môi trường (environment)")}</option>
                      <option value="severity">{tr(locale, "严重度 (severity)", "severity", "Mức độ (severity)")}</option>
                      <option value="title">{tr(locale, "标题 (title)", "title", "Tiêu đề (title)")}</option>
                    </select>

                    {/* 逻辑操作符 */}
                    <select
                      aria-label={tr(locale, "条件匹配操作符", "Match Operator", "Toán tử khớp")}
                      value={item.op}
                      onChange={(e) => handleConditionChange(idx, "op", e.target.value)}
                      className="h-8.5 px-2.5 text-xs rounded-md border border-zinc-200 bg-background"
                    >
                      <option value="eq">{tr(locale, "等于 (==)", "Equals (==)", "Bằng (==)")}</option>
                      <option value="neq">{tr(locale, "不等于 (!=)", "Not Equals (!=)", "Khác (!=)")}</option>
                      <option value="contains">{tr(locale, "包含 (contains)", "Contains", "Chứa (contains)")}</option>
                      <option value="starts_with">{tr(locale, "开头是 (starts)", "Starts with", "Bắt đầu bằng")}</option>
                    </select>

                    {/* 匹配值 */}
                    <Input
                      placeholder={
                        item.field === "severity"
                          ? "e.g. critical, warning"
                          : item.field === "environment"
                            ? "e.g. production, staging"
                            : "e.g. postgres, CrashLoop"
                      }
                      value={item.value}
                      onChange={(e) => handleConditionChange(idx, "value", e.target.value)}
                      className="h-8.5 text-xs flex-1"
                    />

                    {/* 删除本行条件按钮 */}
                    <Button
                      variant="ghost"
                      size="icon"
                      disabled={conditions.length === 1}
                      onClick={() => handleRemoveConditionRow(idx)}
                      className="h-8 w-8 text-zinc-400 hover:text-rose-600 hover:bg-rose-50 shrink-0"
                    >
                      <Trash2Icon className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>

              {/* 增添一行条件 */}
              <Button
                variant="outline"
                size="sm"
                onClick={handleAddConditionRow}
                className="h-8 text-xs font-semibold gap-1 border-dashed w-full bg-background"
              >
                <PlusIcon className="h-3.5 w-3.5" />
                {tr(locale, "新增一条匹配条件行", "Add Condition", "Thêm điều kiện")}
              </Button>
            </div>

            {/* 维护窗口 (Schedule) */}
            {ruleType === "suppression" && (
              <div className="space-y-3 rounded-xl border p-4">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold">{tr(locale, "维护窗口 (可选)", "Maintenance Window (Optional)", "Khung giờ bảo trì (Tùy chọn)")}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] text-muted-foreground select-none">
                      {scheduleEnabled ? tr(locale, "已启用", "Enabled", "Đang bật") : tr(locale, "已停用", "Disabled", "Đang tắt")}
                    </span>
                    <Switch
                      checked={scheduleEnabled}
                      onCheckedChange={setScheduleEnabled}
                    />
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {tr(locale, "设置时间段后，规则仅在指定时间窗口内生效（如凌晨维护窗口）", "Rule is only active during the configured window (e.g., nightly maintenance)", "Quy tắc chỉ có hiệu lực trong khung giờ được cấu hình (vd: bảo trì ban đêm)")}
                </p>

                {scheduleEnabled && (
                  <div className="space-y-3">
                    <div className="flex flex-wrap gap-1.5">
                      <span className="text-[10px] text-zinc-500 w-full mb-1">
                        {tr(locale, "生效日期（不选 = 每天）:", "Active days (empty = every day):", "Ngày áp dụng (bỏ trống = hằng ngày):")}
                      </span>
                      {DAY_LABELS.map((label, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => toggleScheduleDay(idx)}
                          className={`w-8 h-7 text-[10px] font-medium rounded border transition ${scheduleDays.includes(idx)
                            ? "bg-indigo-50 border-indigo-200 text-indigo-700 dark:bg-indigo-950/20 dark:border-indigo-900/50"
                            : "bg-background text-zinc-500 border-zinc-200"
                            }`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="space-y-1 flex-1">
                        <label className="text-[10px] text-zinc-500">{tr(locale, "开始时间", "Start Time", "Giờ bắt đầu")}</label>
                        <Input
                          type="time"
                          value={scheduleStart}
                          onChange={(e) => setScheduleStart(e.target.value)}
                          className="h-8 text-xs"
                        />
                      </div>
                      <span className="text-zinc-400 mt-4">—</span>
                      <div className="space-y-1 flex-1">
                        <label className="text-[10px] text-zinc-500">{tr(locale, "结束时间", "End Time", "Giờ kết thúc")}</label>
                        <Input
                          type="time"
                          value={scheduleEnd}
                          onChange={(e) => setScheduleEnd(e.target.value)}
                          className="h-8 text-xs"
                        />
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Action automatically mapped based on rule type */}
          </div>

          <DialogFooter className="mt-6 border-t pt-4">
            <Button variant="outline" size="sm" onClick={() => setIsNewDialogOpen(false)} disabled={creating}>
              {tr(locale, "取消", "Cancel", "Hủy")}
            </Button>
            <Button size="sm" onClick={handleCreateSubmit} disabled={creating} className="bg-primary text-primary-foreground">
              {creating ? tr(locale, "创建中...", "Creating...", "Đang tạo...") : tr(locale, "保存并激活", "Save & Activate", "Lưu & Kích hoạt")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
