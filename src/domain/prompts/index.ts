export interface PromptPreset {
  id: string;
  name: string;
  systemPrompt: string;
  isDefault: boolean;
}

export interface PromptVariableDefinition {
  token: string;
  description: string;
}

export const PROMPT_SETTINGS_KEY = "gugle-novel-prompt-settings";
export const DEFAULT_PROMPT_PRESET_ID = "default-novelist";
export const DEFAULT_NOVELIST_SYSTEM_PROMPT = `你是一位专业的小说作家，当前环境：日期 {{date}}，模型 {{model_name}}。请遵循以下创作原则：
1. 根据用户的指令续写或改写小说内容，保持文风 {{style}}，题材 {{genre}}。
2. 注重人物刻画与场景氛围，对话自然，节奏张弛有度。
3. 除非用户要求大纲或讨论，否则直接输出正文，不要解释创作思路。
4. 保持与前文情节、设定的一致性。
5. 单次输出长度适中，给用户留出干预与选择的空间。`;

export const PROMPT_VARIABLES: PromptVariableDefinition[] = [
  {token: "{{date}}", description: "日期"},
  {token: "{{time}}", description: "时间"},
  {token: "{{model_name}}", description: "模型名称"},
  {token: "{{genre}}", description: "题材（会话级设定）"},
  {token: "{{style}}", description: "文风（会话级设定）"},
];

export function defaultPromptPreset(): PromptPreset {
  return {
    id: DEFAULT_PROMPT_PRESET_ID,
    name: "小说作家",
    systemPrompt: DEFAULT_NOVELIST_SYSTEM_PROMPT,
    isDefault: true,
  };
}

export function normalizePromptPresets(value: unknown): PromptPreset[] {
  const source = Array.isArray(value) ? value : [];
  const presets: PromptPreset[] = [];
  const usedIds = new Set<string>();
  for (const item of source) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    let id = typeof record.id === "string" && record.id.trim() ? record.id.trim() : createPresetId();
    if (usedIds.has(id)) id = createPresetId();
    usedIds.add(id);
    presets.push({
      id,
      name: typeof record.name === "string" ? record.name : "",
      systemPrompt: typeof record.systemPrompt === "string" ? record.systemPrompt : "",
      isDefault: id === DEFAULT_PROMPT_PRESET_ID,
    });
  }
  const savedDefault = presets.find((preset) => preset.id === DEFAULT_PROMPT_PRESET_ID);
  const custom = presets.filter((preset) => preset.id !== DEFAULT_PROMPT_PRESET_ID);
  return [savedDefault ?? defaultPromptPreset(), ...custom];
}

export function createPresetId(): string {
  return globalThis.crypto?.randomUUID?.()
      ?? `preset-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function renderPromptVariables(
    prompt: string,
    variables: Record<string, string>
): string {
  return prompt.replace(/\{\{\s*(\w+)\s*\}\}/g, (raw, key: string) => variables[key] ?? raw);
}
