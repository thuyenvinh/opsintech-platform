"use client";

import {
  BookOpenIcon,
  FileTextIcon,
  Loader2Icon,
  PlusIcon,
  SearchIcon,
  StickyNoteIcon,
  Trash2Icon,
  UploadIcon,
  UsersIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { tr } from "@/core/i18n";
import { useI18n } from "@/core/i18n/hooks";
import {
  useCreateKnowledgeBase,
  useDeleteKnowledgeBase,
  useDeleteKnowledgeDocument,
  useKnowledgeBases,
  useKnowledgeDocuments,
  useSearchKnowledge,
  useUploadKnowledgeFile,
  useUploadKnowledgeText,
  type KnowledgeSearchResult,
} from "@/core/knowledge";
import { isTenantAdminRole } from "@/core/permissions/scope";
import { useCurrentTenant } from "@/core/tenants/hooks";
import { cn } from "@/lib/utils";

function formatFileSize(bytes: number): string {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let idx = 0;
  let val = bytes;
  while (val >= 1024 && idx < units.length - 1) {
    val /= 1024;
    idx += 1;
  }
  return `${val.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
}

export default function KnowledgePage() {
  const { locale } = useI18n();
  const { data: currentTenant } = useCurrentTenant();
  const isTenantAdmin = isTenantAdminRole(currentTenant?.role);

  const { bases, isLoading: isLoadingBases } = useKnowledgeBases();
  const createKb = useCreateKnowledgeBase();
  const deleteKb = useDeleteKnowledgeBase();

  const [selectedKbId, setSelectedKbId] = useState<string | null>(null);

  // Auto-select first KB when list loads or selected KB is deleted
  useEffect(() => {
    if (bases.length === 0) {
      setSelectedKbId(null);
      return;
    }
    if (!selectedKbId || !bases.some((b) => b.id === selectedKbId)) {
      setSelectedKbId(bases[0]!.id);
    }
  }, [bases, selectedKbId]);

  const activeKb = bases.find((b) => b.id === selectedKbId) ?? null;

  const { documents, isLoading: isLoadingDocs } = useKnowledgeDocuments(selectedKbId);
  const uploadFile = useUploadKnowledgeFile();
  const uploadText = useUploadKnowledgeText();
  const deleteDoc = useDeleteKnowledgeDocument();
  const searchMutation = useSearchKnowledge();

  // Create KB Dialog state
  const [createOpen, setCreateOpen] = useState(false);
  const [kbName, setKbName] = useState("");
  const [kbDesc, setKbDesc] = useState("");
  const [kbShared, setKbShared] = useState(false);

  // Paste Text Dialog state
  const [pasteOpen, setPasteOpen] = useState(false);
  const [noteTitle, setNoteTitle] = useState("");
  const [noteText, setNoteText] = useState("");

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<KnowledgeSearchResult[] | null>(null);

  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Reset search results when switching KB
  useEffect(() => {
    setSearchResults(null);
    setSearchQuery("");
  }, [selectedKbId]);

  const handleCreateKb = async () => {
    const trimmed = kbName.trim();
    if (!trimmed) {
      toast.error(tr(locale, "请输入知识库名称", "Please enter a knowledge base name", "Vui lòng nhập tên kho tri thức"));
      return;
    }
    try {
      const created = await createKb.mutateAsync({
        name: trimmed,
        description: kbDesc.trim(),
        is_shared: isTenantAdmin ? kbShared : false,
      });
      toast.success(tr(locale, "知识库已创建", "Knowledge base created", "Đã tạo kho tri thức"));
      setCreateOpen(false);
      setKbName("");
      setKbDesc("");
      setKbShared(false);
      setSelectedKbId(created.id);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tr(locale, "创建失败", "Failed to create", "Tạo thất bại"));
    }
  };

  const handleDeleteKb = async (kbId: string, name: string) => {
    try {
      await deleteKb.mutateAsync(kbId);
      toast.success(
        tr(locale, `已删除知识库 ${name}`, `Deleted knowledge base ${name}`, `Đã xóa kho tri thức ${name}`),
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tr(locale, "删除失败", "Failed to delete", "Xóa thất bại"));
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0 || !selectedKbId) return;
    const file = files[0]!;
    e.target.value = "";
    try {
      await uploadFile.mutateAsync({ kbId: selectedKbId, file });
      toast.success(
        tr(locale, `已上传 ${file.name}`, `Uploaded ${file.name}`, `Đã tải lên ${file.name}`),
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tr(locale, "上传失败", "Upload failed", "Tải lên thất bại"));
    }
  };

  const handlePasteText = async () => {
    if (!selectedKbId) return;
    const title = noteTitle.trim();
    const text = noteText.trim();
    if (!title || !text) {
      toast.error(tr(locale, "请填写标题和内容", "Please enter both title and text", "Vui lòng nhập tiêu đề và nội dung"));
      return;
    }
    try {
      await uploadText.mutateAsync({ kbId: selectedKbId, title, text });
      toast.success(tr(locale, "已添加文本笔记", "Text note added", "Đã thêm ghi chú văn bản"));
      setPasteOpen(false);
      setNoteTitle("");
      setNoteText("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tr(locale, "添加失败", "Failed to add note", "Thêm thất bại"));
    }
  };

  const handleDeleteDoc = async (docId: string, filename: string) => {
    if (!selectedKbId) return;
    try {
      await deleteDoc.mutateAsync({ kbId: selectedKbId, docId });
      toast.success(tr(locale, `已删除 ${filename}`, `Deleted ${filename}`, `Đã xóa ${filename}`));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tr(locale, "删除失败", "Failed to delete", "Xóa thất bại"));
    }
  };

  const handleSearch = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!selectedKbId) return;
    const q = searchQuery.trim();
    if (!q) return;
    try {
      const results = await searchMutation.mutateAsync({
        query: q,
        kb_ids: [selectedKbId],
        top_k: 5,
      });
      setSearchResults(results);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : tr(locale, "检索失败", "Search failed", "Truy vấn thất bại"));
    }
  };

  const renderStatusBadge = (status: string) => {
    const normalized = status.toLowerCase();
    if (normalized === "ready" || normalized === "indexed" || normalized === "completed") {
      return (
        <Badge variant="secondary" className="bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">
          {tr(locale, "就绪", "Ready", "Sẵn sàng")}
        </Badge>
      );
    }
    if (normalized === "failed" || normalized === "error") {
      return (
        <Badge variant="destructive">
          {tr(locale, "失败", "Failed", "Lỗi")}
        </Badge>
      );
    }
    return (
      <Badge variant="secondary" className="bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20">
        {status}
      </Badge>
    );
  };

  return (
    <div className="flex size-full flex-col bg-zinc-50/50 dark:bg-zinc-950/20 overflow-hidden p-6 gap-4 animate-in fade-in duration-300">
      {/* Page Header */}
      <div className="flex shrink-0 items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2">
            <BookOpenIcon className="h-5 w-5 text-primary" />
            {tr(locale, "知识库 (RAG)", "Knowledge Base (RAG)", "Kho tri thức (RAG)")}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {tr(
              locale,
              "管理文档与文本知识库，供智能体进行语义检索增强生成",
              "Manage document and text knowledge bases for agent RAG retrieval",
              "Quản lý tài liệu và văn bản tri thức để các trợ lý AI tra cứu (RAG)",
            )}
          </p>
        </div>
        <Button size="sm" onClick={() => setCreateOpen(true)} className="gap-1.5 shrink-0">
          <PlusIcon className="h-4 w-4" />
          {tr(locale, "创建知识库", "New Knowledge Base", "Tạo kho tri thức")}
        </Button>
      </div>

      {/* Split 2-column layout */}
      <div className="flex flex-col md:flex-row gap-4 flex-1 min-h-0 overflow-hidden">
        {/* Left Panel: Knowledge Base List */}
        <div className="w-full md:w-80 shrink-0 flex flex-col rounded-xl border bg-card shadow-sm overflow-hidden">
          <div className="px-4 py-3 border-b flex items-center justify-between bg-muted/30">
            <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {tr(locale, "知识库列表", "Knowledge Bases", "Danh sách kho tri thức")}
            </span>
            <span className="text-xs text-muted-foreground">{bases.length}</span>
          </div>

          <div className="flex-1 overflow-y-auto p-2 space-y-1.5">
            {isLoadingBases ? (
              <div className="flex items-center justify-center py-12 text-xs text-muted-foreground gap-2">
                <Loader2Icon className="h-4 w-4 animate-spin" />
                {tr(locale, "加载中...", "Loading...", "Đang tải...")}
              </div>
            ) : bases.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 px-4 text-center gap-2">
                <BookOpenIcon className="h-8 w-8 text-muted-foreground/40" />
                <p className="text-xs text-muted-foreground">
                  {tr(locale, "暂无知识库，点击右上角创建", "No knowledge bases yet. Create one to get started.", "Chưa có kho tri thức nào. Hãy tạo mới để bắt đầu.")}
                </p>
              </div>
            ) : (
              bases.map((kb) => {
                const isSelected = kb.id === selectedKbId;
                return (
                  <div
                    key={kb.id}
                    onClick={() => setSelectedKbId(kb.id)}
                    className={cn(
                      "group relative flex flex-col gap-1 rounded-lg p-3 cursor-pointer transition-all border",
                      isSelected
                        ? "bg-primary/5 border-primary/40 shadow-xs"
                        : "bg-transparent border-transparent hover:bg-muted/50",
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <span className={cn("text-sm font-medium truncate", isSelected && "text-primary")}>
                          {kb.name}
                        </span>
                        {kb.is_shared && (
                          <span title={tr(locale, "租户共享", "Tenant Shared", "Chia sẻ toàn tenant")}>
                            <UsersIcon className="h-3.5 w-3.5 text-primary shrink-0" />
                          </span>
                        )}
                      </div>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          void handleDeleteKb(kb.id, kb.name);
                        }}
                        className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity p-0.5 rounded"
                        title={tr(locale, "删除知识库", "Delete Knowledge Base", "Xóa kho tri thức")}
                      >
                        <Trash2Icon className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    {kb.description && (
                      <p className="text-xs text-muted-foreground line-clamp-2">{kb.description}</p>
                    )}
                    <div className="flex items-center gap-3 mt-1 text-[11px] text-muted-foreground">
                      <span>{kb.doc_count} {tr(locale, "文档", "docs", "tài liệu")}</span>
                      <span>{kb.chunk_count} {tr(locale, "分块", "chunks", "đoạn")}</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Right Panel: Documents + Test Search */}
        <div className="flex-1 flex flex-col gap-4 min-w-0 min-h-0 overflow-hidden">
          {!activeKb ? (
            <div className="flex-1 rounded-xl border bg-card flex flex-col items-center justify-center p-8 text-center gap-3">
              <BookOpenIcon className="h-10 w-10 text-muted-foreground/30" />
              <div className="text-sm font-medium text-muted-foreground">
                {tr(locale, "请选择或创建一个知识库", "Select or create a knowledge base", "Chọn hoặc tạo một kho tri thức")}
              </div>
            </div>
          ) : (
            <>
              {/* Active KB Header & Upload Actions */}
              <div className="rounded-xl border bg-card p-4 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3 shrink-0">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <h2 className="text-base font-semibold truncate">{activeKb.name}</h2>
                    {activeKb.is_shared && (
                      <Badge variant="secondary" className="text-[10px]">
                        {tr(locale, "共享", "Shared", "Chia sẻ")}
                      </Badge>
                    )}
                  </div>
                  {activeKb.description && (
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">{activeKb.description}</p>
                  )}
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".txt,.md,.pdf,.docx,.csv,.json,.log"
                    className="hidden"
                    onChange={handleFileChange}
                  />
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={uploadFile.isPending}
                    className="gap-1.5"
                  >
                    {uploadFile.isPending ? (
                      <Loader2Icon className="h-4 w-4 animate-spin" />
                    ) : (
                      <UploadIcon className="h-4 w-4" />
                    )}
                    {tr(locale, "上传文件", "Upload File", "Tải tệp lên")}
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => setPasteOpen(true)}
                    className="gap-1.5"
                  >
                    <StickyNoteIcon className="h-4 w-4" />
                    {tr(locale, "粘贴文本", "Paste Text", "Dán văn bản")}
                  </Button>
                </div>
              </div>

              {/* Documents List + Test Search Split */}
              <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 gap-4 min-h-0 overflow-hidden">
                {/* Documents Table/List */}
                <div className="lg:col-span-7 rounded-xl border bg-card shadow-sm flex flex-col min-h-0 overflow-hidden">
                  <div className="px-4 py-3 border-b bg-muted/30 flex items-center justify-between shrink-0">
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      {tr(locale, "文档列表", "Documents", "Tài liệu")} ({documents.length})
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      .txt, .md, .pdf, .docx, .csv, .json, .log
                    </span>
                  </div>

                  <div className="flex-1 overflow-y-auto divide-y">
                    {isLoadingDocs ? (
                      <div className="flex items-center justify-center py-12 text-xs text-muted-foreground gap-2">
                        <Loader2Icon className="h-4 w-4 animate-spin" />
                        {tr(locale, "加载文档中...", "Loading documents...", "Đang tải tài liệu...")}
                      </div>
                    ) : documents.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-14 px-4 text-center gap-2">
                        <FileTextIcon className="h-8 w-8 text-muted-foreground/40" />
                        <p className="text-xs text-muted-foreground">
                          {tr(locale, "暂无文档，请上传文件或粘贴文本", "No documents yet. Upload a file or paste text.", "Chưa có tài liệu nào. Hãy tải tệp lên hoặc dán văn bản.")}
                        </p>
                      </div>
                    ) : (
                      documents.map((doc) => (
                        <div
                          key={doc.id}
                          className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted/30 transition-colors"
                        >
                          <div className="flex items-start gap-2.5 min-w-0">
                            <FileTextIcon className="h-4 w-4 text-primary shrink-0 mt-0.5" />
                            <div className="min-w-0">
                              <div className="text-sm font-medium truncate">{doc.filename}</div>
                              <div className="flex flex-wrap items-center gap-2 mt-0.5 text-[11px] text-muted-foreground">
                                <span>{formatFileSize(doc.file_size)}</span>
                                <span>•</span>
                                <span>{doc.chunk_count} {tr(locale, "分块", "chunks", "đoạn")}</span>
                                {doc.error_message && (
                                  <span className="text-destructive truncate max-w-[220px]" title={doc.error_message}>
                                    • {doc.error_message}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            {renderStatusBadge(doc.status)}
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 text-muted-foreground hover:text-destructive"
                              onClick={() => handleDeleteDoc(doc.id, doc.filename)}
                              disabled={deleteDoc.isPending}
                              title={tr(locale, "删除文档", "Delete document", "Xóa tài liệu")}
                            >
                              <Trash2Icon className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>

                {/* Test Search Panel */}
                <div className="lg:col-span-5 rounded-xl border bg-card shadow-sm flex flex-col min-h-0 overflow-hidden">
                  <div className="px-4 py-3 border-b bg-muted/30 shrink-0">
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                      <SearchIcon className="h-3.5 w-3.5 text-primary" />
                      {tr(locale, "RAG 检索测试", "Test Search", "Thử truy vấn RAG")}
                    </span>
                  </div>

                  <form onSubmit={handleSearch} className="p-3 border-b flex gap-2 shrink-0">
                    <Input
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder={tr(locale, "输入问题测试语义检索...", "Enter query to test retrieval...", "Nhập câu hỏi để thử truy vấn...")}
                      className="h-9 text-sm"
                    />
                    <Button
                      type="submit"
                      size="sm"
                      disabled={!searchQuery.trim() || searchMutation.isPending}
                      className="h-9 px-3 shrink-0"
                    >
                      {searchMutation.isPending ? (
                        <Loader2Icon className="h-4 w-4 animate-spin" />
                      ) : (
                        <SearchIcon className="h-4 w-4" />
                      )}
                    </Button>
                  </form>

                  <div className="flex-1 overflow-y-auto p-3 space-y-2.5">
                    {searchResults === null ? (
                      <div className="flex flex-col items-center justify-center py-12 text-center text-xs text-muted-foreground">
                        {tr(locale, "输入查询语句以预览最相关的文档分块", "Run a query to inspect matching chunks and similarity scores", "Nhập nội dung truy vấn để xem các đoạn khớp và điểm tương đồng")}
                      </div>
                    ) : searchResults.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-12 text-center text-xs text-muted-foreground">
                        {tr(locale, "未找到匹配的内容", "No matching chunks found", "Không tìm thấy kết quả phù hợp")}
                      </div>
                    ) : (
                      searchResults.map((res, idx) => (
                        <div
                          key={`${res.doc_id}-${res.chunk_index}-${idx}`}
                          className="rounded-lg border bg-muted/20 p-3 space-y-1.5"
                        >
                          <div className="flex items-center justify-between gap-2 text-xs">
                            <span className="font-medium truncate text-foreground">
                              {res.filename}{" "}
                              <span className="text-muted-foreground font-normal">
                                #{res.chunk_index}
                              </span>
                            </span>
                            <Badge variant="outline" className="text-[10px] font-mono shrink-0">
                              {(res.score * 100).toFixed(1)}%
                            </Badge>
                          </div>
                          <p className="text-xs text-muted-foreground whitespace-pre-wrap leading-relaxed line-clamp-5">
                            {res.content}
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Create Knowledge Base Dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {tr(locale, "创建知识库", "Create Knowledge Base", "Tạo kho tri thức")}
            </DialogTitle>
            <DialogDescription>
              {tr(
                locale,
                "创建一个新的 RAG 知识库用于存储和检索文档",
                "Create a new RAG knowledge base for storing and searching documents",
                "Tạo kho tri thức RAG mới để lưu trữ và truy vấn tài liệu",
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                * {tr(locale, "名称", "Name", "Tên kho tri thức")}
              </label>
              <Input
                autoFocus
                value={kbName}
                onChange={(e) => setKbName(e.target.value)}
                placeholder={tr(locale, "例如：运维手册", "e.g. Ops Runbooks", "VD: Tài liệu vận hành")}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                {tr(locale, "描述", "Description", "Mô tả")}
              </label>
              <Textarea
                value={kbDesc}
                onChange={(e) => setKbDesc(e.target.value)}
                placeholder={tr(locale, "可选描述...", "Optional description...", "Mô tả ngắn gọn (tùy chọn)...")}
                className="min-h-[80px] resize-none"
              />
            </div>

            {isTenantAdmin && (
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <div className="text-xs font-medium">
                    {tr(locale, "租户内共享", "Share with Tenant", "Chia sẻ trong Tenant")}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {tr(locale, "允许同租户成员和共享智能体访问", "Allow all members and shared agents in this tenant to access", "Cho phép thành viên và Agent dùng chung trong tenant truy cập")}
                  </div>
                </div>
                <Switch checked={kbShared} onCheckedChange={setKbShared} />
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setCreateOpen(false)}>
              {tr(locale, "取消", "Cancel", "Hủy")}
            </Button>
            <Button size="sm" onClick={handleCreateKb} disabled={createKb.isPending || !kbName.trim()}>
              {createKb.isPending ? (
                <Loader2Icon className="h-4 w-4 animate-spin mr-1.5" />
              ) : null}
              {tr(locale, "创建", "Create", "Tạo mới")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Paste Text Note Dialog */}
      <Dialog open={pasteOpen} onOpenChange={setPasteOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {tr(locale, "粘贴文本笔记", "Paste Text Note", "Dán văn bản")}
            </DialogTitle>
            <DialogDescription>
              {tr(
                locale,
                "直接粘贴文本内容并索引到当前知识库",
                "Paste plain text or markdown directly into this knowledge base",
                "Dán trực tiếp nội dung văn bản để lập chỉ mục vào kho tri thức",
              )}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                * {tr(locale, "标题", "Title", "Tiêu đề")}
              </label>
              <Input
                autoFocus
                value={noteTitle}
                onChange={(e) => setNoteTitle(e.target.value)}
                placeholder={tr(locale, "例如：故障排查 SOP", "e.g. Incident Triage SOP", "VD: Quy trình xử lý sự cố")}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                * {tr(locale, "正文内容", "Content", "Nội dung")}
              </label>
              <Textarea
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder={tr(locale, "在此粘贴文本...", "Paste text content here...", "Dán nội dung văn bản tại đây...")}
                className="min-h-[180px] font-mono text-xs leading-relaxed"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setPasteOpen(false)}>
              {tr(locale, "取消", "Cancel", "Hủy")}
            </Button>
            <Button
              size="sm"
              onClick={handlePasteText}
              disabled={uploadText.isPending || !noteTitle.trim() || !noteText.trim()}
            >
              {uploadText.isPending ? (
                <Loader2Icon className="h-4 w-4 animate-spin mr-1.5" />
              ) : null}
              {tr(locale, "保存并索引", "Save & Index", "Lưu & Lập chỉ mục")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
