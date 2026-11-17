"use client";

import {
  ArrowRightIcon,
  CheckCircle2Icon,
  ClockIcon,
  DownloadIcon,
  ExternalLinkIcon,
  RefreshCwIcon,
  SparklesIcon,
  TagIcon,
  TerminalIcon,
  UserIcon,
  UserPlusIcon,
  VolumeXIcon,
  TicketIcon,
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { formatDate, getSeverityBadgeStyles } from "@/core/alerting";
import type { IncidentDetail } from "@/core/alerting/types";
import { tr } from "@/core/i18n";
import { useI18n } from "@/core/i18n/hooks";

interface IncidentHeaderProps {
  incident: IncidentDetail;
  onSuppress: () => void;
  onUnsuppress: () => void;
  onOpenDiagnosis: () => void;
  onExportReport: () => void;
  onClaim: () => void;
  onResolve: () => void;
  onCreateTicket: () => void;
  onGoToTerminal: () => void;
  suppressing: boolean;
  unsuppressing: boolean;
  diagnosing: boolean;
  claiming: boolean;
  resolving: boolean;
  creatingTicket: boolean;
  currentThreadId: string | null | undefined;
}

export function IncidentHeader({
  incident,
  onSuppress,
  onUnsuppress,
  onOpenDiagnosis,
  onExportReport,
  onClaim,
  onResolve,
  onCreateTicket,
  onGoToTerminal,
  suppressing,
  unsuppressing,
  diagnosing,
  claiming,
  resolving,
  creatingTicket,
  currentThreadId,
}: IncidentHeaderProps) {
  const { locale } = useI18n();
  return (
    <div className="overflow-hidden rounded-2xl border border-zinc-200/80 bg-background p-6 shadow-sm dark:border-zinc-800/80">
      <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">

        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-xs font-semibold text-zinc-500 tracking-wider">
              {incident.incident_key}
            </span>

            <Badge variant="outline" className={`${getSeverityBadgeStyles(incident.severity)} border font-medium px-2 py-0.5 rounded text-[10px] uppercase`}>
              {incident.severity}
            </Badge>

            {incident.environment && (
              <Badge variant="secondary" className="px-2 py-0.5 rounded text-[10px] bg-zinc-100 dark:bg-zinc-800 dark:text-zinc-300">
                {incident.environment}
              </Badge>
            )}

            {incident.status === "firing" ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-rose-50 px-2.5 py-0.5 text-xs font-medium text-rose-700 dark:bg-rose-950/20 dark:text-rose-400">
                <span className="h-1.5 w-1.5 rounded-full bg-rose-500 animate-pulse" />
                {tr(locale, "发生中", "Firing", "Đang xảy ra")}
              </span>
            ) : incident.status === "resolved" ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-700 dark:bg-emerald-950/20 dark:text-emerald-400">
                <CheckCircle2Icon className="h-3.5 w-3.5" />
                {tr(locale, "已恢复", "Resolved", "Đã khôi phục")}
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-zinc-100 px-2.5 py-0.5 text-xs font-medium text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400">
                <VolumeXIcon className="h-3.5 w-3.5" />
                {tr(locale, "已静默", "Suppressed", "Đã tắt tiếng")}
              </span>
            )}

            {incident.owner_user_id && (
              <span className="inline-flex items-center gap-1 rounded-full bg-indigo-50 px-2.5 py-0.5 text-xs font-medium text-indigo-700 dark:bg-indigo-950/20 dark:text-indigo-400">
                <UserIcon className="h-3 w-3" />
                {incident.owner_user_id}
              </span>
            )}

            {incident.ticket_id && incident.ticket_url && (
              <a
                href={incident.ticket_url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 rounded-full bg-sky-50 px-2.5 py-0.5 text-xs font-medium text-sky-700 hover:text-sky-800 dark:bg-sky-950/20 dark:text-sky-400 dark:hover:text-sky-300 transition-colors"
              >
                <TicketIcon className="h-3 w-3" />
                {tr(locale, "工单", "Ticket", "Phiếu")}: {incident.ticket_id}
                <ExternalLinkIcon className="h-3 w-3" />
              </a>
            )}
          </div>

          <h2 className="mt-3 text-lg font-bold tracking-tight text-zinc-900 dark:text-zinc-50 leading-snug">
            {incident.title ?? tr(locale, "未命名告警事件", "Untitled Incident", "Sự cố chưa đặt tên")}
          </h2>

          <div className="mt-3 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-muted-foreground">
            {incident.service && (
              <span className="flex items-center gap-1.5">
                <TagIcon className="h-3.5 w-3.5" />
                {tr(locale, "服务", "Service", "Dịch vụ")}: <span className="font-semibold text-zinc-700 dark:text-zinc-300">{incident.service}</span>
              </span>
            )}

            <span className="flex items-center gap-1.5">
              <ClockIcon className="h-3.5 w-3.5" />
              {tr(locale, "首次检测", "First seen", "Phát hiện lần đầu")}: {formatDate(incident.first_seen_at, true)}
            </span>

            <span className="flex items-center gap-1.5">
              <ClockIcon className="h-3.5 w-3.5" />
              {tr(locale, "最近发生", "Last seen", "Gần nhất")}: {formatDate(incident.last_seen_at, true)}
            </span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0 border-t border-zinc-100 pt-4 md:border-none md:pt-0">
          {incident.status === "firing" && !incident.owner_user_id && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 h-9 border-indigo-300 dark:border-indigo-800 bg-indigo-50/50 hover:bg-indigo-100 dark:bg-indigo-950/20 dark:hover:bg-indigo-950/40 text-indigo-700 dark:text-indigo-400"
              onClick={onClaim}
              disabled={claiming}
            >
              <UserPlusIcon className="h-3.5 w-3.5" />
              {claiming ? tr(locale, "认领中...", "Claiming...", "Đang nhận...") : tr(locale, "认领", "Claim", "Nhận xử lý")}
            </Button>
          )}

          {incident.status === "firing" && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 h-9"
              onClick={onSuppress}
              disabled={suppressing}
            >
              <VolumeXIcon className="h-3.5 w-3.5 text-zinc-500" />
              {tr(locale, "标记误报 (Suppress)", "Suppress", "Đánh dấu báo động giả")}
            </Button>
          )}

          {incident.status === "suppressed" && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 h-9 border-amber-300 dark:border-amber-900 bg-amber-500/10 hover:bg-amber-500/20 text-amber-800 dark:text-amber-300"
              onClick={onUnsuppress}
              disabled={unsuppressing}
            >
              <RefreshCwIcon className="h-3.5 w-3.5 text-amber-600 dark:text-amber-400" />
              {tr(locale, "撤销误报 (Revert Suppression)", "Unsuppress", "Hoàn tác tắt tiếng")}
            </Button>
          )}

          {incident.status !== "resolved" && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 h-9 border-emerald-300 dark:border-emerald-800 bg-emerald-50/50 hover:bg-emerald-100 dark:bg-emerald-950/20 dark:hover:bg-emerald-950/40 text-emerald-700 dark:text-emerald-400"
              onClick={onResolve}
              disabled={resolving}
            >
              <CheckCircle2Icon className="h-3.5 w-3.5" />
              {resolving ? tr(locale, "恢复中...", "Resolving...", "Đang đóng...") : tr(locale, "标记已恢复", "Resolve", "Đánh dấu đã xử lý")}
            </Button>
          )}

          {incident.status === "firing" && (
            <Button
              size="sm"
              className="gap-1.5 h-9 bg-primary text-primary-foreground font-medium hover:bg-primary/95 transition shadow-sm"
              onClick={onOpenDiagnosis}
            >
              <SparklesIcon className="h-3.5 w-3.5" />
              {diagnosing || incident.diagnosis_status === "running"
                ? tr(locale, "诊断中...", "Diagnosing...", "Đang chẩn đoán...")
                : currentThreadId || incident.diagnosis_status === "completed"
                  ? tr(locale, "查看诊断过程", "View Diagnosis", "Xem quá trình chẩn đoán")
                  : tr(locale, "开始深度诊断", "Start Deep Diagnosis", "Bắt đầu chẩn đoán sâu")}
              <ArrowRightIcon className="h-3.5 w-3.5" />
            </Button>
          )}

          {!incident.ticket_id && (
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5 h-9 border-sky-300 dark:border-sky-800 bg-sky-50/50 hover:bg-sky-100 dark:bg-sky-950/20 dark:hover:bg-sky-950/40 text-sky-700 dark:text-sky-400"
              onClick={onCreateTicket}
              disabled={creatingTicket}
            >
              <TicketIcon className="h-3.5 w-3.5" />
              {creatingTicket ? tr(locale, "创建中...", "Creating...", "Đang tạo...") : tr(locale, "创建工单", "Create Ticket", "Tạo phiếu")}
            </Button>
          )}

          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 h-9"
            onClick={onExportReport}
          >
            <DownloadIcon className="h-3.5 w-3.5" />
            {tr(locale, "导出诊断报告", "Export Report", "Xuất báo cáo chẩn đoán")}
          </Button>

          {incident.status === "firing" && (incident.ai_summary || incident.ai_suggestion) && (
            <Button
              size="sm"
              className="gap-1.5 h-9 bg-emerald-600 hover:bg-emerald-500 text-white font-medium shadow-sm shadow-emerald-500/20"
              onClick={onGoToTerminal}
            >
              <TerminalIcon className="h-3.5 w-3.5" />
              {tr(locale, "到终端排查", "Troubleshoot in Terminal", "Kiểm tra trên Terminal")}
            </Button>
          )}
        </div>

      </div>
    </div>
  );
}
