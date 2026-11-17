"use client";

import { useEffect, useState } from "react";
import {
  SaveIcon,
  Loader2Icon,
  ShieldAlertIcon,
  BellIcon,
  MessageSquareIcon,
  SendIcon,
  CheckCircle2Icon,
  RadioIcon,
  BookOpenIcon,
  HelpCircleIcon,
  ExternalLinkIcon,
  SparklesIcon,
  ChevronDownIcon,
  ChevronUpIcon,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from "@/components/ui/card";
import { fetchAuthApi } from "@/core/api/auth-client";
import { tr } from "@/core/i18n";
import { useI18n } from "@/core/i18n/hooks";

interface ImSettings {
  enabled: boolean;
  channels: string[];
  chat_ids: Record<string, string>;
}

const DEFAULT_SETTINGS: ImSettings = { enabled: false, channels: [], chat_ids: {} };

const getAvailableChannels = (locale: string) => [
  { key: "feishu", label: tr(locale, "飞书", "Feishu / Lark", "Feishu / Lark"), desc: tr(locale, "Lark / 飞书群机器人", "Lark / Feishu group bot", "Bot nhóm Lark / Feishu") },
  { key: "slack", label: "Slack", desc: tr(locale, "Slack workspace channel", "Slack workspace channel", "Kênh Slack workspace") },
  { key: "telegram", label: "Telegram", desc: tr(locale, "Telegram bot chat", "Telegram bot chat", "Nhóm chat bot Telegram") },
];

async function getImSettings(): Promise<ImSettings> {
  const resp = await fetchAuthApi("/api/tenant-im/settings");
  if (!resp.ok) throw new Error("Failed to load IM settings");
  return { ...DEFAULT_SETTINGS, ...(await resp.json()) };
}

async function saveImSettings(data: ImSettings): Promise<void> {
  const resp = await fetchAuthApi("/api/tenant-im/settings", {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!resp.ok) throw new Error(((await resp.json().catch(() => ({}))) as { detail?: string }).detail || "Failed to save");
}

async function testChannel(channelName: string, chatId: string): Promise<boolean> {
  const resp = await fetchAuthApi("/api/channels/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ channel_name: channelName, chat_id: chatId }),
  });
  return (await resp.json()).success;
}

async function getChannelStatus(): Promise<Record<string, { enabled: boolean; running: boolean }>> {
  const resp = await fetchAuthApi("/api/channels/");
  return ((await resp.json()).channels || {}) as Record<string, { enabled: boolean; running: boolean }>;
}

export function TenantImSettingsPage() {
  const { locale } = useI18n();
  const availableChannels = getAvailableChannels(locale);
  const [settings, setSettings] = useState<ImSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [channelStatus, setChannelStatus] = useState<Record<string, { enabled: boolean; running: boolean }>>({});
  const [showGuide, setShowGuide] = useState(false);
  const [activeGuideTab, setActiveGuideTab] = useState<"feishu" | "slack" | "telegram">("feishu");

  useEffect(() => {
    Promise.all([getImSettings(), getChannelStatus()])
      .then(([s, cs]) => {
        setSettings(s);
        setChannelStatus(cs);
      })
      .catch((e) => setError(e instanceof Error ? e.message : tr(locale, "加载失败", "Failed to load", "Tải thất bại")))
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await saveImSettings(settings);
      toast.success(tr(locale, "渠道配置已保存", "Channel settings saved", "Đã lưu cấu hình kênh"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : tr(locale, "保存失败", "Failed to save", "Lưu thất bại"));
    }
    finally {
      setSaving(false);
    }
  };

  const toggleChannel = (key: string) => {
    setSettings((prev) => ({
      ...prev,
      channels: prev.channels.includes(key)
        ? prev.channels.filter((c) => c !== key)
        : [...prev.channels, key],
    }));
  };

  const handleTest = async (channelKey: string) => {
    const chatIdStr = settings.chat_ids[channelKey];
    if (!chatIdStr?.trim()) {
      toast.error(tr(locale, "请先填写 Chat ID", "Please enter Chat ID first", "Vui lòng nhập Chat ID trước"));
      return;
    }

    setTesting(channelKey);
    const channelLabel = availableChannels.find((c) => c.key === channelKey)?.label || channelKey;
    const targetIds = chatIdStr
      .split(",")
      .map((id) => id.trim())
      .filter((id) => id !== "");

    if (targetIds.length === 0) {
      toast.error(tr(locale, "无有效的接收群聊 ID", "No valid target chat IDs", "Không có ID nhóm nhận hợp lệ"));
      setTesting(null);
      return;
    }

    toast.info(tr(locale, `正在并发向 ${targetIds.length} 个 ${channelLabel} 接收群聊推送测试消息...`, `Sending test message to ${targetIds.length} ${channelLabel} chat(s)...`, `Đang gửi tin nhắn thử tới ${targetIds.length} nhóm ${channelLabel}...`));

    let successCount = 0;
    for (const cid of targetIds) {
      try {
        const ok = await testChannel(channelKey, cid);
        if (ok) {
          successCount++;
          toast.success(`[${channelLabel}] ${cid} ✅`);
        } else {
          toast.error(`[${channelLabel}] ${cid} ❌`);
        }
      } catch {
        toast.error(`[${channelLabel}] ${cid} ❌`);
      }
    }

    if (successCount === targetIds.length) {
      toast.success(tr(locale, `🎉 ${channelLabel} 所有配置群组连通性验证全部通过！`, `All ${channelLabel} chats connected successfully!`, `Tất cả nhóm ${channelLabel} kết nối thành công!`));
    } else {
      toast.warning(tr(locale, `⚠️ 测试完成，成功率: ${successCount}/${targetIds.length}，请检查失败的群聊密钥。`, `Test completed: ${successCount}/${targetIds.length} succeeded.`, `Kiểm tra xong: ${successCount}/${targetIds.length} thành công.`));
    }
    setTesting(null);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2Icon className="h-8 w-8 animate-spin text-zinc-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[400px] text-center">
        <ShieldAlertIcon className="h-12 w-12 text-red-500" />
        <h3 className="mt-4 text-base font-semibold">{tr(locale, "加载失败", "Failed to load", "Tải thất bại")}</h3>
        <p className="mt-2 text-xs text-muted-foreground">{error}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2.5 text-xl font-bold tracking-tight text-zinc-900 dark:text-zinc-50">
            <RadioIcon className="h-6 w-6 text-zinc-800 dark:text-zinc-200" />
            {tr(locale, "渠道管理", "IM Channels", "Kênh liên lạc (IM)")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {tr(locale, "配置工作空间的即时通讯渠道凭证。告警通知、降噪日报等模块将引用此处的推送群组", "Configure workspace IM channel credentials for alert notifications and daily digests.", "Cấu hình thông tin kết nối kênh IM cho không gian làm việc. Thông báo cảnh báo và báo cáo sẽ gửi tới các nhóm này.")}
          </p>
        </div>

        <Button
          type="button"
          variant="outline"
          onClick={() => setShowGuide(!showGuide)}
          className="gap-2 text-xs font-semibold h-9 shadow-sm hover:bg-zinc-50 dark:hover:bg-zinc-900 border-zinc-250 dark:border-zinc-800"
        >
          <BookOpenIcon className="h-3.5 w-3.5" />
          {showGuide ? tr(locale, "折叠配置指南", "Hide Guide", "Thu gọn hướng dẫn") : tr(locale, "打开对接配置指南", "Setup Guide", "Mở hướng dẫn cấu hình")}
          {showGuide ? <ChevronUpIcon className="h-3 w-3" /> : <ChevronDownIcon className="h-3 w-3" />}
        </Button>
      </div>

      {/* 📘 INTERACTIVE CONFIGURATION GUIDE */}
      {showGuide && (
        <Card className="border-indigo-150 dark:border-indigo-900/60 bg-gradient-to-br from-indigo-50/10 via-transparent to-rose-50/5 dark:from-indigo-950/5 dark:to-transparent overflow-hidden shadow-sm animate-fadeIn">
          <CardHeader className="pb-4">
            <CardTitle className="text-sm font-bold text-indigo-900 dark:text-indigo-400 flex items-center gap-1.5">
              <SparklesIcon className="h-4 w-4" />
              {tr(locale, "渠道对接连通配置指南", "Channel Setup Guide", "Hướng dẫn kết nối kênh liên lạc")}
            </CardTitle>
            <CardDescription className="text-xs">
              {tr(locale, "选择下方不同渠道标签，快速了解如何获取群聊接收凭据 (Chat ID)。", "Select a channel tab below to learn how to obtain its Chat ID.", "Chọn tab kênh bên dưới để xem hướng dẫn lấy Chat ID.")}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Guide Tabs */}
            <div className="flex border-b border-zinc-200 dark:border-zinc-800 pb-px">
              {(["feishu", "slack", "telegram"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => setActiveGuideTab(tab)}
                  className={`px-4 py-2 text-xs font-semibold border-b-2 transition-all -mb-px ${
                    activeGuideTab === tab
                      ? "border-indigo-600 text-indigo-700 dark:border-indigo-400 dark:text-indigo-400"
                      : "border-transparent text-zinc-500 hover:text-zinc-800 dark:hover:text-zinc-300"
                  }`}
                >
                  {tab === "feishu" ? tr(locale, "飞书 (Feishu)", "Feishu / Lark", "Feishu / Lark") : tab === "slack" ? "Slack" : "Telegram"}
                </button>
              ))}
            </div>

            {/* Guide Content */}
            <div className="text-xs text-zinc-650 dark:text-zinc-350 space-y-3 leading-relaxed">
              {activeGuideTab === "feishu" && (
                <div className="space-y-2">
                  <p className="font-semibold text-zinc-850 dark:text-zinc-200">{tr(locale, "飞书群组 Chat ID 获取步骤：", "Steps to get Feishu group Chat ID:", "Các bước lấy Chat ID nhóm Feishu:")}</p>
                  <ol className="list-decimal list-inside space-y-1.5 text-zinc-600 dark:text-zinc-400">
                    <li>{tr(locale, "进入飞书目标群聊，依次点击右上角「设置 (...) → 群机器人 → 添加机器人」。", "Open target Feishu group -> Settings (...) -> Group Bots -> Add Bot.", "Mở nhóm Feishu -> Cài đặt (...) -> Bot nhóm -> Thêm Bot.")}</li>
                    <li>{tr(locale, "选择并创建「自定义机器人」，获取 Webhook 链接。", "Create a Custom Bot and get the Webhook URL.", "Chọn tạo Custom Bot và lấy đường dẫn Webhook.")}</li>
                    <li>{tr(locale, "提取 chat_id，或在群内发送 /status 获取以 oc_ 开头的 Chat ID。", "Extract chat_id or send /status in the group to get the oc_... Chat ID.", "Trích xuất chat_id hoặc gửi /status trong nhóm để lấy Chat ID bắt đầu bằng oc_.")}</li>
                  </ol>
                </div>
              )}

              {activeGuideTab === "slack" && (
                <div className="space-y-2">
                  <p className="font-semibold text-zinc-850 dark:text-zinc-200">{tr(locale, "Slack 接收端 Channel ID 获取步骤：", "Steps to get Slack Channel ID:", "Các bước lấy Channel ID trên Slack:")}</p>
                  <ol className="list-decimal list-inside space-y-1.5 text-zinc-600 dark:text-zinc-400">
                    <li>{tr(locale, "打开 Slack 客户端，右键点击希望接收通知的频道。", "Open Slack and right-click the target channel.", "Mở Slack và nhấp chuột phải vào kênh muốn nhận thông báo.")}</li>
                    <li>{tr(locale, "选择「View channel details (查看频道详情)」。", "Select 'View channel details'.", "Chọn 'View channel details' (Xem chi tiết kênh).")}</li>
                    <li>{tr(locale, "滚动到底部即可看到以 C 或 G 开头的 Channel ID（例如 C06ABC123D）。", "Scroll to the bottom to find the Channel ID starting with C or G (e.g. C06ABC123D).", "Cuộn xuống cuối để thấy Channel ID bắt đầu bằng C hoặc G (vd: C06ABC123D).")}</li>
                  </ol>
                </div>
              )}

              {activeGuideTab === "telegram" && (
                <div className="space-y-2">
                  <p className="font-semibold text-zinc-850 dark:text-zinc-200">{tr(locale, "Telegram 目标群组 Chat ID 获取步骤：", "Steps to get Telegram Chat ID:", "Các bước lấy Chat ID nhóm Telegram:")}</p>
                  <ol className="list-decimal list-inside space-y-1.5 text-zinc-600 dark:text-zinc-400">
                    <li>{tr(locale, "搜索 @BotFather 并发送 /newbot 创建机器人获取 API Token。", "Search @BotFather and send /newbot to create a bot and get its API Token.", "Tìm @BotFather và gửi /newbot để tạo bot và lấy API Token.")}</li>
                    <li>{tr(locale, "将机器人添加为目标群组的管理员并发送一条测试消息。", "Add the bot as admin to your target group and send a test message.", "Thêm bot làm quản trị viên của nhóm và gửi một tin nhắn thử.")}</li>
                    <li>{tr(locale, "访问 https://api.telegram.org/bot<YourBotToken>/getUpdates 获取 chat.id（群组 ID 通常为负数）。", "Visit https://api.telegram.org/bot<YourBotToken>/getUpdates to find chat.id (usually negative for groups).", "Truy cập https://api.telegram.org/bot<YourBotToken>/getUpdates để lấy chat.id (thường là số âm với nhóm).")}</li>
                  </ol>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* ⚙️ CHANNEL CONFIGURATIONS */}
      <Card className="border-zinc-200 dark:border-zinc-800 shadow-md">
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-indigo-50 dark:bg-indigo-950/20 border border-indigo-100 dark:border-indigo-900/50">
                <BellIcon className="h-5 w-5 text-indigo-600 dark:text-indigo-400" />
              </div>
              <div>
                <CardTitle className="text-base font-semibold">{tr(locale, "渠道总开关", "Enable IM Channels", "Bật kênh liên lạc")}</CardTitle>
                <CardDescription className="text-xs mt-0.5">{tr(locale, "启用后，下方激活的渠道即可实时接收到系统智能告警通知和系统消息", "When enabled, active channels below receive real-time alert notifications.", "Khi bật, các kênh được kích hoạt bên dưới sẽ nhận thông báo cảnh báo theo thời gian thực.")}</CardDescription>
              </div>
            </div>
            <Switch
              checked={settings.enabled}
              onCheckedChange={(v) => setSettings({ ...settings, enabled: v })}
              disabled={saving}
            />
          </div>
        </CardHeader>

        {settings.enabled && (
          <CardContent className="space-y-6">
            <div>
              <label className="text-xs font-semibold text-zinc-600 dark:text-zinc-400 block mb-2">{tr(locale, "可用渠道配置", "Available Channels", "Các kênh khả dụng")}</label>
              <p className="text-[11px] text-muted-foreground mb-4">{tr(locale, "选择此工作空间使用的即时通讯渠道，并开启或关闭各个接收端", "Select IM channels for this workspace.", "Chọn các kênh liên lạc sử dụng cho không gian làm việc này.")}</p>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {availableChannels.map((ch) => {
                  const active = settings.channels.includes(ch.key);
                  const status = channelStatus[ch.key];
                  return (
                    <button
                      key={ch.key}
                      type="button"
                      onClick={() => toggleChannel(ch.key)}
                      disabled={saving}
                      className={`flex items-start gap-3 rounded-xl border p-4.5 text-left transition-all duration-200 ${
                        active
                          ? "border-indigo-300 bg-indigo-50/20 dark:border-indigo-800/40 dark:bg-indigo-950/10 shadow-sm"
                          : "border-zinc-200 bg-background dark:border-zinc-800 hover:border-zinc-300"
                      }`}
                    >
                      <div
                        className={`mt-0.5 h-5 w-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                          active ? "border-indigo-600 bg-indigo-600" : "border-zinc-300 dark:border-zinc-700"
                        }`}
                      >
                        {active && <CheckCircle2Icon className="h-3.5 w-3.5 text-white" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <MessageSquareIcon className={`h-4.5 w-4.5 shrink-0 ${active ? "text-indigo-500" : "text-zinc-450"}`} />
                          <span className="text-sm font-bold text-zinc-800 dark:text-zinc-200">{ch.label}</span>
                        </div>
                        <p className="text-[10px] text-zinc-400 mt-1 leading-normal">{ch.desc}</p>
                        {status && (
                          <div className="mt-3.5 flex items-center gap-1.5 text-[9px] font-semibold">
                            <span className={`h-1.5 w-1.5 rounded-full ${status.running ? "bg-emerald-500 animate-ping" : "bg-zinc-300 dark:bg-zinc-700"}`} />
                            <span className={status.running ? "text-emerald-650 dark:text-emerald-400" : "text-zinc-400"}>
                              {status.running
                                ? tr(locale, "底层服务可用", "Service running", "Dịch vụ đang chạy")
                                : tr(locale, "底层服务未启动", "Service stopped", "Dịch vụ chưa chạy")}
                            </span>
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>

            {settings.channels.length > 0 && (
              <div className="space-y-4 rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-50/10 dark:bg-zinc-900/5 p-4.5">
                <div className="space-y-1">
                  <label className="text-xs font-semibold text-zinc-700 dark:text-zinc-300 flex items-center gap-1">
                    {tr(locale, "群聊 Chat ID 密钥录入", "Target Chat IDs", "Nhập Chat ID nhóm nhận")}
                  </label>
                  <p className="text-[10px] text-zinc-400">
                    {tr(locale, "配置通知接收群组的凭据 ID。支持配置多个群组（以英文逗号分隔），发生告警时将并发分发到所有地址。", "Configure target chat IDs (comma-separated for multiple chats).", "Cấu hình ID nhóm nhận thông báo (phân tách bằng dấu phẩy nếu có nhiều nhóm).")}
                  </p>
                </div>

                <div className="space-y-4.5">
                  {settings.channels.map((ch) => (
                    <div key={ch} className="space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="font-semibold text-zinc-700 dark:text-zinc-350">
                          {availableChannels.find((c) => c.key === ch)?.label} Chat ID
                        </span>
                        <span className="text-[10px] text-zinc-400 font-mono">
                          {ch === "feishu" ? "oc_xxx" : ch === "slack" ? "Cxxx" : "-xxx"}
                        </span>
                      </div>
                      <div className="flex gap-2">
                        <Input
                          value={settings.chat_ids[ch] || ""}
                          onChange={(e) =>
                            setSettings({
                              ...settings,
                              chat_ids: { ...settings.chat_ids, [ch]: e.target.value },
                            })
                          }
                          disabled={saving}
                          className="h-10 text-xs font-mono flex-1 focus-visible:ring-indigo-500/20"
                          placeholder={
                            ch === "feishu"
                              ? "oc_123, oc_456"
                              : ch === "slack"
                              ? "C0123, C0456"
                              : "-100123, -100456"
                          }
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-10 gap-1.5 text-xs font-semibold px-4 shrink-0 hover:bg-indigo-50 hover:text-indigo-600 dark:hover:bg-indigo-950/20 dark:hover:text-indigo-400 border-zinc-200 dark:border-zinc-800"
                          disabled={testing === ch || !settings.chat_ids[ch]?.trim()}
                          onClick={() => handleTest(ch)}
                        >
                          {testing === ch ? (
                            <>
                              <Loader2Icon className="h-3.5 w-3.5 animate-spin" />
                              {tr(locale, "连通测试中", "Testing...", "Đang kiểm tra...")}
                            </>
                          ) : (
                            <>
                              <SendIcon className="h-3 w-3" />
                              {tr(locale, "测试连通性", "Test", "Kiểm tra")}
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div className="rounded-xl bg-zinc-50 dark:bg-zinc-900/40 border border-zinc-150 dark:border-zinc-850 p-4 flex items-start gap-3">
              <HelpCircleIcon className="h-4.5 w-4.5 text-indigo-500 mt-0.5 shrink-0" />
              <div className="text-xs text-zinc-500 leading-normal space-y-1">
                <p className="font-semibold text-zinc-800 dark:text-zinc-200">{tr(locale, "💡 告警策略推荐配合：", "💡 Tip:", "💡 Gợi ý:")}</p>
                <p>
                  {tr(locale, "渠道在此配置完成后，请在告警设置标签页下进一步配置通知偏好。", "After configuring channels here, configure notification preferences under Alert Settings.", "Sau khi cấu hình kênh tại đây, bạn có thể thiết lập tùy chọn thông báo trong mục Cài đặt cảnh báo.")}
                </p>
              </div>
            </div>
          </CardContent>
        )}

        <CardFooter className="border-t border-zinc-150 dark:border-zinc-800 pt-4 flex justify-end">
          <Button onClick={handleSave} disabled={saving} className="gap-2 h-10 px-6 text-xs font-semibold shadow-sm">
            {saving ? (
              <>
                <Loader2Icon className="h-3.5 w-3.5 animate-spin" />
                {tr(locale, "正在保存渠道配置...", "Saving...", "Đang lưu...")}
              </>
            ) : (
              <>
                <SaveIcon className="h-3.5 w-3.5" />
                {tr(locale, "保存渠道配置", "Save Settings", "Lưu cấu hình")}
              </>
            )}
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
