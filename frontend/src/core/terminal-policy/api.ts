import { fetchAuthApi } from "@/core/api/auth-client";
import { getActiveLocale, tr } from "@/core/i18n";

export type TerminalPolicyAction =
  | "readFiles"
  | "editFiles"
  | "executeSafeCommands"
  | "executeAllCommands"
  | "autoExecuteReadOnlyCommands";

/** Only the keys the tenant admin pins are present. */
export interface TerminalPolicySecurityConfig {
  enableCommandSecurity?: boolean;
  enableStrictMode?: boolean;
  maxCommandLength?: number;
  blacklistPatterns?: string[];
  whitelistPatterns?: string[];
}

export interface TerminalPolicyAutoApproval {
  enabled?: boolean;
  actions?: Partial<Record<TerminalPolicyAction, boolean>>;
}

export interface TerminalTenantPolicy {
  security_config: TerminalPolicySecurityConfig;
  auto_approval: TerminalPolicyAutoApproval;
  updated_by?: string | null;
  updated_at?: string | null;
}

export interface TerminalTenantPolicyUpdate {
  security_config: TerminalPolicySecurityConfig;
  auto_approval: TerminalPolicyAutoApproval;
}

const ENDPOINT = "/api/v1/terminal/tenant-policy";

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getErrorMessage(payload: unknown, zh: string, en: string, vi: string) {
  if (isObject(payload)) {
    const detail = payload.detail;
    if (typeof detail === "string" && detail.trim()) {
      return detail;
    }
    const message = payload.message;
    if (typeof message === "string" && message.trim()) {
      return message;
    }
  }
  return tr(getActiveLocale(), zh, en, vi);
}

export async function getTerminalTenantPolicy(): Promise<TerminalTenantPolicy> {
  const response = await fetchAuthApi(ENDPOINT);
  let json: unknown = null;
  try {
    json = await response.json();
  } catch {
    json = null;
  }
  if (!response.ok) {
    throw new Error(
      getErrorMessage(
        json,
        "加载终端策略失败",
        "Failed to load terminal policy",
        "Tải chính sách terminal thất bại",
      ),
    );
  }
  const data = (json ?? {}) as Partial<TerminalTenantPolicy>;
  return {
    security_config: data.security_config ?? {},
    auto_approval: data.auto_approval ?? {},
    updated_by: data.updated_by ?? null,
    updated_at: data.updated_at ?? null,
  };
}

export async function updateTerminalTenantPolicy(
  data: TerminalTenantPolicyUpdate,
): Promise<void> {
  const response = await fetchAuthApi(ENDPOINT, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    let json: unknown = null;
    try {
      json = await response.json();
    } catch {
      json = null;
    }
    throw new Error(
      getErrorMessage(
        json,
        "保存终端策略失败",
        "Failed to save terminal policy",
        "Lưu chính sách terminal thất bại",
      ),
    );
  }
}
