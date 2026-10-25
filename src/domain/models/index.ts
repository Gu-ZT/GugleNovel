/** 模型类型：文本模型参与正文生成，图像模型只用于按提示词出图。 */
export type ModelKind = "text" | "image";

export type ModelCapability = "text" | "streaming" | "reasoning" | "json" | "tools";

export interface ConnectionProfile {
  id: string;
  name: string;
  endpoint: string;
  apiKey: string;
  models: ProviderModel[];
}

export interface ProviderModel {
  id: string;
  displayName: string;
  description: string;
  kind: ModelKind;
  capabilities: ModelCapability[];
  /** 是否允许该模型产出 NSFW 内容，由用户按提供商实际能力标记 */
  supportsNsfw: boolean;
  /** 文本模型的输入上下文长度；图像模型不使用该字段，固定为 0 */
  contextLength: number;
  /** 文本模型的单次输出上限；图像模型不使用该字段，固定为 0 */
  maxOutputTokens: number;
}

export interface ResolvedModel {
  provider: ConnectionProfile;
  model: ProviderModel;
}

export const SETTINGS_KEY = "gugle-novel-settings";
export const DEFAULT_ENDPOINT = "https://api.openai.com/v1";
export const DEFAULT_CONNECTION_ID = "default-openai";
export const DEFAULT_MODEL_OPTIONS = [
  "gpt-4.1-mini",
  "gpt-4o",
  "deepseek-chat",
  "deepseek-reasoner",
  "claude-sonnet-4-5",
  "qwen-long",
];
export const ALL_CAPABILITIES: ModelCapability[] = ["text", "streaming", "reasoning", "json", "tools"];
export const CAPABILITY_LABELS: Record<ModelCapability, string> = {
  text: "文本生成",
  streaming: "流式输出",
  reasoning: "深度思考",
  json: "结构化输出",
  tools: "工具调用",
};
export const MODEL_KIND_LABELS: Record<ModelKind, string> = {
  text: "文本模型",
  image: "图像模型",
};

/** 内置默认模型里支持函数工具调用的型号，其余型号由用户在编辑弹窗中自行标记。 */
const DEFAULT_TOOL_MODELS = new Set([
  "gpt-4.1-mini",
  "gpt-4o",
  "deepseek-chat",
  "claude-sonnet-4-5",
  "qwen-long",
]);

export function createConnectionId(): string {
  return globalThis.crypto?.randomUUID?.()
      ?? `connection-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function defaultProviderModels(): ProviderModel[] {
  return normalizeProviderModels(DEFAULT_MODEL_OPTIONS, DEFAULT_MODEL_OPTIONS, true);
}

export function normalizeCapabilities(value: unknown): ModelCapability[] {
  const source = Array.isArray(value) ? value : ["text", "streaming"];
  const capabilities = source.filter(
      (item): item is ModelCapability => typeof item === "string" && ALL_CAPABILITIES.includes(item as ModelCapability)
  );
  return capabilities.length > 0 ? [...new Set(capabilities)] : ["text"];
}

export function normalizeModelKind(value: unknown): ModelKind {
  return value === "image" ? "image" : "text";
}

export function normalizeProviderModels(
    value: unknown,
    fallback: string[] = DEFAULT_MODEL_OPTIONS,
    applyDefaultTools = false
): ProviderModel[] {
  const source = Array.isArray(value) ? value : fallback;
  const models: ProviderModel[] = [];
  const usedIds = new Set<string>();
  for (const item of source) {
    const record = item && typeof item === "object" ? item as Record<string, unknown> : null;
    const id = typeof item === "string"
        ? item.trim()
        : typeof record?.id === "string"
            ? record.id.trim()
            : "";
    if (!id || usedIds.has(id)) continue;
    const kind = normalizeModelKind(record?.kind);
    const isImage = kind === "image";
    const contextLength = Number(record?.contextLength ?? 128000);
    const maxOutputTokens = Number(record?.maxOutputTokens ?? 8192);
    const capabilities = isImage
        ? []
        : applyDefaultTools && DEFAULT_TOOL_MODELS.has(id)
            ? normalizeCapabilities([...(Array.isArray(record?.capabilities) ? record.capabilities : ["text", "streaming"]), "tools"])
            : normalizeCapabilities(record?.capabilities);
    models.push({
      id,
      displayName: typeof record?.displayName === "string" ? record.displayName.trim() : "",
      description: typeof record?.description === "string" ? record.description.trim() : "",
      kind,
      capabilities,
      supportsNsfw: record?.supportsNsfw === true,
      contextLength: isImage
          ? 0
          : Number.isInteger(contextLength) && contextLength > 0 ? contextLength : 128000,
      maxOutputTokens: isImage
          ? 0
          : Number.isInteger(maxOutputTokens) && maxOutputTokens > 0 ? maxOutputTokens : 8192,
    });
    usedIds.add(id);
  }
  return models;
}

export function normalizeConnectionProfiles(
    value: unknown,
    fallbackModels = DEFAULT_MODEL_OPTIONS
): ConnectionProfile[] {
  if (!Array.isArray(value)) return [];
  const profiles: ConnectionProfile[] = [];
  const usedIds = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const endpoint = typeof record.endpoint === "string" ? record.endpoint.trim() : "";
    const apiKey = typeof record.apiKey === "string" ? record.apiKey.trim() : "";
    if (!endpoint) continue;
    let id = typeof record.id === "string" && record.id.trim()
        ? record.id.trim()
        : createConnectionId();
    if (usedIds.has(id)) id = createConnectionId();
    profiles.push({
      id,
      name: typeof record.name === "string" && record.name.trim()
          ? record.name.trim()
          : providerNameFromEndpoint(endpoint, profiles.length + 1),
      endpoint,
      apiKey,
      models: normalizeProviderModels(record.models, fallbackModels),
    });
    usedIds.add(id);
  }
  return profiles;
}

export function providerNameFromEndpoint(endpoint: string, index: number): string {
  try {
    return new URL(endpoint).hostname || `提供商 ${index}`;
  } catch {
    return `提供商 ${index}`;
  }
}

export function modelSelectionKey(providerId: string, modelId: string): string {
  return `${encodeURIComponent(providerId)}|${encodeURIComponent(modelId)}`;
}

export function resolveModelSelection(
    value: string,
    profiles: ConnectionProfile[],
    kind?: ModelKind
): ResolvedModel | null {
  const separator = value.indexOf("|");
  if (separator < 0) return null;
  let providerId = "";
  let modelId = "";
  try {
    providerId = decodeURIComponent(value.slice(0, separator));
    modelId = decodeURIComponent(value.slice(separator + 1));
  } catch {
    return null;
  }
  const provider = profiles.find((item) => item.id === providerId);
  const model = provider?.models.find((item) => item.id === modelId);
  if (!provider || !model) return null;
  return kind && model.kind !== kind ? null : {provider, model};
}

export function modelDisplayName(model: ProviderModel): string {
  return model.displayName || model.id;
}

export function resolvedModelLabel(resolved: ResolvedModel): string {
  return `${modelDisplayName(resolved.model)} · ${resolved.provider.name}`;
}

/** 列出指定类型的全部模型选项，供写作页与设置页的下拉框按类型过滤。 */
export function modelOptionsByKind(
    profiles: ConnectionProfile[],
    kind: ModelKind
): Array<{value: string; label: string; providerName: string}> {
  return profiles.flatMap((provider) => provider.models
      .filter((model) => model.kind === kind)
      .map((model) => ({
        value: modelSelectionKey(provider.id, model.id),
        label: modelDisplayName(model),
        providerName: provider.name,
      })));
}
