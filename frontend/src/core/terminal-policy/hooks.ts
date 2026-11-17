"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { getActiveLocale, tr } from "@/core/i18n";
import { useCurrentTenant } from "@/core/tenants/hooks";

import {
  getTerminalTenantPolicy,
  updateTerminalTenantPolicy,
  type TerminalTenantPolicy,
  type TerminalTenantPolicyUpdate,
} from "./api";

export function useTerminalTenantPolicy() {
  const { data: currentTenant } = useCurrentTenant();
  const tenantId = currentTenant?.tenant_id ?? null;

  return useQuery<TerminalTenantPolicy>({
    queryKey: ["terminalTenantPolicy", { tenantId }],
    queryFn: getTerminalTenantPolicy,
    enabled: !!tenantId,
    refetchOnWindowFocus: false,
  });
}

export function useUpdateTerminalTenantPolicy() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: TerminalTenantPolicyUpdate) => updateTerminalTenantPolicy(data),
    onSuccess: () => {
      toast.success(
        tr(
          getActiveLocale(),
          "终端策略已保存",
          "Terminal policy saved",
          "Đã lưu chính sách terminal",
        ),
      );
      void queryClient.invalidateQueries({ queryKey: ["terminalTenantPolicy"] });
    },
    onError: (error) => {
      toast.error(
        error instanceof Error
          ? error.message
          : tr(
              getActiveLocale(),
              "保存终端策略失败",
              "Failed to save terminal policy",
              "Lưu chính sách terminal thất bại",
            ),
      );
    },
  });
}
