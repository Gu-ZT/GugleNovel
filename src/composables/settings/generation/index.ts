import {ref, watch} from "vue";
import {loadJson, saveJson} from "../../../services/storage";

export const GENERATION_SETTINGS_KEY = "gugle-novel-generation-settings";

interface PersistedGenerationSettings {
  temperature?: unknown;
  outputTokenOverride?: unknown;
  autoTitle?: unknown;
}

const persisted = loadJson<PersistedGenerationSettings>(
    GENERATION_SETTINGS_KEY,
    (value) => (value && typeof value === "object" ? value as PersistedGenerationSettings : {}),
    {}
);

function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

export function useGenerationSettings() {
  const temperature = ref(clampNumber(persisted.temperature, 0.9, 0, 2));
  /** 0 表示跟随模型的 maxOutputTokens */
  const outputTokenOverride = ref(clampNumber(persisted.outputTokenOverride, 0, 0, 128000));
  const autoTitle = ref(persisted.autoTitle !== false);

  function persist() {
    saveJson(GENERATION_SETTINGS_KEY, {
      temperature: temperature.value,
      outputTokenOverride: outputTokenOverride.value,
      autoTitle: autoTitle.value,
    });
  }

  watch([temperature, outputTokenOverride, autoTitle], persist);

  return {
    temperature,
    outputTokenOverride,
    autoTitle,
  };
}

export type GenerationSettings = ReturnType<typeof useGenerationSettings>;
