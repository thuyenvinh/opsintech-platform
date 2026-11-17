import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSyncExternalStore } from "react";

import { getCurrentTenantId, subscribeTenantChange } from "@/core/tenants/store";

import {
  createKnowledgeBase,
  deleteKnowledgeBase,
  deleteKnowledgeDocument,
  listKnowledgeBases,
  listKnowledgeDocuments,
  searchKnowledge,
  uploadKnowledgeFile,
  uploadKnowledgeText,
} from "./api";
import type { CreateKnowledgeBaseRequest, KnowledgeSearchRequest } from "./types";

function useTenantKey() {
  return useSyncExternalStore(subscribeTenantChange, () => getCurrentTenantId() ?? "_");
}

export function useKnowledgeBases() {
  const tenantKey = useTenantKey();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["knowledge-bases", tenantKey],
    queryFn: () => listKnowledgeBases(),
  });
  return { bases: data ?? [], isLoading, error, refetch };
}

export function useCreateKnowledgeBase() {
  const queryClient = useQueryClient();
  const tenantKey = useTenantKey();
  return useMutation({
    mutationFn: (request: CreateKnowledgeBaseRequest) => createKnowledgeBase(request),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["knowledge-bases", tenantKey] });
    },
  });
}

export function useDeleteKnowledgeBase() {
  const queryClient = useQueryClient();
  const tenantKey = useTenantKey();
  return useMutation({
    mutationFn: (kbId: string) => deleteKnowledgeBase(kbId),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["knowledge-bases", tenantKey] });
    },
  });
}

export function useKnowledgeDocuments(kbId: string | null | undefined) {
  const tenantKey = useTenantKey();
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["knowledge-documents", tenantKey, kbId],
    queryFn: () => listKnowledgeDocuments(kbId!),
    enabled: !!kbId,
  });
  return { documents: data ?? [], isLoading, error, refetch };
}

export function useUploadKnowledgeFile() {
  const queryClient = useQueryClient();
  const tenantKey = useTenantKey();
  return useMutation({
    mutationFn: ({ kbId, file }: { kbId: string; file: File }) =>
      uploadKnowledgeFile(kbId, file),
    onSuccess: (_data, { kbId }) => {
      void queryClient.invalidateQueries({ queryKey: ["knowledge-documents", tenantKey, kbId] });
      void queryClient.invalidateQueries({ queryKey: ["knowledge-bases", tenantKey] });
    },
  });
}

export function useUploadKnowledgeText() {
  const queryClient = useQueryClient();
  const tenantKey = useTenantKey();
  return useMutation({
    mutationFn: ({ kbId, title, text }: { kbId: string; title: string; text: string }) =>
      uploadKnowledgeText(kbId, title, text),
    onSuccess: (_data, { kbId }) => {
      void queryClient.invalidateQueries({ queryKey: ["knowledge-documents", tenantKey, kbId] });
      void queryClient.invalidateQueries({ queryKey: ["knowledge-bases", tenantKey] });
    },
  });
}

export function useDeleteKnowledgeDocument() {
  const queryClient = useQueryClient();
  const tenantKey = useTenantKey();
  return useMutation({
    mutationFn: ({ kbId, docId }: { kbId: string; docId: string }) =>
      deleteKnowledgeDocument(kbId, docId),
    onSuccess: (_data, { kbId }) => {
      void queryClient.invalidateQueries({ queryKey: ["knowledge-documents", tenantKey, kbId] });
      void queryClient.invalidateQueries({ queryKey: ["knowledge-bases", tenantKey] });
    },
  });
}

export function useSearchKnowledge() {
  return useMutation({
    mutationFn: (request: KnowledgeSearchRequest) => searchKnowledge(request),
  });
}
