import {computed, ref} from "vue";
import {
  PROMPT_SETTINGS_KEY,
  createPresetId,
  normalizePromptPresets,
  type PromptPreset,
} from "../../../domain/prompts";
import {loadJson, saveJson} from "../../../services/storage";

interface PersistedPromptSettings {
  presets?: unknown;
  activePresetId?: unknown;
}

const persisted = loadJson<PersistedPromptSettings>(
    PROMPT_SETTINGS_KEY,
    (value) => (value && typeof value === "object" ? value as PersistedPromptSettings : {}),
    {}
);

export function usePromptSettings() {
  const presets = ref<PromptPreset[]>(normalizePromptPresets(persisted.presets));
  const activePresetId = ref(
      typeof persisted.activePresetId === "string"
      && presets.value.some((preset) => preset.id === persisted.activePresetId)
          ? persisted.activePresetId
          : presets.value[0]?.id ?? ""
  );
  const editingPresetId = ref(presets.value[0]?.id ?? "");
  const draftName = ref("");
  const draftSystemPrompt = ref("");

  const activePreset = computed(() => presets.value.find(
      (preset) => preset.id === activePresetId.value
  ) ?? presets.value[0]);

  const presetSelectOptions = computed(() => presets.value.map((preset) => ({
    value: preset.id,
    label: preset.name,
  })));

  function persist() {
    saveJson(PROMPT_SETTINGS_KEY, {
      presets: presets.value,
      activePresetId: activePresetId.value,
    });
  }

  function loadDraft(preset: PromptPreset | undefined) {
    editingPresetId.value = preset?.id ?? "";
    draftName.value = preset?.name ?? "";
    draftSystemPrompt.value = preset?.systemPrompt ?? "";
  }

  function selectPreset(presetId: string) {
    loadDraft(presets.value.find((preset) => preset.id === presetId));
  }

  function addPreset() {
    const preset: PromptPreset = {
      id: createPresetId(),
      name: `预设 ${presets.value.length + 1}`,
      systemPrompt: "",
      isDefault: false,
    };
    presets.value = [...presets.value, preset];
    loadDraft(preset);
    persist();
  }

  function saveDraft() {
    const id = editingPresetId.value;
    if (!id) return;
    presets.value = presets.value.map((preset) => preset.id === id
        ? {...preset, name: draftName.value.trim() || preset.name, systemPrompt: draftSystemPrompt.value}
        : preset
    );
    persist();
  }

  function removePreset(presetId: string) {
    const target = presets.value.find((preset) => preset.id === presetId);
    if (!target || target.isDefault) return;
    presets.value = presets.value.filter((preset) => preset.id !== presetId);
    if (activePresetId.value === presetId) activePresetId.value = presets.value[0]?.id ?? "";
    if (editingPresetId.value === presetId) loadDraft(presets.value[0]);
    persist();
  }

  function setActivePreset(presetId: string) {
    activePresetId.value = presetId;
    persist();
  }

  loadDraft(presets.value.find((preset) => preset.id === editingPresetId.value) ?? presets.value[0]);

  return {
    presets,
    activePresetId,
    activePreset,
    presetSelectOptions,
    editingPresetId,
    draftName,
    draftSystemPrompt,
    selectPreset,
    addPreset,
    saveDraft,
    removePreset,
    setActivePreset,
  };
}

export type PromptSettings = ReturnType<typeof usePromptSettings>;
