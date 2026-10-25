import {OpenAIConnection} from "../../api";
import {describeHttpFailure, systemFetch} from "../../composables/fetch";
import type {ChatToolDefinition} from "../../domain/illustration";

export type ChatRole = "system" | "user" | "assistant" | "tool";

/** 助手在请求中回传的工具调用记录，保持 OpenAI 兼容格式。 */
export interface ChatToolCall {
  id: string;
  type: "function";
  function: {name: string; arguments: string};
}

export interface ChatRequestMessage {
  role: ChatRole;
  content: string;
  /** 仅 assistant 消息携带：本轮发起过的工具调用 */
  tool_calls?: ChatToolCall[];
  /** 仅 tool 消息携带：回应哪一次工具调用 */
  tool_call_id?: string;
}

/** 一次生成中由模型发起的工具调用，arguments 为累计后的原始 JSON 字符串。 */
export interface ReceivedToolCall {
  id: string;
  name: string;
  arguments: string;
}

export interface ChatCompletionResult {
  text: string;
  reasoning: string;
  toolCalls: ReceivedToolCall[];
}

export interface ChatCompletionOptions {
  connection: OpenAIConnection;
  model: string;
  messages: ChatRequestMessage[];
  tools?: ChatToolDefinition[];
  temperature?: number;
  maxTokens?: number;
  stream: boolean;
  signal: AbortSignal;
  /** 流式增量回调，参数为累计全文 */
  onDelta?: (fullText: string) => void;
  /** 思维链增量回调，参数为累计思维链全文（DeepSeek reasoning_content / OpenRouter reasoning） */
  onReasoningDelta?: (fullReasoning: string) => void;
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

export async function requestChatCompletion(options: ChatCompletionOptions): Promise<ChatCompletionResult> {
  const body: Record<string, unknown> = {
    model: options.model,
    messages: options.messages,
    stream: options.stream,
  };
  if (options.temperature !== undefined) body.temperature = options.temperature;
  if (options.maxTokens !== undefined && options.maxTokens > 0) body.max_tokens = options.maxTokens;
  if (options.tools && options.tools.length > 0) {
    body.tools = options.tools;
    // 串联插图与续写要求一次只处理一个工具调用，避免并行调用打乱正文顺序。
    body.parallel_tool_calls = false;
  }

  let response: Response;
  try {
    response = await systemFetch(`${options.connection.baseUrl}/chat/completions`, {
      method: "POST",
      headers: options.connection.jsonHeaders,
      body: JSON.stringify(body),
      signal: options.signal,
    });
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw new Error(describeHttpFailure(error, "无法连接到提供商，请检查网络、API 地址与 CORS 设置"));
  }
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  if (!options.stream) {
    const payload = await response.json() as {
      choices?: Array<{
        message?: {
          content?: unknown;
          reasoning_content?: unknown;
          reasoning?: unknown;
          tool_calls?: unknown;
        };
      }>;
    };
    const message = payload.choices?.[0]?.message;
    const reasoning = extractReasoning(message);
    if (reasoning) options.onReasoningDelta?.(reasoning);
    const text = OpenAIConnection.extractTextContent(message?.content);
    const toolCalls = extractToolCalls(message?.tool_calls);
    if (!text.trim() && toolCalls.length === 0) throw new Error("响应中没有文字内容");
    options.onDelta?.(text);
    return {text, reasoning, toolCalls};
  }
  if (!response.body) throw new Error("提供商未返回流式响应");
  return readSseStream(response.body, options.onDelta, options.onReasoningDelta);
}

/** 提取思维链文本：兼容 reasoning_content（DeepSeek）与 reasoning（OpenRouter）字段。 */
function extractReasoning(source?: {reasoning_content?: unknown; reasoning?: unknown}): string {
  const value = source?.reasoning_content ?? source?.reasoning;
  return typeof value === "string" ? value : "";
}

/** 解析非流式响应中的工具调用数组。 */
function extractToolCalls(value: unknown): ReceivedToolCall[] {
  if (!Array.isArray(value)) return [];
  const calls: ReceivedToolCall[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const fn = record.function && typeof record.function === "object"
        ? record.function as Record<string, unknown>
        : null;
    if (!fn || typeof fn.name !== "string" || !fn.name) continue;
    calls.push({
      id: typeof record.id === "string" && record.id ? record.id : `call-${calls.length}`,
      name: fn.name,
      arguments: typeof fn.arguments === "string" ? fn.arguments : "",
    });
  }
  return calls;
}

interface ToolCallAccumulator {
  id: string;
  name: string;
  arguments: string;
}

async function readSseStream(
    body: ReadableStream<Uint8Array>,
    onDelta?: (fullText: string) => void,
    onReasoningDelta?: (fullReasoning: string) => void
): Promise<ChatCompletionResult> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let reasoning = "";
  /** 流式工具调用按 delta.tool_calls[].index 分桶，分片到达时依次拼接 */
  const toolCallBuckets = new Map<number, ToolCallAccumulator>();
  try {
    for (;;) {
      const {done, value} = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, {stream: true});
      let newline = buffer.indexOf("\n");
      while (newline >= 0) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        newline = buffer.indexOf("\n");
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data) continue;
        if (data === "[DONE]") return {text, reasoning, toolCalls: collectToolCalls(toolCallBuckets)};
        try {
          const payload = JSON.parse(data) as {
            choices?: Array<{
              delta?: {
                content?: unknown;
                reasoning_content?: unknown;
                reasoning?: unknown;
                tool_calls?: unknown;
              };
              message?: {
                content?: unknown;
                reasoning_content?: unknown;
                reasoning?: unknown;
                tool_calls?: unknown;
              };
            }>;
          };
          const choice = payload.choices?.[0];
          const reasoningPiece = extractReasoning(choice?.delta ?? choice?.message);
          if (reasoningPiece) {
            reasoning += reasoningPiece;
            onReasoningDelta?.(reasoning);
          }
          const delta = choice?.delta?.content ?? choice?.message?.content;
          const piece = OpenAIConnection.extractTextContent(delta);
          if (piece) {
            text += piece;
            onDelta?.(text);
          }
          accumulateToolCallDeltas(choice?.delta?.tool_calls, toolCallBuckets);
          absorbNonStreamToolCalls(choice?.message?.tool_calls, toolCallBuckets);
        } catch {
          // 忽略不完整或无法解析的分片
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
  return {text, reasoning, toolCalls: collectToolCalls(toolCallBuckets)};
}

/** 累计流式工具调用分片：id/name 通常只在首片出现，arguments 会在多个分片里逐步变长。 */
function accumulateToolCallDeltas(value: unknown, buckets: Map<number, ToolCallAccumulator>): void {
  if (!Array.isArray(value)) return;
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const fn = record.function && typeof record.function === "object"
        ? record.function as Record<string, unknown>
        : null;
    // 部分兼容实现只在首片给 index，后续分片省略 index，此时把参数续写到最后一个桶
    const index = typeof record.index === "number"
        ? record.index
        : buckets.size > 0 ? lastBucketIndex(buckets) : 0;
    const current = buckets.get(index) ?? {id: "", name: "", arguments: ""};
    if (typeof record.id === "string" && record.id) current.id = record.id;
    if (fn && typeof fn.name === "string" && fn.name) current.name = fn.name;
    if (fn && typeof fn.arguments === "string") current.arguments += fn.arguments;
    buckets.set(index, current);
  }
}

function lastBucketIndex(buckets: Map<number, ToolCallAccumulator>): number {
  let last = 0;
  for (const index of buckets.keys()) {
    if (index > last) last = index;
  }
  return last;
}

/** 部分兼容实现会在流式响应里一次性给出完整 tool_calls，按同样规则并入分桶。 */
function absorbNonStreamToolCalls(value: unknown, buckets: Map<number, ToolCallAccumulator>): void {
  const calls = extractToolCalls(value);
  calls.forEach((call, index) => {
    if (buckets.has(index)) return;
    buckets.set(index, {id: call.id, name: call.name, arguments: call.arguments});
  });
}

function collectToolCalls(buckets: Map<number, ToolCallAccumulator>): ReceivedToolCall[] {
  return [...buckets.entries()]
      .sort(([left], [right]) => left - right)
      .map(([index, bucket], position) => ({
        id: bucket.id || `call-${index}-${position}`,
        name: bucket.name,
        arguments: bucket.arguments,
      }))
      .filter((call) => call.name.length > 0);
}

async function readErrorMessage(response: Response): Promise<string> {
  let detail = "";
  try {
    const text = await response.text();
    try {
      const payload = JSON.parse(text) as {error?: {message?: string}; message?: string};
      detail = payload.error?.message ?? payload.message ?? "";
    } catch {
      detail = text.slice(0, 200);
    }
  } catch (readError) {
    console.warn("读取接口错误响应失败：", readError);
  }
  return `请求失败（HTTP ${response.status}）${detail ? `：${detail}` : ""}`;
}
