import { screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { zhCN } from "@/core/i18n";
import { renderWithProviders } from "@/test/render";

import { ModelLifecycleSettingsPage } from "./model-lifecycle-settings-page";
import { SkillSettingsPage } from "./skill-settings-page";
import { ToolSettingsPage } from "./tool-settings-page";

const mocks = vi.hoisted(() => ({
  useCurrentTenant: vi.fn(),
  useAvailableModels: vi.fn(),
  useRegisterModel: vi.fn(),
  useUpdateModel: vi.fn(),
  useDeleteModel: vi.fn(),
  useDeleteTenantModel: vi.fn(),
  useUpdateTenantModel: vi.fn(),
  useTestModelConnection: vi.fn(),
  getDisabledModelsStore: vi.fn(),
  setDisabledModelsStore: vi.fn(),
  useAvailableMcpConfig: vi.fn(),
  useEnableMCPServer: vi.fn(),
  useCreateMCPServer: vi.fn(),
  useUpdateSingleMCPServer: vi.fn(),
  useDeleteMCPServer: vi.fn(),
  usePingMCPServer: vi.fn(),
  useUpdateSingleTenantMCPServer: vi.fn(),
  useDeleteTenantMCPServer: vi.fn(),
  useEnableTenantMCPServer: vi.fn(),
  useAvailableSkills: vi.fn(),
  useUpdateTenantSkill: vi.fn(),
}));

vi.mock("@/core/tenants/hooks", () => ({
  useCurrentTenant: mocks.useCurrentTenant,
}));

vi.mock("@/core/models/hooks", () => ({
  useAvailableModels: mocks.useAvailableModels,
  useRegisterModel: mocks.useRegisterModel,
  useUpdateModel: mocks.useUpdateModel,
  useDeleteModel: mocks.useDeleteModel,
  useDeleteTenantModel: mocks.useDeleteTenantModel,
  useUpdateTenantModel: mocks.useUpdateTenantModel,
  useTestModelConnection: mocks.useTestModelConnection,
  getDisabledModelsStore: mocks.getDisabledModelsStore,
  setDisabledModelsStore: mocks.setDisabledModelsStore,
}));

vi.mock("@/core/mcp/hooks", () => ({
  useAvailableMcpConfig: mocks.useAvailableMcpConfig,
  useEnableMCPServer: mocks.useEnableMCPServer,
  useCreateMCPServer: mocks.useCreateMCPServer,
  useUpdateSingleMCPServer: mocks.useUpdateSingleMCPServer,
  useDeleteMCPServer: mocks.useDeleteMCPServer,
  usePingMCPServer: mocks.usePingMCPServer,
  useUpdateSingleTenantMCPServer: mocks.useUpdateSingleTenantMCPServer,
  useDeleteTenantMCPServer: mocks.useDeleteTenantMCPServer,
  useEnableTenantMCPServer: mocks.useEnableTenantMCPServer,
}));

vi.mock("@/core/skills/hooks", () => ({
  useAvailableSkills: mocks.useAvailableSkills,
  useUpdateTenantSkill: mocks.useUpdateTenantSkill,
}));

vi.mock("@/env", () => ({
  env: { NEXT_PUBLIC_STATIC_WEBSITE_ONLY: "false" },
}));

describe("Resource settings permission UI", () => {
  it("hides model/tool/skill creation entry for tenant members", () => {
    mocks.useCurrentTenant.mockReturnValue({ data: { tenant_id: "tenant-a", role: "tenant_member" } });

    mocks.useAvailableModels.mockReturnValue({ models: [], isLoading: false, error: null });
    mocks.useRegisterModel.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
    mocks.useUpdateModel.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
    mocks.useDeleteModel.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
    mocks.useDeleteTenantModel.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
    mocks.useUpdateTenantModel.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
    mocks.useTestModelConnection.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
    mocks.getDisabledModelsStore.mockReturnValue([]);
    mocks.setDisabledModelsStore.mockReturnValue(undefined);

    mocks.useAvailableMcpConfig.mockReturnValue({
      config: { mcp_servers: {} },
      rawArray: [],
      isLoading: false,
      error: null,
    });
    mocks.useEnableMCPServer.mockReturnValue({ mutate: vi.fn() });
    mocks.useCreateMCPServer.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
    mocks.useUpdateSingleMCPServer.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
    mocks.useDeleteMCPServer.mockReturnValue({ mutate: vi.fn() });
    mocks.usePingMCPServer.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
    mocks.useUpdateSingleTenantMCPServer.mockReturnValue({ mutateAsync: vi.fn(), isPending: false });
    mocks.useDeleteTenantMCPServer.mockReturnValue({ mutate: vi.fn() });
    mocks.useEnableTenantMCPServer.mockReturnValue({ mutate: vi.fn() });

    mocks.useAvailableSkills.mockReturnValue({ skills: [], isLoading: false, error: null });
    mocks.useUpdateTenantSkill.mockReturnValue({ mutate: vi.fn() });

    // Locale pinned to match the `zhCN` bundle the assertions read from, so
    // the expected button labels stay the labels the UI actually renders.
    const { rerender } = renderWithProviders(<ModelLifecycleSettingsPage />, {
      locale: "zh-CN",
    });
    expect(
      screen.queryByRole("button", { name: zhCN.settings.modelLifecycle.register.open }),
    ).not.toBeInTheDocument();

    rerender(<ToolSettingsPage />);
    expect(
      screen.queryByRole("button", { name: zhCN.settings.tools.registerTool }),
    ).not.toBeInTheDocument();

    rerender(<SkillSettingsPage />);
    expect(
      screen.queryByRole("button", { name: zhCN.settings.skills.createSkill }),
    ).not.toBeInTheDocument();
  });
});
