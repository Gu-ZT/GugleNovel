import {computed, ref} from "vue";
import {
  DEFAULT_CONNECTION_ID,
  DEFAULT_ENDPOINT,
  SETTINGS_KEY,
  createConnectionId,
  defaultProviderModels,
  modelDisplayName,
  modelSelectionKey,
  normalizeCapabilities,
  normalizeConnectionProfiles,
  resolveModelSelection as resolveSelection,
  type ConnectionProfile,
  type ModelCapability,
  type ProviderModel,
  type ResolvedModel,
} from "../../../domain/models";
import {loadJson, saveJson} from "../../../services/storage";

interface PersistedProviderSettings {
  providers?: unknown;
  activeSelection?: unknown;
}

type UnsavedChangesDecision = "save" | "discard" | "cancel";

const persisted = loadJson<PersistedProviderSettings>(
    SETTINGS_KEY,
    (value) => (value && typeof value === "object" ? value as PersistedProviderSettings : {}),
    {}
);

export function useProviderSettings() {
  const connectionProfiles = ref<ConnectionProfile[]>(
      normalizeConnectionProfiles(persisted.providers).length > 0
          ? normalizeConnectionProfiles(persisted.providers)
          : [{
            id: DEFAULT_CONNECTION_ID,
            name: "OpenAI",
            endpoint: DEFAULT_ENDPOINT,
            apiKey: "",
            models: defaultProviderModels(),
          }]
  );
  const selectedProviderId = ref(connectionProfiles.value[0]?.id ?? DEFAULT_CONNECTION_ID);
  const draftName = ref("");
  const draftEndpoint = ref("");
  const draftApiKey = ref("");
  const draftError = ref("");
  const draftIsNew = ref(false);
  const draftEditingId = ref("");
  const unsavedModalOpen = ref(false);
  const modelModalOpen = ref(false);
  const modelDraftProviderId = ref("");
  const modelDraftOriginalId = ref("");
  const modelDraftId = ref("");
  const modelDraftDisplayName = ref("");
  const modelDraftDescription = ref("");
  const modelDraftCapabilities = ref<ModelCapability[]>(["text", "streaming"]);
  const modelDraftContextLength = ref(128000);
  const modelDraftMaxOutputTokens = ref(8192);
  const modelDraftError = ref("");
  const modelSelection = ref(typeof persisted.activeSelection === "string" ? persisted.activeSelection : "");

  const modelSelectOptions = computed(() => connectionProfiles.value
      .filter((provider) => provider.models.length > 0)
      .map((provider) => ({
        isGroup: true as const,
        label: provider.name,
        options: provider.models.map((model) => ({
          value: modelSelectionKey(provider.id, model.id),
          label: modelDisplayName(model),
          providerName: provider.name,
        })),
      })));

  const selectedProvider = computed(() => connectionProfiles.value.find(
      (provider) => provider.id === selectedProviderId.value
  ) ?? connectionProfiles.value[0]);

  const hasUnsavedChanges = computed(() => {
    if (!draftEditingId.value) return false;
    if (draftIsNew.value) return true;
    const provider = connectionProfiles.value.find((item) => item.id === draftEditingId.value);
    return Boolean(provider && (
      draftName.value !== provider.name ||
      draftEndpoint.value !== provider.endpoint ||
      draftApiKey.value !== provider.apiKey
    ));
  });

  let unsavedResolver: ((decision: UnsavedChangesDecision) => void) | null = null;
  let pendingDecision: Promise<UnsavedChangesDecision> | null = null;

  function persist() {
    saveJson(SETTINGS_KEY, {
      providers: connectionProfiles.value,
      activeSelection: modelSelection.value,
    });
  }

  function resolveModelSelection(value: string): ResolvedModel | null {
    return resolveSelection(value, connectionProfiles.value);
  }

  function firstModelSelection(): string {
    const provider = connectionProfiles.value.find((item) => item.models.length > 0);
    const model = provider?.models[0];
    return provider && model ? modelSelectionKey(provider.id, model.id) : "";
  }

  function ensureModelSelection() {
    if (!resolveModelSelection(modelSelection.value)) {
      modelSelection.value = firstModelSelection();
    }
    if (!connectionProfiles.value.some((item) => item.id === selectedProviderId.value)) {
      selectedProviderId.value = connectionProfiles.value[0]?.id ?? "";
    }
    persist();
  }

  function resetDraft(provider: ConnectionProfile | null) {
    draftEditingId.value = provider?.id ?? "";
    draftName.value = provider?.name ?? "";
    draftEndpoint.value = provider?.endpoint ?? "";
    draftApiKey.value = provider?.apiKey ?? "";
    draftError.value = "";
    draftIsNew.value = false;
  }

  function requestUnsavedDecision(): Promise<UnsavedChangesDecision> {
    if (pendingDecision) return pendingDecision;
    unsavedModalOpen.value = true;
    pendingDecision = new Promise((resolve) => { unsavedResolver = resolve; });
    return pendingDecision;
  }

  function resolveUnsavedChanges(decision: UnsavedChangesDecision) {
    const resolve = unsavedResolver;
    unsavedResolver = null;
    pendingDecision = null;
    unsavedModalOpen.value = false;
    resolve?.(decision);
  }

  async function confirmProviderChanges(): Promise<boolean> {
    if (!hasUnsavedChanges.value) return true;
    const decision = await requestUnsavedDecision();
    if (decision === "cancel") return false;
    if (decision === "save") return saveDraft();
    resetDraft(connectionProfiles.value.find((item) => item.id === draftEditingId.value) ?? null);
    return true;
  }

  async function selectProvider(providerId: string) {
    if (providerId === selectedProviderId.value || !await confirmProviderChanges()) return;
    selectedProviderId.value = providerId;
    resetDraft(connectionProfiles.value.find((item) => item.id === providerId) ?? null);
  }

  async function addProvider() {
    if (!await confirmProviderChanges()) return;
    const id = createConnectionId();
    draftEditingId.value = id;
    draftName.value = "";
    draftEndpoint.value = "";
    draftApiKey.value = "";
    draftError.value = "";
    draftIsNew.value = true;
    selectedProviderId.value = id;
  }

  function saveDraft(): boolean {
    const endpoint = draftEndpoint.value.trim();
    const name = draftName.value.trim();
    if (!name) {
      draftError.value = "请输入提供商名称";
      return false;
    }
    if (!endpoint) {
      draftError.value = "请输入 API 地址";
      return false;
    }
    const apiKey = draftApiKey.value.trim();
    if (draftIsNew.value) {
      const profile: ConnectionProfile = {
        id: draftEditingId.value || createConnectionId(),
        name,
        endpoint,
        apiKey,
        models: defaultProviderModels(),
      };
      connectionProfiles.value = [...connectionProfiles.value, profile];
      selectedProviderId.value = profile.id;
      resetDraft(profile);
    } else {
      const current = connectionProfiles.value.find((item) => item.id === draftEditingId.value);
      if (!current) return false;
      const updated = {...current, name, endpoint, apiKey};
      connectionProfiles.value = connectionProfiles.value.map(
          (item) => item.id === updated.id ? updated : item
      );
      resetDraft(updated);
    }
    ensureModelSelection();
    return true;
  }

  function cancelDraft() {
    if (draftIsNew.value) {
      const fallback = connectionProfiles.value[0];
      selectedProviderId.value = fallback?.id ?? "";
      resetDraft(fallback ?? null);
      return;
    }
    resetDraft(connectionProfiles.value.find((item) => item.id === draftEditingId.value) ?? null);
  }

  function removeProvider(profile: ConnectionProfile) {
    if (connectionProfiles.value.length <= 1) return;
    const remaining = connectionProfiles.value.filter((item) => item.id !== profile.id);
    connectionProfiles.value = remaining;
    if (selectedProviderId.value === profile.id) {
      selectedProviderId.value = remaining[0]?.id ?? "";
      resetDraft(remaining[0] ?? null);
    }
    ensureModelSelection();
  }

  function openModelModal(providerId: string, providerModel?: ProviderModel) {
    modelDraftProviderId.value = providerId;
    modelDraftOriginalId.value = providerModel?.id ?? "";
    modelDraftId.value = providerModel?.id ?? "";
    modelDraftDisplayName.value = providerModel?.displayName ?? "";
    modelDraftDescription.value = providerModel?.description ?? "";
    modelDraftCapabilities.value = [...(providerModel?.capabilities ?? ["text", "streaming"])];
    modelDraftContextLength.value = providerModel?.contextLength ?? 128000;
    modelDraftMaxOutputTokens.value = providerModel?.maxOutputTokens ?? 8192;
    modelDraftError.value = "";
    modelModalOpen.value = true;
  }

  function closeModelModal() {
    modelModalOpen.value = false;
    modelDraftProviderId.value = "";
    modelDraftOriginalId.value = "";
    modelDraftError.value = "";
  }

  function toggleDraftCapability(capability: ModelCapability) {
    modelDraftCapabilities.value = modelDraftCapabilities.value.includes(capability)
        ? modelDraftCapabilities.value.filter((item) => item !== capability)
        : [...modelDraftCapabilities.value, capability];
  }

  function saveModelDraft() {
    const provider = connectionProfiles.value.find((item) => item.id === modelDraftProviderId.value);
    const id = modelDraftId.value.trim();
    const contextLength = Number(modelDraftContextLength.value);
    const maxOutputTokens = Number(modelDraftMaxOutputTokens.value);
    if (!provider) return;
    if (!id) {
      modelDraftError.value = "请输入模型 ID";
      return;
    }
    if (provider.models.some((item) => item.id === id && item.id !== modelDraftOriginalId.value)) {
      modelDraftError.value = "该提供商中已存在相同模型 ID";
      return;
    }
    if (!Number.isInteger(contextLength) || contextLength < 1) {
      modelDraftError.value = "输入上下文长度必须是大于 0 的整数";
      return;
    }
    if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 1) {
      modelDraftError.value = "最大输出长度必须是大于 0 的整数";
      return;
    }
    const providerModel: ProviderModel = {
      id,
      displayName: modelDraftDisplayName.value.trim(),
      description: modelDraftDescription.value.trim(),
      capabilities: normalizeCapabilities(modelDraftCapabilities.value),
      contextLength,
      maxOutputTokens,
    };
    const previousId = modelDraftOriginalId.value;
    const models = previousId
        ? provider.models.map((item) => item.id === previousId ? providerModel : item)
        : [...provider.models, providerModel];
    connectionProfiles.value = connectionProfiles.value.map(
        (item) => item.id === provider.id ? {...item, models} : item
    );
    if (previousId && previousId !== id
        && modelSelection.value === modelSelectionKey(provider.id, previousId)) {
      modelSelection.value = modelSelectionKey(provider.id, id);
    }
    ensureModelSelection();
    closeModelModal();
  }

  function removeProviderModel(providerId: string, modelId: string) {
    connectionProfiles.value = connectionProfiles.value.map((item) => item.id === providerId
        ? {...item, models: item.models.filter((model) => model.id !== modelId)}
        : item
    );
    ensureModelSelection();
  }

  function initialize() {
    resetDraft(selectedProvider.value ?? null);
    ensureModelSelection();
  }

  return {
    connectionProfiles,
    selectedProviderId,
    selectedProvider,
    draftName,
    draftEndpoint,
    draftApiKey,
    draftError,
    draftIsNew,
    unsavedModalOpen,
    modelModalOpen,
    modelDraftId,
    modelDraftDisplayName,
    modelDraftDescription,
    modelDraftCapabilities,
    modelDraftContextLength,
    modelDraftMaxOutputTokens,
    modelDraftError,
    modelSelection,
    modelSelectOptions,
    hasUnsavedChanges,
    resolveModelSelection,
    ensureModelSelection,
    resolveUnsavedChanges,
    selectProvider,
    addProvider,
    saveDraft,
    cancelDraft,
    removeProvider,
    openModelModal,
    closeModelModal,
    toggleDraftCapability,
    saveModelDraft,
    removeProviderModel,
    initialize,
  };
}

export type ProviderSettings = ReturnType<typeof useProviderSettings>;
