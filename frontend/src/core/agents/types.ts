export interface Agent {
  id: string;
  name: string;
  description: string;
  model: string | null;
  tool_groups: string[] | null;
  system_prompt?: string | null;
  /** @deprecated Use system_prompt */
  soul?: string | null;
  skills: string[];
  enabled: boolean;
  tags: string[];
  created_by?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  is_shared?: boolean;
  knowledge_base_ids?: string[];
}

/**
 * Tool groups the platform itself defines, mirroring DEFAULT_TOOL_GROUPS in
 * backend/packages/harness/deerflow/config/tool_config.py. MCP server names are
 * tool groups too; those come from the tenant's MCP registry.
 */
export const PLATFORM_TOOL_GROUPS: { name: string; tools: string }[] = [
  { name: "web", tools: "web_search, web_fetch, image_search" },
  { name: "file:read", tools: "ls, read_file" },
  { name: "file:write", tools: "write_file, str_replace" },
  { name: "bash", tools: "bash" },
];

export interface Skill {
  name: string;
  description: string;
  category: string;
  enabled: boolean;
}

export interface CreateAgentRequest {
  name: string;
  description?: string;
  model?: string | null;
  tool_groups?: string[] | null;
  system_prompt?: string;
  /** @deprecated Use system_prompt */
  soul?: string;
  skills?: string[];
  tags?: string[];
  enabled?: boolean;
  is_shared?: boolean;
  knowledge_base_ids?: string[];
}

export interface UpdateAgentRequest {
  description?: string | null;
  model?: string | null;
  tool_groups?: string[] | null;
  system_prompt?: string | null;
  /** @deprecated Use system_prompt */
  soul?: string | null;
  skills?: string[] | null;
  enabled?: boolean | null;
  tags?: string[] | null;
  is_shared?: boolean | null;
  knowledge_base_ids?: string[] | null;
}
