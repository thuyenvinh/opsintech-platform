"use client";

import { BotIcon, CheckCircle2Icon, XIcon, AlertCircleIcon, ChevronDown, SparklesIcon, BookOpenIcon } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useSkills, useCreateAgent } from "@/core/agents";
import { useCurrentTenant } from "@/core/tenants/hooks";
import { isTenantAdminRole } from "@/core/permissions/scope";
import { checkAgentName } from "@/core/agents/api";
import { tr } from "@/core/i18n";
import { useI18n } from "@/core/i18n/hooks";
import { useAvailableMcpConfig } from "@/core/mcp/hooks";
import { useAvailableModels } from "@/core/models/hooks";
import { useKnowledgeBases } from "@/core/knowledge";
import { cn } from "@/lib/utils";

interface CreateAgentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess?: () => void;
}

const NAME_RE = /^[A-Za-z0-9-]+$/;

export function CreateAgentDialog({ open, onOpenChange, onSuccess }: CreateAgentDialogProps) {
  const { t, locale } = useI18n();

  const { skills } = useSkills();
  const createAgent = useCreateAgent();
  const { rawArray: availableMcps, isLoading: isLoadingMcps } = useAvailableMcpConfig();
  const { models: availableModels, isLoading: isLoadingModels } = useAvailableModels();
  const { bases: availableKnowledgeBases, isLoading: isLoadingKbs } = useKnowledgeBases();

  // Form states
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [selectedSkills, setSelectedSkills] = useState<Set<string>>(new Set());
  const [selectedToolGroups, setSelectedToolGroups] = useState<Set<string>>(new Set());
  const [selectedKbIds, setSelectedKbIds] = useState<Set<string>>(new Set());
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");
  const [enabled, setEnabled] = useState(true);
  const [isShared, setIsShared] = useState(false);
  const [activeTab, setActiveTab] = useState<"mcp" | "custom" | "public">("mcp");

  const { data: currentTenant } = useCurrentTenant();
  const isTenantAdmin = isTenantAdminRole(currentTenant?.role);

  // Validation States
  const [nameError, setNameError] = useState("");
  const [isCheckingName, setIsCheckingName] = useState(false);
  const [isNameAvailable, setIsNameAvailable] = useState<boolean | null>(null);

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setName("");
      setDescription("");
      setSystemPrompt("");
      setSelectedModel("");
      setSelectedSkills(new Set());
      setSelectedToolGroups(new Set());
      setSelectedKbIds(new Set());
      setTags([]);
      setTagInput("");
      setEnabled(true);
      setIsShared(false);
      setActiveTab("mcp");
      setNameError("");
      setIsNameAvailable(null);
      setIsCheckingName(false);
    }
  }, [open]);

  // Real-time name checking with debounce/effect
  useEffect(() => {
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError("");
      setIsNameAvailable(null);
      return;
    }

    if (!NAME_RE.test(trimmed)) {
      setNameError(t.agents.nameStepInvalidError);
      setIsNameAvailable(false);
      return;
    }

    setNameError("");
    setIsNameAvailable(null);
    setIsCheckingName(true);

    const delayDebounce = setTimeout(async () => {
      try {
        const result = await checkAgentName(trimmed, isShared);
        if (result.available) {
          setIsNameAvailable(true);
          setNameError("");
        } else {
          setIsNameAvailable(false);
          setNameError(t.agents.nameStepAlreadyExistsError);
        }
      } catch {
        setNameError(t.agents.nameStepCheckError);
        setIsNameAvailable(false);
      } finally {
        setIsCheckingName(false);
      }
    }, 400);

    return () => clearTimeout(delayDebounce);
  }, [name, isShared, t.agents.nameStepInvalidError, t.agents.nameStepAlreadyExistsError, t.agents.nameStepCheckError]);

  // Group skills by category
  const skillsByCategory = skills.reduce(
    (acc, skill) => {
      const cat = skill.category || "other";
      if (!acc[cat]) acc[cat] = [];
      acc[cat].push(skill);
      return acc;
    },
    {} as Record<string, typeof skills>,
  );

  const toggleSkill = (skillName: string) => {
    const next = new Set(selectedSkills);
    if (next.has(skillName)) {
      next.delete(skillName);
    } else {
      next.add(skillName);
    }
    setSelectedSkills(next);
  };

  const toggleToolGroup = (groupName: string) => {
    const next = new Set(selectedToolGroups);
    if (next.has(groupName)) {
      next.delete(groupName);
    } else {
      next.add(groupName);
    }
    setSelectedToolGroups(next);
  };

  const toggleKb = (kbId: string) => {
    const next = new Set(selectedKbIds);
    if (next.has(kbId)) {
      next.delete(kbId);
    } else {
      next.add(kbId);
    }
    setSelectedKbIds(next);
  };

  const addTag = useCallback(() => {
    const trimmed = tagInput.trim().toLowerCase();
    if (trimmed && !tags.includes(trimmed)) {
      setTags([...tags, trimmed]);
    }
    setTagInput("");
  }, [tagInput, tags]);

  const removeTag = (tag: string) => {
    setTags(tags.filter((t) => t !== tag));
  };

  const handleTagKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addTag();
    } else if (e.key === "Backspace" && !tagInput && tags.length > 0) {
      const lastTag = tags[tags.length - 1];
      if (lastTag) {
        removeTag(lastTag);
      }
    }
  };

  const getActiveList = () => {
    if (activeTab === "mcp") return availableMcps || [];
    if (activeTab === "custom") return skillsByCategory["custom"] || [];
    return skillsByCategory["public"] || [];
  };

  const activeList = getActiveList();
  const isAllSelected = (() => {
    if (activeList.length === 0) return false;
    if (activeTab === "mcp") {
      return activeList.every((item) => selectedToolGroups.has(item.name));
    } else {
      return activeList.every((item) => selectedSkills.has(item.name));
    }
  })();

  const handleToggleSelectAll = () => {
    if (activeTab === "mcp") {
      const next = new Set(selectedToolGroups);
      if (isAllSelected) {
        activeList.forEach((item) => next.delete(item.name));
      } else {
        activeList.forEach((item) => next.add(item.name));
      }
      setSelectedToolGroups(next);
    } else {
      const next = new Set(selectedSkills);
      if (isAllSelected) {
        activeList.forEach((item) => next.delete(item.name));
      } else {
        activeList.forEach((item) => next.add(item.name));
      }
      setSelectedSkills(next);
    }
  };

  const renderToolList = () => {
    if (activeTab === "mcp") {
      if (isLoadingMcps) {
        return <div className="text-xs text-muted-foreground py-8 text-center">{tr(locale, "正在加载 MCP 扩展...", "Loading MCP tools...", "Đang tải công cụ MCP...")}</div>;
      }
      if (!availableMcps || availableMcps.length === 0) {
        return <div className="text-xs text-muted-foreground py-8 text-center">{tr(locale, "暂无已启用的 MCP 扩展工具", "No enabled MCP tools", "Chưa có công cụ MCP nào được bật")}</div>;
      }
      return availableMcps.map((mcp) => (
        <label
          key={mcp.name}
          className="flex cursor-pointer items-start gap-2.5 rounded-md px-2 py-1.5 hover:bg-muted/50 transition-colors"
        >
          <Checkbox
            checked={selectedToolGroups.has(mcp.name)}
            onCheckedChange={() => toggleToolGroup(mcp.name)}
          />
          <div className="min-w-0 -mt-0.5">
            <div className="text-xs font-medium flex items-center gap-1.5">
              {mcp.name}
              <span className="text-[9px] px-1 bg-muted rounded font-mono text-muted-foreground uppercase">{mcp.scope}</span>
            </div>
            {mcp.description && (
              <div className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5">
                {mcp.description}
              </div>
            )}
          </div>
        </label>
      ));
    } else if (activeTab === "custom") {
      const customSkills = skillsByCategory["custom"] ?? [];
      if (customSkills.length === 0) {
        return <div className="text-xs text-muted-foreground py-8 text-center">{tr(locale, "暂无自定义技能 SOP", "No custom SOP skills", "Chưa có kỹ năng tùy chỉnh nào")}</div>;
      }
      return customSkills.map((skill) => (
        <label
          key={skill.name}
          className="flex cursor-pointer items-start gap-2.5 rounded-md px-2 py-1.5 hover:bg-muted/50 transition-colors"
        >
          <Checkbox
            checked={selectedSkills.has(skill.name)}
            onCheckedChange={() => toggleSkill(skill.name)}
          />
          <div className="min-w-0 -mt-0.5">
            <div className="text-xs font-medium">{skill.name}</div>
            {skill.description && (
              <div className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5">
                {skill.description}
              </div>
            )}
          </div>
        </label>
      ));
    } else {
      const publicSkills = skillsByCategory["public"] ?? [];
      if (publicSkills.length === 0) {
        return <div className="text-xs text-muted-foreground py-8 text-center">{tr(locale, "暂无内置技能 SOP", "No built-in SOP skills", "Chưa có kỹ năng sẵn có nào")}</div>;
      }
      return publicSkills.map((skill) => (
        <label
          key={skill.name}
          className="flex cursor-pointer items-start gap-2.5 rounded-md px-2 py-1.5 hover:bg-muted/50 transition-colors"
        >
          <Checkbox
            checked={selectedSkills.has(skill.name)}
            onCheckedChange={() => toggleSkill(skill.name)}
          />
          <div className="min-w-0 -mt-0.5">
            <div className="text-xs font-medium">{skill.name}</div>
            {skill.description && (
              <div className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5">
                {skill.description}
              </div>
            )}
          </div>
        </label>
      ));
    }
  };

  const handleSave = async () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast.error("Please enter a valid agent name");
      return;
    }
    if (nameError || isNameAvailable === false) {
      toast.error("Please resolve name validation errors before saving");
      return;
    }

    const toolGroupsList = Array.from(selectedToolGroups);

    const request = {
      name: trimmedName.toLowerCase(),
      description,
      model: selectedModel || null,
      system_prompt: systemPrompt,
      skills: Array.from(selectedSkills),
      tags,
      tool_groups: toolGroupsList.length > 0 ? toolGroupsList : null,
      knowledge_base_ids: Array.from(selectedKbIds),
      enabled,
      is_shared: isShared,
    };

    try {
      await createAgent.mutateAsync(request);
      toast.success(t.agents.agentCreated);
      onOpenChange(false);
      onSuccess?.();
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : tr(locale, "创建智能体失败", "Failed to create agent", "Tạo trợ lý thất bại")
      );
    }
  };

  const isSaveDisabled =
    !name.trim() ||
    isCheckingName ||
    !!nameError ||
    isNameAvailable === false ||
    createAgent.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[94vw] sm:max-w-[90vw] md:max-w-[85vw] lg:max-w-6xl xl:max-w-7xl h-[85vh] p-0 flex flex-col overflow-hidden gap-0 bg-card border border-border shadow-2xl rounded-xl">
        {/* Header */}
        <header className="flex items-center justify-between border-b px-6 py-4 shrink-0">
          <div className="flex items-center gap-2.5">
            <div className="bg-primary/10 text-primary flex h-8 w-8 shrink-0 items-center justify-center rounded-lg">
              <BotIcon className="h-5 w-5" />
            </div>
            <DialogTitle className="text-base font-semibold text-foreground">
              {t.agents.newAgent}
            </DialogTitle>
          </div>
        </header>

        {/* Body (Two Column Split Layout) */}
        <div className="flex flex-col md:flex-row divide-y md:divide-y-0 md:divide-x divide-border flex-1 overflow-hidden min-h-0">
          {/* Left Column (42% width) */}
          <div className="w-full md:w-[42%] p-6 flex flex-col gap-5 overflow-y-auto min-h-0 h-full">
            <div className="flex items-center justify-between pb-2 border-b shrink-0">
              <h2 className="text-sm font-semibold text-foreground">{t.admin.models.createDialog.basicInfo}</h2>
              <div className="flex items-center gap-4">
                {isTenantAdmin && (
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">{t.fileCenter.visibility.tenantShared}</span>
                    <Switch checked={isShared} onCheckedChange={setIsShared} />
                  </div>
                )}
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-semibold text-primary">{t.tenantAdmin.models.statusEnabled}</span>
                  <Switch checked={enabled} onCheckedChange={setEnabled} />
                </div>
              </div>
            </div>

            {/* Name */}
            <div className="space-y-2 shrink-0">
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-0.5">
                <span className="text-destructive font-bold">*</span> {t.tenantAdmin.agents.columns.name}
              </label>
              <div className="relative">
                <Input
                  autoFocus
                  placeholder={t.tenantAdmin.agents.namePlaceholder}
                  value={name}
                  onChange={(e) => {
                    setName(e.target.value);
                    setIsNameAvailable(null);
                    setNameError("");
                  }}
                  className={cn(
                    "pr-10 h-9",
                    nameError && "border-destructive focus-visible:ring-destructive",
                    isNameAvailable === true && "border-emerald-500 focus-visible:ring-emerald-500"
                  )}
                />
                <div className="absolute inset-y-0 right-3 flex items-center">
                  {isCheckingName && (
                    <span className="text-muted-foreground animate-pulse text-[11px]">{tr(locale, "检测中...", "Checking...", "Đang kiểm tra...")}</span>
                  )}
                  {!isCheckingName && isNameAvailable === true && (
                    <CheckCircle2Icon className="h-4 w-4 text-emerald-500" />
                  )}
                  {!isCheckingName && isNameAvailable === false && (
                    <AlertCircleIcon className="h-4 w-4 text-destructive" />
                  )}
                </div>
              </div>
              <p className="text-[10px] text-muted-foreground leading-normal">
                {t.agents.nameStepHint}
              </p>
              {nameError && (
                <p className="text-destructive text-xs mt-1 flex items-center gap-1 font-medium">
                  <AlertCircleIcon className="h-3.5 w-3.5 shrink-0" />
                  {nameError}
                </p>
              )}
              {!isCheckingName && isNameAvailable === true && (
                <p className="text-emerald-600 dark:text-emerald-400 text-xs mt-1 flex items-center gap-1 font-medium">
                  <CheckCircle2Icon className="h-3.5 w-3.5 shrink-0" />
                  {tr(locale, "该智能体名称可用", "Agent name is available", "Tên trợ lý hợp lệ và khả dụng")}
                </p>
              )}
            </div>

            {/* Model Selection */}
            <div className="space-y-2 shrink-0">
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-0.5">
                <SparklesIcon className="h-3.5 w-3.5 text-amber-500" /> {t.inputBox.selectModel}
              </label>
              <Select
                value={selectedModel}
                onValueChange={setSelectedModel}
              >
                <SelectTrigger className="w-full h-9">
                  <SelectValue placeholder={isLoadingModels ? t.common.loading : t.agents.edit.modelDefault} />
                </SelectTrigger>
                <SelectContent>
                  {isLoadingModels ? (
                    <div className="px-2 py-3 text-xs text-muted-foreground text-center">{t.common.loading}</div>
                  ) : availableModels.length === 0 ? (
                    <div className="px-2 py-3 text-xs text-muted-foreground text-center">{t.chatHeader.noModel}</div>
                  ) : (
                    availableModels.map((m) => (
                      <SelectItem key={m.name} value={m.name}>
                        <div className="flex items-center gap-2">
                          <span>{m.display_name || m.model}</span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted font-mono text-muted-foreground uppercase">
                            {m.scope}
                          </span>
                        </div>
                      </SelectItem>
                    ))
                  )}
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground leading-normal">
                {t.agents.edit.modelDefault}
              </p>
            </div>

            {/* System Prompt */}
            <div className="space-y-2 flex-1 flex flex-col min-h-[160px]">
              <label className="text-xs font-medium text-muted-foreground flex items-center gap-0.5">
                <span className="text-destructive font-bold">*</span> {t.agents.edit.systemPromptLabel}
              </label>
              <Textarea
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder={t.agents.edit.systemPromptPlaceholder}
                className="flex-1 font-mono text-sm leading-relaxed resize-none border border-input focus-visible:ring-1 focus-visible:ring-ring focus-visible:border-primary"
              />
            </div>

            {/* Tags */}
            <div className="space-y-2 shrink-0">
              <label className="text-xs font-medium text-muted-foreground">{t.agents.edit.tagsLabel}</label>
              <div className="relative flex flex-wrap gap-1.5 w-full rounded-md border border-input bg-background pl-2 pr-10 py-1.5 min-h-[36px] shadow-sm transition-colors focus-within:ring-1 focus-within:ring-ring focus-within:border-primary">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="bg-secondary text-secondary-foreground inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium animate-in fade-in zoom-in-95 duration-150 shrink-0"
                  >
                    {tag}
                    <button
                      type="button"
                      onClick={() => removeTag(tag)}
                      className="hover:text-destructive text-muted-foreground/80 transition-colors ml-0.5"
                    >
                      <XIcon className="h-3 w-3" />
                    </button>
                  </span>
                ))}
                <input
                  value={tagInput}
                  onChange={(e) => setTagInput(e.target.value)}
                  onKeyDown={handleTagKeyDown}
                  placeholder={tags.length === 0 ? t.agents.edit.tagsPlaceholder : ""}
                  className="flex-1 bg-transparent border-none outline-none p-0 text-sm focus:ring-0 placeholder:text-muted-foreground/60 min-w-[100px] h-6"
                />
                <div className="absolute inset-y-0 right-3 flex items-center pointer-events-none text-muted-foreground">
                  <ChevronDown className="h-4 w-4" />
                </div>
              </div>
            </div>

            {/* Description */}
            <div className="space-y-2 shrink-0">
              <label className="text-xs font-medium text-muted-foreground">{t.agents.edit.descriptionLabel}</label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t.agents.edit.descriptionPlaceholder}
                className="min-h-[72px] text-sm leading-relaxed resize-none"
              />
            </div>
          </div>

          {/* Right Column (58% width) */}
          <div className="w-full md:w-[58%] p-6 flex flex-col gap-6 overflow-hidden h-full">
            <div className="pb-2 border-b shrink-0">
              <h2 className="text-sm font-semibold text-foreground">{tr(locale, "能力配置", "Capabilities", "Cấu hình năng lực")}</h2>
            </div>

            {/* Toolsets */}
            <div className="space-y-3 flex-1 flex flex-col overflow-hidden min-h-0">
              <div className="flex flex-col gap-0.5 border-l-2 border-primary pl-2.5 shrink-0">
                <h3 className="text-sm font-semibold text-foreground">{t.tenantAdmin.agents.columns.tools}</h3>
                <p className="text-xs text-muted-foreground">{tr(locale, "配置智能体可调用的外部工具能力", "Configure external tools and skills for this agent", "Cấu hình công cụ và kỹ năng mà trợ lý có thể sử dụng")}</p>
              </div>

              {/* Tabs */}
              <div className="flex gap-2 shrink-0">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className={cn(
                    "px-4 py-1.5 h-8 text-xs font-medium transition-all rounded-md border",
                    activeTab === "mcp"
                      ? "border-primary text-primary bg-primary/5 hover:bg-primary/10"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                  onClick={() => setActiveTab("mcp")}
                >
                  {tr(locale, "MCP工具", "MCP Tools", "Công cụ MCP")}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className={cn(
                    "px-4 py-1.5 h-8 text-xs font-medium transition-all rounded-md border",
                    activeTab === "custom"
                      ? "border-primary text-primary bg-primary/5 hover:bg-primary/10"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                  onClick={() => setActiveTab("custom")}
                >
                  {t.tenantAdmin.skills.tabs.custom}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className={cn(
                    "px-4 py-1.5 h-8 text-xs font-medium transition-all rounded-md border",
                    activeTab === "public"
                      ? "border-primary text-primary bg-primary/5 hover:bg-primary/10"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                  onClick={() => setActiveTab("public")}
                >
                  {t.tenantAdmin.skills.tabs.builtin}
                </Button>
              </div>

              {/* Tool list panel */}
              <div className="border border-border rounded-lg bg-zinc-50/50 dark:bg-zinc-900/10 p-3 flex flex-col gap-2.5 flex-1 overflow-y-auto min-h-0">
                <label className="flex cursor-pointer items-center gap-2.5 px-1 py-1 rounded hover:bg-muted/50 border-b pb-2 border-border/50 text-xs font-medium shrink-0">
                  <Checkbox
                    checked={isAllSelected}
                    onCheckedChange={handleToggleSelectAll}
                  />
                  <span>{t.common.selectAll}</span>
                </label>

                <div className="space-y-1.5 overflow-y-auto pr-1 flex-1">
                  {renderToolList()}
                </div>
              </div>
            </div>

            {/* Knowledge Bases (RAG) */}
            <div className="space-y-2.5 shrink-0">
              <div className="flex flex-col gap-0.5 border-l-2 border-primary pl-2.5">
                <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
                  <BookOpenIcon className="h-3.5 w-3.5 text-primary" />
                  {tr(locale, "关联知识库 (RAG)", "Knowledge Bases (RAG)", "Kho tri thức (RAG)")}
                </h3>
                <p className="text-xs text-muted-foreground">
                  {tr(locale, "选择智能体可检索的知识库", "Select knowledge bases this agent can search", "Chọn kho tri thức mà trợ lý có thể tra cứu")}
                </p>
              </div>
              <div className="border border-border rounded-lg bg-zinc-50/50 dark:bg-zinc-900/10 p-2.5 max-h-[140px] overflow-y-auto space-y-1">
                {isLoadingKbs ? (
                  <div className="text-xs text-muted-foreground py-3 text-center">{t.common.loading}</div>
                ) : availableKnowledgeBases.length === 0 ? (
                  <div className="text-xs text-muted-foreground py-3 text-center">
                    {tr(locale, "暂无知识库", "No knowledge bases available", "Chưa có kho tri thức nào")}
                  </div>
                ) : (
                  availableKnowledgeBases.map((kb) => (
                    <label
                      key={kb.id}
                      className="flex cursor-pointer items-start gap-2.5 rounded-md px-2 py-1.5 hover:bg-muted/50 transition-colors"
                    >
                      <Checkbox
                        checked={selectedKbIds.has(kb.id)}
                        onCheckedChange={() => toggleKb(kb.id)}
                      />
                      <div className="min-w-0 -mt-0.5 flex-1">
                        <div className="text-xs font-medium flex items-center gap-1.5">
                          <span className="truncate">{kb.name}</span>
                          <span className="text-[10px] px-1 bg-muted rounded text-muted-foreground shrink-0">
                            {kb.doc_count} docs
                          </span>
                          {kb.is_shared && (
                            <span className="text-[9px] px-1 bg-primary/10 text-primary rounded font-medium shrink-0">
                              {tr(locale, "共享", "Shared", "Chia sẻ")}
                            </span>
                          )}
                        </div>
                        {kb.description && (
                          <div className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5">
                            {kb.description}
                          </div>
                        )}
                      </div>
                    </label>
                  ))
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <footer className="border-t bg-zinc-50/50 dark:bg-zinc-900/10 px-6 py-4 flex items-center justify-end gap-3 shrink-0">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
          >
            {t.common.cancel}
          </Button>
          <Button
            type="button"
            size="sm"
            className="bg-primary hover:bg-primary/95 text-primary-foreground font-medium px-5"
            onClick={handleSave}
            disabled={isSaveDisabled}
          >
            {createAgent.isPending ? t.agents.edit.saving : t.agents.edit.save}
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
