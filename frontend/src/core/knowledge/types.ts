export interface KnowledgeBase {
  id: string;
  name: string;
  description: string;
  is_shared: boolean;
  chunk_size: number;
  chunk_overlap: number;
  doc_count: number;
  chunk_count: number;
  created_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface CreateKnowledgeBaseRequest {
  name: string;
  description?: string;
  is_shared?: boolean;
  chunk_size?: number;
  chunk_overlap?: number;
}

export interface KnowledgeDocument {
  id: string;
  kb_id: string;
  filename: string;
  content_type: string;
  file_size: number;
  status: string;
  chunk_count: number;
  error_message?: string | null;
  created_at?: string | null;
}

export interface KnowledgeSearchRequest {
  query: string;
  kb_ids?: string[];
  top_k?: number;
}

export interface KnowledgeSearchResult {
  kb_id: string;
  kb_name: string;
  doc_id: string;
  filename: string;
  chunk_index: number;
  content: string;
  score: number;
}
