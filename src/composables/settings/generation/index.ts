import {ref, watch} from "vue";
import {loadJson, saveJson} from "../../../services/storage";
import type {ContentMode} from "../../../domain/prompts";

export const GENERATION_SETTINGS_KEY = "gugle-novel-generation-settings";
export const DEFAULT_ILLUSTRATION_PARAGRAPH_INTERVAL = 3;
/** 插图间隔的上下限，设置页滑块与持久化校正共用同一组边界。 */
export const MIN_ILLUSTRATION_PARAGRAPH_INTERVAL = 1;
export const MAX_ILLUSTRATION_PARAGRAPH_INTERVAL = 20;

interface PersistedGenerationSettings {
  temperature?: unknown;
  outputTokenOverride?: unknown;
  autoTitle?: unknown;
  contentMode?: unknown;
  illustrationEnabled?: unknown;
  illustrationParagraphInterval?: unknown;
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

function normalizeContentMode(value: unknown): ContentMode {
  return value === "nsfw" ? "nsfw" : "sfw";
}

export function useGenerationSettings() {
  const temperature = ref(clampNumber(persisted.temperature, 0.9, 0, 2));
  /** 0 表示跟随模型的 maxOutputTokens */
  const outputTokenOverride = ref(clampNumber(persisted.outputTokenOverride, 0, 0, 128000));
  const autoTitle = ref(persisted.autoTitle !== false);
  const contentMode = ref<ContentMode>(normalizeContentMode(persisted.contentMode));
  const illustrationEnabled = ref(persisted.illustrationEnabled === true);
  /** 每累计 N 个正文段落最多生成 1 张插图 */
  const illustrationParagraphInterval = ref(
      Math.round(clampNumber(
          persisted.illustrationParagraphInterval,
          DEFAULT_ILLUSTRATION_PARAGRAPH_INTERVAL,
          MIN_ILLUSTRATION_PARAGRAPH_INTERVAL,
          MAX_ILLUSTRATION_PARAGRAPH_INTERVAL
      ))
  );

  function persist() {
    saveJson(GENERATION_SETTINGS_KEY, {
      temperature: temperature.value,
      outputTokenOverride: outputTokenOverride.value,
      autoTitle: autoTitle.value,
      contentMode: contentMode.value,
      illustrationEnabled: illustrationEnabled.value,
      illustrationParagraphInterval: illustrationParagraphInterval.value,
    });
  }

  watch(
      [temperature, outputTokenOverride, autoTitle, contentMode, illustrationEnabled, illustrationParagraphInterval],
      persist
  );

  return {
    temperature,
    outputTokenOverride,
    autoTitle,
    contentMode,
    illustrationEnabled,
    illustrationParagraphInterval,
  };
}

export type GenerationSettings = ReturnType<typeof useGenerationSettings>;
