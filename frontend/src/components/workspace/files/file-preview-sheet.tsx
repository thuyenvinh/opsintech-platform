"use client";

import {
  Download,
  ExternalLink,
  FileIcon,
  Loader2,
  X,
  Search,
} from "lucide-react";
import { useEffect, useState, useMemo } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { CodeEditor } from "@/components/workspace/code-editor";
import { getAuthHeaders } from "@/core/api/auth-client";
import {
  getPreviewUrl,
  getDownloadUrl,
  getSpreadsheetPreview,
  type SpreadsheetPreviewResponse,
} from "@/core/files/api";
import {
  formatFileSize,
  getFileTypeIcon,
  getSourceTypeColor,
  getSourceTypeLabel,
} from "@/core/files/types";
import type { FileObject } from "@/core/files/types";
import { checkCodeFile, getFileExtensionDisplayName } from "@/core/utils/files";
import { MarkdownContent } from "@/components/workspace/messages/markdown-content";
import { useI18n } from "@/core/i18n/hooks";
import { cn } from "@/lib/utils";

interface FilePreviewSheetProps {
  file: FileObject | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Convert 0-based column index to Excel column letter (0->A, 25->Z, 26->AA) */
function getColumnLetter(colIndex: number): string {
  let letter = "";
  let idx = colIndex;
  while (idx >= 0) {
    letter = String.fromCharCode((idx % 26) + 65) + letter;
    idx = Math.floor(idx / 26) - 1;
  }
  return letter;
}

function SpreadsheetViewer({ data }: { data: SpreadsheetPreviewResponse }) {
  const [activeSheetIdx, setActiveSheetIdx] = useState(0);
  const [search, setSearch] = useState("");

  const currentSheet = data.sheets[activeSheetIdx] || data.sheets[0];

  const filteredRows = useMemo(() => {
    if (!currentSheet || !currentSheet.rows) return [];
    if (!search.trim()) return currentSheet.rows;
    const q = search.toLowerCase();
    return currentSheet.rows.filter((row, idx) => {
      if (idx === 0) return true; // keep header
      return row.some((cell) => cell !== null && String(cell).toLowerCase().includes(q));
    });
  }, [currentSheet, search]);

  if (!currentSheet) {
    return (
      <div className="flex items-center justify-center h-64 text-sm text-muted-foreground">
        Không có dữ liệu bảng tính
      </div>
    );
  }

  const colCount = currentSheet.total_cols || (currentSheet.rows[0]?.length ?? 0);

  return (
    <div className="flex flex-col h-full bg-white dark:bg-zinc-950 select-text">
      {/* Spreadsheet Toolbar */}
      <div className="flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 px-4 py-2 bg-zinc-50/80 dark:bg-zinc-900/40 shrink-0 gap-3">
        {/* Sheet Tabs */}
        <div className="flex items-center gap-1.5 overflow-x-auto max-w-[65%] py-0.5 scrollbar-thin">
          {data.sheets.map((sheet, idx) => (
            <button
              key={sheet.name || idx}
              onClick={() => {
                setActiveSheetIdx(idx);
                setSearch("");
              }}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs whitespace-nowrap transition-all border shrink-0 flex items-center gap-1.5 cursor-pointer",
                activeSheetIdx === idx
                  ? "bg-white dark:bg-zinc-800 text-indigo-600 dark:text-indigo-400 border-zinc-200 dark:border-zinc-700 shadow-xs font-semibold"
                  : "bg-transparent text-muted-foreground hover:text-foreground border-transparent hover:bg-zinc-200/50 dark:hover:bg-zinc-800/50 font-medium"
              )}
            >
              <span>{sheet.name}</span>
              <span className="text-[10px] px-1.5 py-0.2 rounded bg-zinc-100 dark:bg-zinc-800/80 text-zinc-500 font-mono">
                {sheet.total_rows} dòng
              </span>
            </button>
          ))}
        </div>

        {/* Search & Info */}
        <div className="flex items-center gap-3 shrink-0">
          <div className="relative">
            <Search className="size-3.5 absolute left-2.5 top-2 text-zinc-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Tìm kiếm trong bảng..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="h-7.5 w-48 sm:w-56 pl-8 pr-6 text-xs rounded-md border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 focus:outline-none focus:ring-1 focus:ring-indigo-500 text-foreground"
            />
            {search && (
              <button
                onClick={() => setSearch("")}
                className="absolute right-2 top-2 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 cursor-pointer"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>
          <span className="text-[11px] text-zinc-500 whitespace-nowrap font-mono hidden sm:inline-block">
            {filteredRows.length} dòng × {colCount} cột
          </span>
        </div>
      </div>

      {/* Grid Container */}
      <div className="flex-1 overflow-auto scrollbar-thin">
        <table className="w-full border-collapse text-xs">
          <thead className="sticky top-0 z-10 bg-zinc-100/95 dark:bg-zinc-900/95 backdrop-blur-sm border-b border-zinc-200 dark:border-zinc-800">
            <tr>
              <th className="w-12 min-w-12 p-2 border-r border-zinc-200 dark:border-zinc-800 font-mono text-[11px] font-semibold text-zinc-400 text-center select-none bg-zinc-100 dark:bg-zinc-900">
                #
              </th>
              {Array.from({ length: colCount }).map((_, cIdx) => (
                <th
                  key={cIdx}
                  className="px-3 py-2 border-r border-zinc-200/80 dark:border-zinc-800/80 font-mono text-[11px] font-semibold text-zinc-600 dark:text-zinc-400 text-left select-none min-w-28 whitespace-nowrap"
                >
                  {getColumnLetter(cIdx)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((row, rIdx) => {
              const isFirstRow = rIdx === 0 && !search;
              return (
                <tr
                  key={rIdx}
                  className={cn(
                    "border-b border-zinc-200/60 dark:border-zinc-800/50 hover:bg-indigo-50/40 dark:hover:bg-indigo-950/20 transition-colors",
                    isFirstRow
                      ? "bg-zinc-50/90 dark:bg-zinc-900/60 font-semibold text-zinc-900 dark:text-zinc-100"
                      : rIdx % 2 === 1
                        ? "bg-white dark:bg-zinc-950"
                        : "bg-zinc-50/30 dark:bg-zinc-900/20"
                  )}
                >
                  <td className="w-12 min-w-12 p-2 border-r border-zinc-200 dark:border-zinc-800 font-mono text-[10px] text-zinc-400 text-center select-none bg-zinc-50/50 dark:bg-zinc-900/50">
                    {rIdx + 1}
                  </td>
                  {Array.from({ length: colCount }).map((_, cIdx) => {
                    const val = row[cIdx];
                    const displayVal = val === null || val === undefined ? "" : String(val);
                    return (
                      <td
                        key={cIdx}
                        className={cn(
                          "px-3 py-1.5 border-r border-zinc-200/50 dark:border-zinc-800/50 truncate max-w-xs",
                          !displayVal && "text-zinc-300 dark:text-zinc-700"
                        )}
                        title={displayVal}
                      >
                        {displayVal || <span className="select-none opacity-20">—</span>}
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
        {filteredRows.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <p className="text-sm">Không tìm thấy dòng nào phù hợp với từ khóa</p>
          </div>
        )}
      </div>
    </div>
  );
}

export function FilePreviewSheet({
  file,
  open,
  onOpenChange,
}: FilePreviewSheetProps) {
  const { t } = useI18n();
  const [content, setContent] = useState<string | null>(null);
  const [binaryUrl, setBinaryUrl] = useState<string | null>(null);
  const [spreadsheetData, setSpreadsheetData] = useState<SpreadsheetPreviewResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState<"preview" | "code">("preview");

  const fileType = useMemo(() => {
    if (!file) {
      return {
        isCode: false,
        isMarkdown: false,
        isHtml: false,
        isBinary: false,
        isSpreadsheet: false,
        isExcel: false,
        isCsv: false,
        extension: "",
      };
    }
    const name = file.display_name.toLowerCase();
    const ext = name.split(".").pop() || "";

    const { isCodeFile } = checkCodeFile(file.display_name);
    const isMarkdown = ext === "md" || ext === "markdown";
    const isHtml = ext === "html" || ext === "htm";
    const isImage = file.mime_type.startsWith("image/");
    const isPdf = file.mime_type === "application/pdf" || ext === "pdf";
    const isExcel = ext === "xlsx" || ext === "xls" || ext === "xlsm" || file.mime_type.includes("sheet") || file.mime_type.includes("excel");
    const isCsv = ext === "csv" || ext === "tsv" || file.mime_type.includes("csv");
    const isSpreadsheet = isExcel || isCsv;

    return {
      isCode: isCodeFile && !isMarkdown && !isHtml && !isSpreadsheet,
      isMarkdown,
      isHtml,
      isImage,
      isPdf,
      isExcel,
      isCsv,
      isSpreadsheet,
      isBinary: isImage || isPdf,
      extension: ext,
    };
  }, [file]);

  const isSupportRawToggle = useMemo(() => {
    if (!file) return false;
    const ext = file.display_name.toLowerCase().split(".").pop() || "";
    return ext === "md" || ext === "markdown" || ext === "html" || ext === "htm" || ext === "csv" || ext === "tsv";
  }, [file]);

  useEffect(() => {
    setViewMode("preview");
  }, [file?.id]);

  useEffect(() => {
    if (!file || !open) {
      setContent(null);
      setSpreadsheetData(null);
      if (binaryUrl) {
        URL.revokeObjectURL(binaryUrl);
        setBinaryUrl(null);
      }
      return;
    }

    let active = true;
    const loadContent = async () => {
      setLoading(true);
      try {
        if (fileType.isSpreadsheet) {
          const sheetData = await getSpreadsheetPreview(file.id);
          if (active) {
            setSpreadsheetData(sheetData);
          }
          if (fileType.isCsv) {
            const previewUrl = getPreviewUrl(file.id);
            const response = await fetch(previewUrl, { headers: await getAuthHeaders() });
            if (response.ok) {
              const text = await response.text();
              if (active) setContent(text);
            }
          }
        } else if (fileType.isBinary) {
          const previewUrl = getPreviewUrl(file.id);
          const response = await fetch(previewUrl, { headers: await getAuthHeaders() });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const blob = await response.blob();
          if (active) {
            const objectUrl = URL.createObjectURL(blob);
            setBinaryUrl(objectUrl);
          }
        } else {
          const previewUrl = getPreviewUrl(file.id);
          const response = await fetch(previewUrl, { headers: await getAuthHeaders() });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const text = await response.text();
          if (active) {
            setContent(text);
          }
        }
      } catch (err) {
        console.error("Failed to load file preview:", err);
        toast.error("Không thể tải bản xem trước tệp");
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    };

    void loadContent();

    return () => {
      active = false;
    };
  }, [file, open, fileType.isBinary, fileType.isSpreadsheet, fileType.isCsv]);

  // Clean up Object URL on unmount
  useEffect(() => {
    return () => {
      if (binaryUrl) {
        URL.revokeObjectURL(binaryUrl);
      }
    };
  }, [binaryUrl]);

  if (!file) return null;

  const downloadUrl = getDownloadUrl(file.id);

  const handleDownload = () => {
    const a = document.createElement("a");
    a.href = downloadUrl;
    a.download = file.original_filename || file.display_name;
    a.click();
  };

  const handleOpenNewTab = () => {
    if (binaryUrl) {
      window.open(binaryUrl, "_blank");
    } else {
      window.open(getPreviewUrl(file.id), "_blank");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="w-[94vw] max-w-5xl sm:max-w-[94vw] md:max-w-4xl lg:max-w-5xl xl:max-w-6xl h-[88vh] flex flex-col p-0 overflow-hidden bg-background border border-zinc-200/80 dark:border-zinc-800/80 rounded-2xl shadow-2xl animate-in fade-in zoom-in-95 duration-200 outline-none"
      >
        {/* Header */}
        <header className="flex items-center justify-between border-b border-zinc-200/60 dark:border-zinc-800/60 px-6 py-4 shrink-0 bg-white/85 dark:bg-zinc-950/85 backdrop-blur-xl z-10 shadow-sm">
          <div className="flex items-center gap-4 flex-1 min-w-0 mr-4">
            <div className="flex items-center justify-center size-12 shrink-0 rounded-xl bg-gradient-to-br from-zinc-50 to-zinc-100/80 dark:from-zinc-800/80 dark:to-zinc-900 border border-zinc-200/60 dark:border-zinc-700/50 shadow-sm text-2xl">
              {getFileTypeIcon(file.mime_type)}
            </div>
            <div className="flex-1 min-w-0">
              <DialogTitle className="text-[17px] font-semibold tracking-tight truncate leading-snug text-zinc-900 dark:text-zinc-100">
                {file.display_name}
              </DialogTitle>
              <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground whitespace-nowrap overflow-hidden">
                <span className="font-medium text-zinc-700 dark:text-zinc-300 shrink-0">
                  {getFileExtensionDisplayName(file.display_name)}
                </span>
                <span className="opacity-30 shrink-0">•</span>
                <span className="shrink-0">{formatFileSize(file.size_bytes)}</span>
                <span className="opacity-30 shrink-0">•</span>
                <span className="shrink-0">{new Date(file.created_at).toLocaleString()}</span>

                {/* Source & Visibility Badges */}
                <span className="opacity-30 shrink-0">•</span>
                <Badge
                  variant="outline"
                  className={cn(
                    "px-1.5 py-0 text-[10px] font-medium border-zinc-200 dark:border-zinc-800 shrink-0 shadow-xs",
                    getSourceTypeColor(file.source_type)
                  )}
                >
                  {file.source_type === "upload"
                    ? t.fileCenter.sourceTypes.upload
                    : file.source_type === "ai_generated"
                      ? t.fileCenter.sourceTypes.aiGenerated
                      : file.source_type === "business_attachment"
                        ? t.fileCenter.sourceTypes.business
                        : getSourceTypeLabel(file.source_type)}
                </Badge>
                <Badge
                  variant="outline"
                  className={cn(
                    "px-1.5 py-0 text-[10px] font-medium border-zinc-200 dark:border-zinc-800 shrink-0 shadow-xs",
                    file.visibility === "private"
                      ? "bg-zinc-50 text-zinc-600 dark:bg-zinc-900 dark:text-zinc-400"
                      : "bg-indigo-50/50 text-indigo-600 dark:bg-indigo-950/30 dark:text-indigo-400 border-indigo-100 dark:border-indigo-900/50"
                  )}
                >
                  {file.visibility === "private"
                    ? t.fileCenter.visibility.private
                    : t.fileCenter.visibility.tenantShared}
                </Badge>
              </div>
            </div>
          </div>

          {/* Actions Bar */}
          <div className="flex items-center gap-2 shrink-0">
            {isSupportRawToggle && (
              <div className="flex items-center rounded-lg border bg-zinc-100/80 dark:bg-zinc-800/40 p-0.5 mr-1 border-zinc-200/60 dark:border-zinc-800/60">
                <button
                  onClick={() => setViewMode("preview")}
                  className={cn(
                    "px-3 py-1 rounded-md text-xs font-semibold transition-all duration-200 cursor-pointer",
                    viewMode === "preview"
                      ? "bg-white dark:bg-zinc-800 text-foreground shadow-xs border border-zinc-200/30 dark:border-zinc-700/30"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {t.fileCenter.viewModes.preview}
                </button>
                <button
                  onClick={() => setViewMode("code")}
                  className={cn(
                    "px-3 py-1 rounded-md text-xs font-semibold transition-all duration-200 cursor-pointer",
                    viewMode === "code"
                      ? "bg-white dark:bg-zinc-800 text-foreground shadow-xs border border-zinc-200/30 dark:border-zinc-700/30"
                      : "text-muted-foreground hover:text-foreground"
                  )}
                >
                  {t.fileCenter.viewModes.source}
                </button>
              </div>
            )}
            <Button
              variant="outline"
              size="sm"
              onClick={handleOpenNewTab}
              className="gap-1.5 h-8.5 px-3.5 text-xs rounded-lg transition-colors border-zinc-200/80 hover:bg-zinc-50 dark:border-zinc-800/80 dark:hover:bg-zinc-800/50"
            >
              <ExternalLink className="size-3.5" />
              <span>{t.fileCenter.actions.openInNewTab}</span>
            </Button>
            <Button
              size="sm"
              onClick={handleDownload}
              className="gap-1.5 h-8.5 px-3.5 text-xs rounded-lg transition-colors shadow-xs"
            >
              <Download className="size-3.5" />
              <span>{t.fileCenter.actions.download}</span>
            </Button>

            <div className="w-px h-5 bg-zinc-200/60 dark:bg-zinc-800/60 mx-1 shrink-0" />
            <button
              onClick={() => onOpenChange(false)}
              className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-200 hover:bg-zinc-100 dark:hover:bg-zinc-800/60 transition-colors cursor-pointer"
              title={t.common.close}
            >
              <X className="size-4.5" />
            </button>
          </div>
        </header>

        {/* Content Preview Container */}
        <div className="flex-1 overflow-y-auto min-h-0 bg-zinc-50/30 dark:bg-zinc-950/20">
          {loading ? (
            <div className="flex size-full items-center justify-center py-20">
              <Loader2 className="size-7 animate-spin text-indigo-500" />
            </div>
          ) : fileType.isSpreadsheet && spreadsheetData && viewMode === "preview" ? (
            <SpreadsheetViewer data={spreadsheetData} />
          ) : fileType.isImage && binaryUrl ? (
            <div className="flex size-full items-center justify-center p-8 bg-zinc-100/30 dark:bg-zinc-900/10">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={binaryUrl}
                alt={file.display_name}
                className="max-w-full max-h-[62vh] object-contain rounded-2xl shadow-lg border border-zinc-200/50 dark:border-zinc-800/50 bg-white dark:bg-zinc-950 p-2 animate-in zoom-in-95 duration-300"
              />
            </div>
          ) : fileType.isPdf && binaryUrl ? (
            <iframe
              src={binaryUrl}
              className="size-full border-0 bg-white dark:bg-zinc-950"
              title={file.display_name}
            />
          ) : fileType.isHtml && content !== null ? (
            viewMode === "preview" ? (
              <div className="size-full bg-white dark:bg-zinc-950">
                <iframe
                  srcDoc={content}
                  sandbox="allow-scripts"
                  className="size-full border-0"
                  title={file.display_name}
                />
              </div>
            ) : (
              <div className="size-full bg-zinc-950/95 font-mono overflow-auto flex flex-col animate-in fade-in duration-200">
                <CodeEditor
                  value={content}
                  readonly
                  className="flex-1 min-h-full p-2"
                  settings={{ lineNumbers: true, foldGutter: true }}
                />
              </div>
            )
          ) : fileType.isMarkdown && content !== null ? (
            viewMode === "preview" ? (
              <div className="px-6 py-8 md:px-12 max-w-4xl mx-auto">
                <div className="p-8 md:p-12 bg-white dark:bg-zinc-950 rounded-2xl border border-zinc-200/50 dark:border-zinc-800/50 shadow-md min-h-full">
                  <MarkdownContent
                    content={content}
                    isLoading={false}
                    rehypePlugins={[]}
                  />
                </div>
              </div>
            ) : (
              <div className="size-full bg-zinc-950/95 font-mono overflow-auto flex flex-col animate-in fade-in duration-200">
                <CodeEditor
                  value={content}
                  readonly
                  className="flex-1 min-h-full p-2"
                  settings={{ lineNumbers: true, foldGutter: true }}
                />
              </div>
            )
          ) : fileType.isCode && content !== null ? (
            <div className="size-full bg-zinc-950/95 font-mono overflow-auto flex flex-col">
              <CodeEditor
                value={content}
                readonly
                className="flex-1 min-h-full p-2"
                settings={{ lineNumbers: true, foldGutter: true }}
              />
            </div>
          ) : content !== null ? (
            <div className="size-full bg-zinc-950/95 font-mono overflow-auto flex flex-col">
              <CodeEditor
                value={content}
                readonly
                className="flex-1 min-h-full p-2"
                settings={{ lineNumbers: true, foldGutter: true }}
              />
            </div>
          ) : (
            <div className="flex h-64 flex-col items-center justify-center gap-4 text-muted-foreground">
              <div className="rounded-2xl bg-zinc-100 dark:bg-zinc-800 p-6">
                <FileIcon className="size-10 opacity-30" />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium">{t.common.unsupportedPreview}</p>
                <p className="text-xs mt-1">{t.common.downloadHint}</p>
              </div>
              <Button size="sm" onClick={handleDownload} className="gap-1.5 mt-2 rounded-lg">
                <Download className="size-4" />
                {t.common.downloadFile}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
