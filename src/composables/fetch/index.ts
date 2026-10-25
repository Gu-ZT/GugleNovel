import {fetch as tauriHttpFetch, type ClientOptions} from "@tauri-apps/plugin-http";
import {isTauri} from "@tauri-apps/api/core";

/**
 * 统一网络入口：Tauri 壳内走 plugin-http（绕过 WebView CORS 限制），
 * 纯浏览器环境回退到原生 fetch（要求提供商允许 CORS）。
 */
export type SystemFetch = (input: string, init?: RequestInit & ClientOptions) => Promise<Response>;

export const inTauriShell: boolean = isTauri();

export const systemFetch: SystemFetch = (input, init) =>
    inTauriShell ? tauriHttpFetch(input, init) : globalThis.fetch(input, init);

/**
 * 判断错误是否来自 Tauri HTTP 作用域拦截。
 * 该错误源于客户端打包时的 capability 配置，与网络状况和接口地址无关，
 * 调用方需要据此给出重新构建客户端的提示。
 */
export function isHttpScopeDenied(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("url not allowed on the configured scope");
}

/** 作用域拦截时生成可操作的提示，其余错误保持调用方文案。 */
export function describeHttpFailure(error: unknown, fallback: string): string {
  if (isHttpScopeDenied(error)) {
    return `应用未允许访问该接口地址，请升级到包含 http 与 https 通配端口授权的客户端（${String(
        error instanceof Error ? error.message : error
    )}）`;
  }
  const detail = error instanceof Error ? error.message : String(error);
  return `${fallback}（${detail}）`;
}
