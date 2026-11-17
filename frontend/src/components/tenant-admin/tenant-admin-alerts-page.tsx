"use client";

import { ShieldAlertIcon, CableIcon, SlidersIcon, SettingsIcon, ActivityIcon } from "lucide-react";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { tr } from "@/core/i18n";
import { useI18n } from "@/core/i18n/hooks";
import { AlertSourcesTab } from "./alert-sources-tab";
import { AlertRulesTab } from "./alert-rules-tab";
import { AlertingSettingsTab } from "./alerting-settings-tab";
import { EscalationRulesPanel } from "@/components/workspace/incidents/escalation-rules-panel";

export function TenantAdminAlertsPage() {
  const { locale } = useI18n();
  return (
    <div className="space-y-6">
      {/* 顶层主 Header */}
      <div>
        <h1 className="flex items-center gap-2.5 text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
          <ShieldAlertIcon className="h-6 w-6 text-zinc-800 dark:text-zinc-200" />
          {tr(locale, "智能告警与治理规则", "Smart Alerts & Governance Rules", "Cảnh báo thông minh & Quy tắc quản trị")}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {tr(
            locale,
            "配置并维护工作空间的第三方告警源 Webhook 接入，并配置实时智能治理规则对异常信号流执行去重、聚合与标记静默。",
            "Configure and maintain third-party alert source webhooks for the workspace, and set up real-time governance rules for deduplication, aggregation, and suppression.",
            "Cấu hình và duy trì kết nối Webhook nguồn cảnh báo bên thứ ba cho không gian làm việc, đồng thời thiết lập quy tắc quản trị thời gian thực để khử trùng lặp, gom nhóm và tắt tiếng tín hiệu bất thường."
          )}
        </p>
      </div>

      {/* 标签页导航 */}
      <Tabs defaultValue="sources" className="w-full">
        <TabsList className="grid w-fit grid-cols-3 mb-6 h-10 p-1 bg-zinc-100 dark:bg-zinc-900 rounded-lg">
          <TabsTrigger value="sources" className="flex items-center gap-1.5 px-4 text-xs font-semibold">
            <CableIcon className="h-3.5 w-3.5" />
            {tr(locale, "接入源与映射", "Sources & Mapping", "Nguồn kết nối & Ánh xạ")}
          </TabsTrigger>
          <TabsTrigger value="rules" className="flex items-center gap-1.5 px-4 text-xs font-semibold">
            <SlidersIcon className="h-3.5 w-3.5" />
            {tr(locale, "治理与升级规则", "Governance & Escalation", "Quy tắc quản trị & Leo thang")}
          </TabsTrigger>
          <TabsTrigger value="settings" className="flex items-center gap-1.5 px-4 text-xs font-semibold">
            <SettingsIcon className="h-3.5 w-3.5" />
            {tr(locale, "全局设置", "Global Settings", "Cài đặt chung")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="sources" className="space-y-4 focus-visible:outline-none">
          <AlertSourcesTab />
        </TabsContent>

        <TabsContent value="rules" className="space-y-8 focus-visible:outline-none">
          <AlertRulesTab />
          <EscalationRulesPanel />
        </TabsContent>

        <TabsContent value="settings" className="space-y-4 focus-visible:outline-none">
          <AlertingSettingsTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
