"use client";

import {
  ArrowLeft,
  Bot,
  Save,
  Sparkles,
  Loader2,
} from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useRef, useState, useMemo } from "react";
import { toast } from "sonner";
import { v4 as uuidv4 } from "uuid";

import { useAvailableModels } from "@/core/models/hooks";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useTerminalAgent } from "@/core/terminal-agent/useTerminalAgent";
import { MarkdownContent } from "@/components/workspace/messages/markdown-content";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  getSkillDetail,
  patchTenantSkill,
  patchPersonalSkill,
  createPersonalSkill,
  generateInstructions,
} from "@/core/skills/api";
import { tr } from "@/core/i18n";
import { useI18n } from "@/core/i18n/hooks";
import type { SkillDetail } from "@/core/skills/type";

export default function SkillDetailPage() {
  const { t, locale } = useI18n();
  const params = useParams();
  const router = useRouter();
  const skillName = params.name as string;
  const isNew = skillName === "new";

  const [skill, setSkill] = useState<SkillDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);

  const { models: availableModels } = useAvailableModels();
  const [selectedModel, setSelectedModel] = useState("gpt-4o");

  // Edit state
  const [instructions, setInstructions] = useState("");
  const [description, setDescription] = useState("");
  const [boundToolsText, setBoundToolsText] = useState("");
  const [strategy, setStrategy] = useState("default");

  // For new skill creation
  const [newName, setNewName] = useState("");

  // AI generation prompt
  const [genPrompt, setGenPrompt] = useState("");
  const [dirty, setDirty] = useState(false);

  const sessionId = useMemo(() => uuidv4(), []);

  // Real test chat using the LangGraph backend agent
  const {
    messages,
    input: testInput,
    handleInputChange,
    handleSubmit,
    sendMessage,
    isLoading: testLoading,
  } = useTerminalAgent({
    taskId: sessionId,
    mode: "sandbox",
    modelName: selectedModel,
    skillInstructions: instructions,
    onExecuteCommand: async () => {
      toast.error(tr(locale, "Sandbox 环境不支持手动执行终端命令", "Sandbox does not support manual terminal commands", "Môi trường Sandbox không hỗ trợ chạy lệnh terminal thủ công"));
      return "";
    },
  });

  const instructionsRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!skillName) return;

    if (isNew) {
      setSkill({
        name: "New Skill",
        scope: "personal",
        managed_by_current_user: true,
        description: "",
        instructions: "",
        bound_tools: [],
        enabled: true,
        category: "uncategorized",
        license: "private",
      } as unknown as SkillDetail);
      setLoading(false);
      return;
    }

    setLoading(true);
    getSkillDetail(skillName)
      .then((data) => {
        setSkill(data);
        setInstructions(data.instructions || "");
        setDescription(data.description || "");
        setBoundToolsText((data.bound_tools || []).join(", "));
        setStrategy(data.strategy || "default");
      })
      .catch(() => toast.error(tr(locale, "加载 Skill 详情失败", "Failed to load skill detail", "Tải chi tiết kỹ năng thất bại")))
      .finally(() => setLoading(false));
  }, [skillName, isNew]);

  const handleSave = async () => {
    if (!skill) return;
    if (isNew) {
      if (!newName.trim()) {
        toast.error(t.tenantAdmin.skills.nameRequired);
        return;
      }
      if (!/^[a-z0-9_]+$/.test(newName)) {
        toast.error(tr(locale, "名称只能包含小写字母、数字和下划线", "Name can only contain lowercase letters, digits, and underscores", "Tên chỉ được chứa chữ thường, số và dấu gạch dưới"));
        return;
      }
    }

    if (!description.trim()) {
      toast.error(t.tenantAdmin.skills.descriptionRequired);
      return;
    }

    setSaving(true);
    try {
      if (isNew) {
        await createPersonalSkill({
          name: newName,
          description: description.trim() || "",
          instructions: instructions.trim() || null,
          enabled: true,
          bound_tools: boundToolsText.split(",").map((t) => t.trim()).filter(Boolean),
          strategy: strategy || null,
        });
        toast.success(t.tenantAdmin.skills.createSuccess);
        setDirty(false);
        router.push("/workspace/skills");
        return;
      }

      const payload = {
        description: description.trim() || null,
        instructions: instructions.trim() || null,
        bound_tools: boundToolsText
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        strategy: strategy || null,
      };

      if (skill.scope === "personal") {
        await patchPersonalSkill(skill.name, payload);
      } else {
        await patchTenantSkill(skill.name, payload);
      }

      setDirty(false);
      toast.success(t.tenantAdmin.skills.updateSuccess);
      router.push("/workspace/skills");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tr(locale, "保存失败", "Failed to save", "Lưu thất bại"));
    } finally {
      setSaving(false);
    }
  };

  const handleAIGenerate = async () => {
    if (!genPrompt.trim()) {
      toast.error(tr(locale, "请输入你想让 Skill 做什么", "Please describe what you want this skill to do", "Vui lòng mô tả điều bạn muốn kỹ năng này thực hiện"));
      return;
    }
    setAiLoading(true);
    try {
      const result = await generateInstructions(genPrompt.trim(), selectedModel);
      setInstructions(result.instructions);
      setDirty(true);
      toast.success(tr(locale, "AI 已生成 Instructions，请检查并调整", "AI generated instructions; please review and adjust", "AI đã tạo hướng dẫn, vui lòng kiểm tra và điều chỉnh"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tr(locale, "生成失败", "Generation failed", "Tạo thất bại"));
    } finally {
      setAiLoading(false);
    }
  };

  const handleTest = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!testInput.trim() || testLoading) return;
    sendMessage({ text: testInput.trim() });
  };

  if (loading) {
    return (
      <div className="flex size-full items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!skill) {
    return (
      <div className="flex size-full items-center justify-center text-muted-foreground">
        {tr(locale, "Skill 未找到", "Skill not found", "Không tìm thấy kỹ năng")}
      </div>
    );
  }

  // User can edit if they manage it (either they are admin for tenant skills, or it's their personal skill)
  // Global skills are built-in and never editable.
  const canEdit = skill.managed_by_current_user && skill.scope !== "global";

  return (
    <div className="flex size-full flex-col bg-zinc-50/50 dark:bg-zinc-950/20 overflow-hidden animate-in fade-in duration-300">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b px-6 py-4">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => router.back()}
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            {isNew ? (
              <h1 className="text-xl font-semibold">{t.tenantAdmin.skills.createTitle}</h1>
            ) : (
              <>
                <h1 className="text-xl font-semibold">{skill.name}</h1>
                <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                  <Badge
                    variant="secondary"
                    className="text-[10px]"
                  >
                    v{skill.version || 1}
                  </Badge>
                  {skill.category && (
                    <span>{skill.category}</span>
                  )}
                  {skill.usage_count !== undefined && skill.usage_count > 0 && (
                    <span>· {tr(locale, `使用 ${skill.usage_count} 次`, `Used ${skill.usage_count} times`, `Đã dùng ${skill.usage_count} lần`)}</span>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={selectedModel}
            onValueChange={setSelectedModel}
            disabled={aiLoading || testLoading}
          >
            <SelectTrigger className="w-[180px] h-9">
              <SelectValue placeholder={t.inputBox.selectModel} />
            </SelectTrigger>
            <SelectContent>
              {availableModels?.map((model) => (
                <SelectItem key={model.name} value={model.name}>
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-3 w-3 text-muted-foreground" />
                    {model.name}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            onClick={handleSave}
            disabled={!canEdit || saving}
          >
            <Save className="mr-2 h-4 w-4" />
            {saving ? t.tenantAdmin.skills.saving : t.tenantAdmin.skills.save}
          </Button>
        </div>
      </div>

      {/* Main content: left edit + right test */}
      <div className="flex flex-1 overflow-hidden p-6 gap-6">
        {/* Left panel — Instructions editor */}
        <div className="flex w-3/5 flex-col bg-card rounded-xl border shadow-sm overflow-hidden">
          {/* Header for Left Panel */}
          <div className="flex items-center gap-2 border-b px-4 py-3 bg-muted/30">
            <span className="text-sm font-medium">{tr(locale, "配置说明", "Configuration", "Cấu hình")}</span>
            <span className="text-[10px] text-muted-foreground ml-auto">
              {tr(locale, "编写 Skill 的核心逻辑和执行步骤", "Write core logic and execution steps for this skill", "Viết logic cốt lõi và các bước thực thi cho kỹ năng")}
            </span>
          </div>

          <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-6">
            {/* Name (New Mode) */}
            {isNew && (
              <div>
                <label className="text-sm font-medium">{t.tenantAdmin.skills.nameLabel}<span className="text-red-500 ml-1">*</span></label>
                <Input
                  value={newName}
                  onChange={e => { setNewName(e.target.value); setDirty(true); }}
                  placeholder={tr(locale, "输入小写英文名称", "Enter lowercase English name", "Nhập tên tiếng Anh viết thường")}
                  className="mt-1.5 font-semibold text-sm"
                />
                <span className="text-[10px] text-muted-foreground mt-1 block">
                  {tr(locale, "仅限小写字母、数字、下划线", "Lowercase letters, digits, underscores only", "Chỉ cho phép chữ thường, số và dấu gạch dưới")}
                </span>
              </div>
            )}

            {/* Description */}
            <div>
              <label className="text-sm font-medium">{t.tenantAdmin.skills.descriptionLabel}<span className="text-red-500 ml-1">*</span></label>
              <Input
                value={description}
                onChange={(e) => {
                  setDescription(e.target.value);
                  setDirty(true);
                }}
                placeholder={t.tenantAdmin.skills.descriptionPlaceholder}
                disabled={!canEdit}
                className="mt-1.5"
              />
            </div>

          {/* Instructions Section */}
          <div className="flex-1 flex flex-col min-h-0 gap-3">
            <label className="text-sm font-medium flex items-center justify-between">
              <span>{t.tenantAdmin.skills.instructionsLabel}<span className="text-red-500 ml-1">*</span></span>
              {dirty && (
                <span className="text-[10px] text-amber-600">{tr(locale, "未保存", "Unsaved", "Chưa lưu")}</span>
              )}
            </label>

            {/* AI auto-generate panel */}
            <div className="rounded-lg border bg-card p-4 shrink-0">
              <div className="flex items-center gap-2 text-sm font-medium mb-2">
                <Sparkles className="h-4 w-4 text-primary" />
                {t.tenantAdmin.skills.aiGenerate}
              </div>
              <p className="text-xs text-muted-foreground mb-3">
                {tr(locale, "描述你想让 Agent 掌握什么能力，AI 会自动为你生成结构化的执行流与规则", "Describe what you want the agent to do and AI will generate structured instructions.", "Mô tả năng lực bạn muốn trợ lý thực hiện, AI sẽ tự động tạo luồng thực thi và quy tắc.")}
              </p>
              <div className="flex gap-2">
                <Input
                  value={genPrompt}
                  onChange={(e) => setGenPrompt(e.target.value)}
                  placeholder={t.tenantAdmin.skills.aiGeneratePlaceholder}
                  className="flex-1"
                  disabled={!canEdit}
                />
                <Button
                  onClick={handleAIGenerate}
                  disabled={!canEdit || aiLoading}
                  size="sm"
                >
                  {aiLoading ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    tr(locale, "生成", "Generate", "Tạo")
                  )}
                </Button>
              </div>
            </div>

            <Textarea
              ref={instructionsRef}
              value={instructions}
              onChange={(e) => {
                setInstructions(e.target.value);
                setDirty(true);
              }}
              placeholder={t.tenantAdmin.skills.instructionsPlaceholder}
              className="flex-1 min-h-[300px] font-mono text-sm"
              disabled={!canEdit}
            />
          </div>
          </div>
        </div>

        {/* Right panel — Test chat */}
        <div className="flex w-2/5 flex-col bg-card rounded-xl border shadow-sm overflow-hidden">
          <div className="flex items-center gap-2 border-b px-4 py-3 bg-muted/30">
            <Bot className="h-4 w-4 text-primary" />
            <span className="text-sm font-medium">{t.tenantAdmin.skills.testChat}</span>
            <span className="text-[10px] text-muted-foreground ml-auto">
              {t.tenantAdmin.skills.testChatHint}
            </span>
          </div>

          {/* Chat messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.length === 0 && (
              <div className="text-center text-sm text-muted-foreground mt-10">
                {t.tenantAdmin.skills.testChatHint}
              </div>
            )}
            {messages.map((msg, idx) => {
              const role = msg.role || msg.type;
              const isUser = role === "user" || role === "human";
              let textContent = "";
              if (typeof msg.content === "string") textContent = msg.content;
              else if (Array.isArray(msg.content)) {
                textContent = msg.content.filter((p: any) => p.type === "text").map((p: any) => p.text).join("\n");
              }

              // Find tools if any
              const toolCalls = Array.isArray(msg.tool_calls) ? msg.tool_calls : [];

              return (
                <div
                  key={msg.id || idx}
                  className={`flex flex-col gap-1 ${isUser ? "items-end" : "items-start"
                    }`}
                >
                  {isUser && textContent && (
                    <div className="max-w-[85%] rounded-2xl rounded-tr-sm bg-primary px-4 py-2 text-[13px] text-primary-foreground shadow-sm whitespace-pre-wrap">
                      {textContent}
                    </div>
                  )}

                  {!isUser && (
                    <div className="flex flex-col gap-2 max-w-[90%]">
                      {textContent && (
                        <div className="markdown-body text-[13px] text-zinc-800 leading-relaxed bg-muted/30 px-4 py-3 rounded-2xl rounded-tl-sm border shadow-sm">
                          <MarkdownContent content={textContent} isLoading={false} rehypePlugins={[]} />
                        </div>
                      )}
                      {toolCalls.map((tc: any) => (
                        <div key={tc.id} className="text-[11px] text-muted-foreground font-mono bg-muted px-2 py-1 rounded">
                          $ {tc.name}(...)
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}

            {testLoading && (
              <div className="flex justify-start">
                <div className="max-w-[80%] flex items-center gap-2 rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t.messageList.streamingThinking}
                </div>
              </div>
            )}
          </div>

          <div className="border-t p-3">
            <form onSubmit={handleTest} className="flex gap-2">
              <Input
                value={testInput}
                onChange={(e) => handleInputChange(e as any)}
                placeholder={t.tenantAdmin.skills.testChatPlaceholder}
                className="flex-1"
              />
              <Button type="submit" disabled={testLoading || !testInput.trim()}>
                {tr(locale, "发送", "Send", "Gửi")}
              </Button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
}
