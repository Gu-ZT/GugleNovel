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
