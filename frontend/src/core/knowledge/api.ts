import { fetchAuthApi } from "@/core/api/auth-client";

import type {
  CreateKnowledgeBaseRequest,
  KnowledgeBase,
  KnowledgeDocument,
  KnowledgeSearchRequest,
  KnowledgeSearchResult,
} from "./types";

async function extractError(res: Response, fallback: string): Promise<string> {
  const err = (await res.json().catch(() => ({}))) as { detail?: string };
  return err.detail ?? `${fallback}: ${res.statusText}`;
}

export async function listKnowledgeBases(): Promise<KnowledgeBase[]> {
  const res = await fetchAuthApi("/api/knowledge/bases");
  if (!res.ok) throw new Error(await extractError(res, "Failed to load knowledge bases"));
  const data = (await res.json()) as { bases: KnowledgeBase[] };
  return data.bases;
}

export async function createKnowledgeBase(
  request: CreateKnowledgeBaseRequest,
): Promise<KnowledgeBase> {
  const res = await fetchAuthApi("/api/knowledge/bases", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!res.ok) throw new Error(await extractError(res, "Failed to create knowledge base"));
  return res.json() as Promise<KnowledgeBase>;
}

export async function deleteKnowledgeBase(kbId: string): Promise<void> {
  const res = await fetchAuthApi(`/api/knowledge/bases/${encodeURIComponent(kbId)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error(await extractError(res, "Failed to delete knowledge base"));
}

export async function listKnowledgeDocuments(kbId: string): Promise<KnowledgeDocument[]> {
  const res = await fetchAuthApi(`/api/knowledge/bases/${encodeURIComponent(kbId)}/documents`);
  if (!res.ok) throw new Error(await extractError(res, "Failed to load documents"));
  const data = (await res.json()) as { documents: KnowledgeDocument[] };
  return data.documents;
}

export async function uploadKnowledgeFile(
  kbId: string,
  file: File,
): Promise<KnowledgeDocument> {
  const formData = new FormData();
  formData.append("file", file);
  const res = await fetchAuthApi(`/api/knowledge/bases/${encodeURIComponent(kbId)}/documents`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) throw new Error(await extractError(res, "Failed to upload document"));
  return res.json() as Promise<KnowledgeDocument>;
}

export async function uploadKnowledgeText(
  kbId: string,
  title: string,
  text: string,
): Promise<KnowledgeDocument> {
  const formData = new FormData();
  formData.append("title", title);
  formData.append("text", text);
  const res = await fetchAuthApi(`/api/knowledge/bases/${encodeURIComponent(kbId)}/documents`, {
    method: "POST",
    body: formData,
  });
  if (!res.ok) throw new Error(await extractError(res, "Failed to add text note"));
  return res.json() as Promise<KnowledgeDocument>;
}

export async function deleteKnowledgeDocument(
  kbId: string,
  docId: string,
): Promise<void> {
  const res = await fetchAuthApi(
    `/api/knowledge/bases/${encodeURIComponent(kbId)}/documents/${encodeURIComponent(docId)}`,
    { method: "DELETE" },
  );
  if (!res.ok) throw new Error(await extractError(res, "Failed to delete document"));
}

export async function searchKnowledge(
  request: KnowledgeSearchRequest,
): Promise<KnowledgeSearchResult[]> {
  const res = await fetchAuthApi("/api/knowledge/search", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!res.ok) throw new Error(await extractError(res, "Failed to search knowledge base"));
  const data = (await res.json()) as { results: KnowledgeSearchResult[] };
  return data.results;
}
