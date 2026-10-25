export interface PromptPreset {
  id: string;
  name: string;
  systemPrompt: string;
  /** 插图功能开启且内容模式为 SFW 时追加给主模型的生图提示词 */
  sfwIllustrationPrompt: string;
  /** 插图功能开启且内容模式为 NSFW 时追加给主模型的生图提示词 */
  nsfwIllustrationPrompt: string;
  isDefault: boolean;
}

export interface PromptVariableDefinition {
  token: string;
  description: string;
}

/** 内容模式：SFW 由主模型自行判定生图提示词合规，NSFW 允许成人向描写。 */
export type ContentMode = "sfw" | "nsfw";

export const CONTENT_MODE_LABELS: Record<ContentMode, string> = {
  sfw: "SFW（全年龄）",
  nsfw: "NSFW（成人向）",
};

export const PROMPT_SETTINGS_KEY = "gugle-novel-prompt-settings";
export const DEFAULT_PROMPT_PRESET_ID = "default-novelist";
export const DEFAULT_NOVELIST_SYSTEM_PROMPT = `你是一位专业的小说作家，当前环境：日期 {{date}}，模型 {{model_name}}。请遵循以下创作原则：
1. 根据用户的指令续写或改写小说内容，保持文风 {{style}}，题材 {{genre}}。
2. 注重人物刻画与场景氛围，对话自然，节奏张弛有度。
3. 除非用户要求大纲或讨论，否则直接输出正文，不要解释创作思路。
4. 保持与前文情节、设定的一致性。
5. 单次输出长度适中，给用户留出干预与选择的空间。`;

export const DEFAULT_SFW_ILLUSTRATION_PROMPT = `【插图】你可以调用 insert_illustration 工具，在高潮或关键场景描写完成后插入一张插图。
1. 由你自行判断当前剧情是否需要插图，以及插图位置；不要为每段正文都配图。
2. 工具参数 prompt 必须是用于图像模型的中文画面描述：写清人物、动作、构图、光线、氛围与画风，不要包含对剧情走向的解释。
3. 提交的 prompt 必须符合全年龄内容规范：不出现裸露、性行为、血腥暴力细节或虐待描写。剧情本身涉及这些内容时，改写为暗示性构图或直接放弃调用。
4. 插图只是正文的补充，插图前后要让正文自然衔接。`;

export const DEFAULT_NSFW_ILLUSTRATION_PROMPT = `【插图】你可以调用 insert_illustration 工具，在当前场景描写完成后插入一张插图。
1. 由你自行判断当前剧情是否需要插图，以及插图位置；不要为每段正文都配图。
2. 工具参数 prompt 必须是用于图像模型的中文画面描述：写清人物、动作、构图、光线、氛围与画风，不要包含对剧情走向的解释。
3. 内容模式为成人向，prompt 可以与正文保持相同的尺度，但仍需避免对未成年人、性暴力与极端伤害的描写。
4. 插图只是正文的补充，插图前后要让正文自然衔接。`;

/** 生图模型不支持 NSFW 时追加给主模型的限制，保证正文尺度不受插图能力牵制。 */
export const SFW_ONLY_ILLUSTRATION_CONSTRAINT = `【重要】当前配置的图像模型只接受全年龄内容：正文可以按成人向尺度写作，但 insert_illustration 的 prompt 必须改写为不含裸露与性行为的画面，只给出服装、姿态、氛围与情绪等可用视觉元素；无法安全改写时不要调用该工具。`;

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
    sfwIllustrationPrompt: DEFAULT_SFW_ILLUSTRATION_PROMPT,
    nsfwIllustrationPrompt: DEFAULT_NSFW_ILLUSTRATION_PROMPT,
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
      sfwIllustrationPrompt: typeof record.sfwIllustrationPrompt === "string"
          ? record.sfwIllustrationPrompt
          : DEFAULT_SFW_ILLUSTRATION_PROMPT,
      nsfwIllustrationPrompt: typeof record.nsfwIllustrationPrompt === "string"
          ? record.nsfwIllustrationPrompt
          : DEFAULT_NSFW_ILLUSTRATION_PROMPT,
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
