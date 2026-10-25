import {OpenAIConnection} from "../../api";
import {systemFetch} from "../../composables/fetch";
import type {ResolvedModel} from "../../domain/models";
import {isAbortError} from "../transport";

export interface ImageGenerationOptions {
  model: ResolvedModel;
  prompt: string;
  signal: AbortSignal;
}

export interface GeneratedImage {
  blob: Blob;
  mimeType: string;
}

interface ImageGenerationPayload {
  data?: Array<{b64_json?: unknown; url?: unknown}>;
  error?: {message?: string};
}

/**
 * 调用 OpenAI 兼容的图像生成接口，返回可直接写入 IndexedDB 的图片。
 * 提供商可能返回 base64 或临时 URL，两种形态都在这里转成本地 Blob，
 * 避免作品依赖会过期的外链。
 */
export async function generateIllustration(options: ImageGenerationOptions): Promise<GeneratedImage> {
  const connection = new OpenAIConnection(options.model.provider.endpoint, options.model.provider.apiKey);
  let response: Response;
  try {
    response = await systemFetch(`${connection.baseUrl}/images/generations`, {
      method: "POST",
      headers: connection.jsonHeaders,
      body: JSON.stringify({model: options.model.model.id, prompt: options.prompt, n: 1}),
      signal: options.signal,
    });
  } catch (error) {
    if (isAbortError(error)) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`无法连接到图像模型，请检查网络与 API 地址（${detail}）`);
  }
  if (!response.ok) throw new Error(await readImageError(response));
  const payload = await response.json() as ImageGenerationPayload;
  const item = payload.data?.[0];
  if (!item) throw new Error("图像模型未返回图片");
  if (typeof item.b64_json === "string" && item.b64_json.trim()) {
    return decodeBase64Image(item.b64_json.trim());
  }
  if (typeof item.url === "string" && item.url.trim()) {
    return downloadImage(item.url.trim(), options.signal);
  }
  throw new Error("图像模型返回的图片数据无法识别");
}

function decodeBase64Image(encoded: string): GeneratedImage {
  let binary: string;
  try {
    binary = atob(encoded);
  } catch {
    throw new Error("图像模型返回的 base64 数据无效");
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }
  const mimeType = detectImageType(bytes);
  return {blob: new Blob([bytes], {type: mimeType}), mimeType};
}

/** 按文件头判断格式；多数提供商返回 png，部分中转返回 jpeg 或 webp。 */
function detectImageType(bytes: Uint8Array): string {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return "image/png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return "image/jpeg";
  }
  if (bytes.length >= 12 && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50) {
    return "image/webp";
  }
  return "image/png";
}

/** 下载临时图片链接；不向图片域名转发 API Key，避免密钥泄漏到第三方存储。 */
async function downloadImage(url: string, signal: AbortSignal): Promise<GeneratedImage> {
  let response: Response;
  try {
    response = await systemFetch(url, {method: "GET", signal});
  } catch (error) {
    if (isAbortError(error)) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`下载生成的图片失败（${detail}）`);
  }
  if (!response.ok) throw new Error(`下载生成的图片失败（HTTP ${response.status}）`);
  const blob = await response.blob();
  if (blob.size === 0) throw new Error("图像模型返回了空图片");
  const mimeType = blob.type.startsWith("image/") ? blob.type : "image/png";
  return {blob: blob.type === mimeType ? blob : new Blob([blob], {type: mimeType}), mimeType};
}

async function readImageError(response: Response): Promise<string> {
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
    console.warn("读取图像接口错误响应失败：", readError);
  }
  return `插图生成失败（HTTP ${response.status}）${detail ? `：${detail}` : ""}`;
}
