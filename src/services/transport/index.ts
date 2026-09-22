import {OpenAIConnection} from "../../api";
import {systemFetch} from "../../composables/fetch";

export type ChatRole = "system" | "user" | "assistant";

export interface ChatRequestMessage {
  role: ChatRole;
  content: string;
}

export interface ChatCompletionOptions {
  connection: OpenAIConnection;
  model: string;
  messages: ChatRequestMessage[];
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

export async function requestChatCompletion(options: ChatCompletionOptions): Promise<string> {
  const body: Record<string, unknown> = {
    model: options.model,
    messages: options.messages,
    stream: options.stream,
  };
  if (options.temperature !== undefined) body.temperature = options.temperature;
  if (options.maxTokens !== undefined && options.maxTokens > 0) body.max_tokens = options.maxTokens;

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
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
        `无法连接到提供商，请检查网络、API 地址与 CORS 设置（${detail}）`
    );
  }
  if (!response.ok) {
    throw new Error(await readErrorMessage(response));
  }
  if (!options.stream) {
    const payload = await response.json() as {
      choices?: Array<{message?: {content?: unknown; reasoning_content?: unknown; reasoning?: unknown}}>;
    };
    const message = payload.choices?.[0]?.message;
    const reasoning = extractReasoning(message);
    if (reasoning) options.onReasoningDelta?.(reasoning);
    const text = OpenAIConnection.extractTextContent(message?.content);
    if (!text.trim()) throw new Error("响应中没有文字内容");
    options.onDelta?.(text);
    return text;
  }
  if (!response.body) throw new Error("提供商未返回流式响应");
  return readSseStream(response.body, options.onDelta, options.onReasoningDelta);
}

/** 提取思维链文本：兼容 reasoning_content（DeepSeek）与 reasoning（OpenRouter）字段。 */
function extractReasoning(source?: {reasoning_content?: unknown; reasoning?: unknown}): string {
  const value = source?.reasoning_content ?? source?.reasoning;
  return typeof value === "string" ? value : "";
}

async function readSseStream(
    body: ReadableStream<Uint8Array>,
    onDelta?: (fullText: string) => void,
    onReasoningDelta?: (fullReasoning: string) => void
): Promise<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  let reasoning = "";
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
        if (data === "[DONE]") return text;
        try {
          const payload = JSON.parse(data) as {
            choices?: Array<{
              delta?: {content?: unknown; reasoning_content?: unknown; reasoning?: unknown};
              message?: {content?: unknown; reasoning_content?: unknown; reasoning?: unknown};
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
        } catch {
          // 忽略不完整或无法解析的分片
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
  return text;
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
  } catch {
    // 忽略读取错误体失败
  }
  return `请求失败（HTTP ${response.status}）${detail ? `：${detail}` : ""}`;
}
