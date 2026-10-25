import {
  appendImageSegment,
  appendTextSegment,
  createNodeId,
  messageContextMessages,
  paragraphsSinceLastImage,
  resolvePath,
  type Conversation,
  type ImageSegmentMeta,
  type MessageNode,
} from "../../../domain/tree";
import {
  ILLUSTRATION_TOOL_NAME,
  buildIllustrationTool,
  parseIllustrationPrompt,
} from "../../../domain/illustration";
import {ILLUSTRATION_OUTPUT_CONSTRAINT, SFW_ONLY_ILLUSTRATION_CONSTRAINT, type ContentMode} from "../../../domain/prompts";
import {OpenAIConnection} from "../../../api";
import type {ResolvedModel} from "../../../domain/models";
import {generateIllustration} from "../../../services/image";
import {saveImage} from "../../../services/image/store";
import {
  isAbortError,
  requestChatCompletion,
  type ChatRequestMessage,
  type ChatToolCall,
} from "../../../services/transport";

/** 单次助手回复内允许处理的最大工具调用次数，防止模型陷入反复调用。 */
export const MAX_TOOL_CALLS_PER_RESPONSE = 16;

/** 插图能力配置，决定是否向主模型暴露生图工具与提示词。 */
export interface IllustrationOptions {
  enabled: boolean;
  contentMode: ContentMode;
  /** 每累计 N 个正文段落最多生成 1 张插图 */
  paragraphInterval: number;
  /** 当前内容模式对应的生图提示词，已按会话变量渲染 */
  systemPrompt: string;
  imageModel: ResolvedModel | null;
}

export interface GenerationOptions {
  model: ResolvedModel;
  connection: OpenAIConnection;
  temperature: number;
  maxTokens: number;
  stream: boolean;
  /** 渲染后的会话系统提示词 */
  systemPrompt: string;
  illustration: IllustrationOptions;
}

export interface GenerationCallbacks {
  /** 正文增量，调用方按同样顺序追加到真实消息节点 */
  onTextDelta: (delta: string) => void;
  onReasoning: (fullReasoning: string) => void;
  /** 模型发起插图调用：调用方在此刻插入生成中卡片，位置即插图最终位置 */
  onIllustrationStart: (start: IllustrationStart) => void;
  /** 插图写入本地仓库完成：调用方把对应卡片回填为图片 */
  onIllustrationReady: (ready: IllustrationReady) => void;
  /** 插图失败：调用方把对应卡片标记为失败；正文继续生成 */
  onIllustrationFailed: (failed: IllustrationFailed) => void;
}

/** 插图调用开始时的上下文快照，用于卡片展示与参数留存。 */
export interface IllustrationStart {
  prompt: string;
  meta: ImageSegmentMeta;
  /** 触发该插图的工具调用 id，用于在上下文中重建调用记录 */
  toolCallId: string;
}

export interface IllustrationReady {
  prompt: string;
  imageId: string;
  durationMs: number;
  callIndex: number;
}

export interface IllustrationFailed {
  prompt: string;
  reason: string;
  durationMs: number;
  callIndex: number;
}

/**
 * 判定插图能力是否真正生效：功能开启、已选图像模型、主模型标记了工具调用能力。
 * 三者缺一都退回普通正文生成，避免把生成能力整体拦死。
 */
export function isIllustrationActive(options: GenerationOptions): boolean {
  return options.illustration.enabled
      && options.illustration.imageModel !== null
      && options.model.model.capabilities.includes("tools");
}

/** 组装主模型看到的系统提示词：会话提示词 + 生图提示词 + 输出规则 + 生图模型能力限制。 */
export function composeSystemPrompt(options: GenerationOptions): string {
  const parts = [options.systemPrompt.trim()];
  const illustration = options.illustration;
  if (isIllustrationActive(options)) {
    if (illustration.systemPrompt.trim()) parts.push(illustration.systemPrompt.trim());
    // 输出规则由程序固定追加，即使用户把生图提示词删空也能阻止模型在正文里写插图标记
    parts.push(ILLUSTRATION_OUTPUT_CONSTRAINT);
    const imageAllowsNsfw = illustration.imageModel?.model.supportsNsfw === true;
    if (illustration.contentMode === "nsfw" && !imageAllowsNsfw) {
      parts.push(SFW_ONLY_ILLUSTRATION_CONSTRAINT);
    }
  }
  return parts.filter(Boolean).join("\n\n");
}

/** 组装请求消息：渲染后的系统提示词 + 当前路径消息，按模型上下文预算从旧到新裁剪。 */
export function buildRequestMessages(
    conversation: Conversation,
    systemPrompt: string,
    contextLength: number
): ChatRequestMessage[] {
  const charBudget = contextLength * 4; // 粗略估算：1 token ≈ 4 字符
  const path = resolvePath(conversation);
  /** 每条历史消息展开为一条或多条上下文消息，插图会展开成工具调用与结果 */
  const blocks = path.map((node) => messageContextMessages(node).filter((message) => message.content.trim()
      || (message.tool_calls?.length ?? 0) > 0));
  const messages: ChatRequestMessage[] = [];
  let used = systemPrompt.length;
  for (let index = blocks.length - 1; index >= 0; index--) {
    const block = blocks[index];
    if (block.length === 0) continue;
    const blockLength = block.reduce((total, message) => total + message.content.length, 0);
    if (used + blockLength > charBudget && messages.length > 0) break;
    messages.unshift(...block as ChatRequestMessage[]);
    used += blockLength;
  }
  return [
    ...(systemPrompt.trim() ? [{role: "system" as const, content: systemPrompt}] : []),
    ...messages,
  ];
}

/**
 * 执行一次完整的助手回复：正文流式追加 → 遇到插图工具调用时生图并续写。
 * 内部维护一份与真实消息同构的影子节点，用于统计段落间隔；
 * 正文与插图通过增量回调交给调用方写入真实节点。
 */
export async function runGeneration(
    options: GenerationOptions,
    messages: ChatRequestMessage[],
    signal: AbortSignal,
    callbacks: GenerationCallbacks
): Promise<void> {
  const shadow: MessageNode = {
    id: createNodeId(),
    parentId: null,
    childrenIds: [],
    role: "assistant",
    segments: [],
    createdAt: Date.now(),
  };
  const workingMessages = [...messages];
  let reasoningBuffer = "";
  let toolCallCount = 0;
  const imageModel = options.illustration.imageModel;
  const illustrationActive = isIllustrationActive(options);
  const tools = illustrationActive && imageModel
      ? [buildIllustrationTool({
        contentMode: options.illustration.contentMode,
        imageModelAllowsNsfw: imageModel.model.supportsNsfw,
        paragraphInterval: options.illustration.paragraphInterval,
      })]
      : undefined;

  for (;;) {
    if (signal.aborted) break;
    let streamedLength = 0;
    const result = await requestChatCompletion({
      connection: options.connection,
      model: options.model.model.id,
      messages: workingMessages,
      tools,
      temperature: options.temperature,
      maxTokens: options.maxTokens,
      stream: options.stream,
      signal,
      onDelta: (fullText) => {
        // 回调给出的是本轮累计全文，按增量写入影子节点与界面
        const delta = fullText.slice(streamedLength);
        if (!delta) return;
        streamedLength = fullText.length;
        appendTextSegment(shadow, delta);
        callbacks.onTextDelta(delta);
      },
      onReasoningDelta: (reasoning) => {
        callbacks.onReasoning(reasoningBuffer + reasoning);
      },
    });
    if (result.reasoning) {
      reasoningBuffer += result.reasoning;
      callbacks.onReasoning(reasoningBuffer);
    }
    if (result.toolCalls.length === 0) break;

    const toolCalls: ChatToolCall[] = result.toolCalls.map((call) => ({
      id: call.id,
      type: "function" as const,
      function: {name: call.name, arguments: call.arguments},
    }));
    workingMessages.push({role: "assistant", content: result.text, tool_calls: toolCalls});
    for (const call of result.toolCalls) {
      toolCallCount++;
      if (toolCallCount > MAX_TOOL_CALLS_PER_RESPONSE) {
        throw new Error(`单次回复的工具调用超过 ${MAX_TOOL_CALLS_PER_RESPONSE} 次，已停止生成`);
      }
      const outcome = await handleToolCall(
          options,
          shadow,
          call,
          signal,
          callbacks,
          toolCallCount,
      );
      workingMessages.push({role: "tool", tool_call_id: call.id, content: outcome.content});
    }
  }
}

interface ToolCallOutcome {
  /** 回传给主模型的工具结果文本 */
  content: string;
}

/** 处理一次工具调用：未通过频率校验时只回传原因，通过后生图并在正文中插入卡片。 */
async function handleToolCall(
    options: GenerationOptions,
    shadow: MessageNode,
    call: {id: string; name: string; arguments: string},
    signal: AbortSignal,
    callbacks: GenerationCallbacks,
    callIndex: number
): Promise<ToolCallOutcome> {
  if (call.name !== ILLUSTRATION_TOOL_NAME) {
    return {content: `不支持的函数：${call.name}。请不要调用该函数。`};
  }
  const prompt = parseIllustrationPrompt(call.arguments);
  if (!prompt) {
    return {
      content: "插图提示词为空或格式错误，本次未生成插图。请继续写正文，或重新提交完整的画面描述。",
    };
  }
  const paragraphs = paragraphsSinceLastImage(shadow);
  const required = options.illustration.paragraphInterval;
  if (paragraphs < required) {
    return {
      content: `当前距离上一张插图仅 ${paragraphs} 个段落，需要至少 ${required} 个段落才能插图。本次未生成插图，请继续写正文，不要重复调用。`,
    };
  }
  const imageModel = options.illustration.imageModel;
  if (!imageModel) {
    return {content: "尚未配置图像模型，本次未生成插图。请继续写正文。"};
  }
  const startedAt = Date.now();
  const callMeta: ImageSegmentMeta = {
    imageModel: imageModel.model.id,
    imageProvider: imageModel.provider.name,
    contentMode: options.illustration.contentMode,
    paragraphsSinceLastImage: paragraphs,
    callIndex,
    imageModelSupportsNsfw: imageModel.model.supportsNsfw,
  };
  // 影子节点同步插入占位，保证后续正文与新插图的分段边界一致
  appendImageSegment(shadow, prompt, callMeta, call.id);
  callbacks.onIllustrationStart({prompt, meta: callMeta, toolCallId: call.id});
  try {
    const generated = await generateIllustration({model: imageModel, prompt, signal});
    const imageId = await saveImage(generated.blob, generated.mimeType);
    const durationMs = Date.now() - startedAt;
    callbacks.onIllustrationReady({prompt, imageId, durationMs, callIndex});
    return {
      content: "插图已生成并插入到当前段落之后。请继续写正文，不要重复描述刚才已经配图的画面。",
    };
  } catch (error) {
    if (isAbortError(error)) throw error;
    const reason = error instanceof Error ? error.message : String(error);
    callbacks.onIllustrationFailed({prompt, reason, durationMs: Date.now() - startedAt, callIndex});
    // 回传给主模型的内容只说明结果，不携带接口原始报错，
    // 避免模型据此改写或复述画面描述
    return {
      content: "本次插图未能生成，已跳过。请直接继续写正文，不要重复调用本工具，也不要在正文中描述这张画面。",
    };
  }
}
