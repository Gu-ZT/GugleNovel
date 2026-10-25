import type {ContentMode} from "../prompts";

/** 主模型用于插入插图的函数工具名称，请求与解析共用同一常量。 */
export const ILLUSTRATION_TOOL_NAME = "insert_illustration";

/** OpenAI 兼容的函数工具定义；参数只保留画面提示词，位置由对话顺序决定。 */
export interface ChatToolDefinition {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface IllustrationToolContext {
  contentMode: ContentMode;
  /** 生图模型是否允许 NSFW；false 时要求主模型把提示词控制在全年龄范围 */
  imageModelAllowsNsfw: boolean;
  /** 每累计 N 个正文段落最多 1 张插图，写入工具描述避免模型先被拒绝再调整 */
  paragraphInterval: number;
}

export const SFW_ILLUSTRATION_CONTENT_RULE =
  "提示词必须符合全年龄内容规范，不得出现裸露、性行为、血腥暴力细节或虐待描写；无法合规表达时不要调用本工具。";

export const NSFW_ILLUSTRATION_CONTENT_RULE =
  "提示词可以与正文保持相同的成人向尺度。";

/**
 * 构造插图工具定义。工具描述始终携带程序侧的频率与衔接规则，
 * 内容尺度要求由生图模型能力决定：SFW 模式或生图模型不支持 NSFW 时限定全年龄。
 */
export function buildIllustrationTool(context: IllustrationToolContext): ChatToolDefinition {
  const contentRule = context.contentMode === "nsfw" && context.imageModelAllowsNsfw
      ? NSFW_ILLUSTRATION_CONTENT_RULE
      : SFW_ILLUSTRATION_CONTENT_RULE;
  return {
    type: "function",
    function: {
      name: ILLUSTRATION_TOOL_NAME,
      description: [
        "为当前剧情插入一张插图。图片会插在你调用本工具的位置，随后你可以继续写正文。",
        "仅在关键场景、需要强化画面感时调用，不要连续调用。",
        `正文每累计约 ${context.paragraphInterval} 个段落（以空行分隔）最多配 1 张插图，未达到间隔时调用会被拒绝。`,
        contentRule,
      ].join(""),
      parameters: {
        type: "object",
        properties: {
          prompt: {
            type: "string",
            description: "用于图像模型的中文画面描述，包含人物、动作、构图、光线、氛围与画风。",
          },
        },
        required: ["prompt"],
        additionalProperties: false,
      },
    },
  };
}

/** 解析工具参数中的提示词；非法 JSON 或空提示词返回 null，由调用方转成工具错误。 */
export function parseIllustrationPrompt(argumentsJson: string): string | null {
  try {
    const payload: unknown = JSON.parse(argumentsJson);
    if (!payload || typeof payload !== "object") return null;
    const prompt = (payload as Record<string, unknown>).prompt;
    if (typeof prompt !== "string") return null;
    const trimmed = prompt.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}
