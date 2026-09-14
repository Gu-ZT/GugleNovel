<div align="center">

<img src="src-tauri/icons/icon.png" width="256" height="256" alt="GugleNovel 图标">

# GugleNovel

**对话式 AI 小说生成器：消息树分支对话、流式生成与 TXT/EPUB 导出，基于 Vue 3 + Tauri 2，面向手机与桌面。**

[English](README.md) | 简体中文

</div>

## 功能特性

- **可配置的提供商与模型**：支持多个 OpenAI 兼容提供商，可按模型配置能力（流式 / 推理 / JSON）、输入上下文长度与最大输出 Token 数。
- **系统提示词预设与变量**：可复用的提示词预设，支持会话级变量（如 `{{genre}}`、`{{style}}`）。
- **分支对话**：每个会话都是一棵消息树——编辑消息即产生分支，助手回复可重新生成并存为兄弟节点，分支树面板可定位任意节点。
- **真实流式生成**：OpenAI 兼容 SSE 流式请求，支持中断、按上下文裁剪消息与自动生成会话标题。
- **导出**：将当前路径导出为 TXT 或 EPUB，浏览器走 File System Access API / 下载，Tauri 壳走系统保存对话框。
- **Tauri 2 壳**：Android 与桌面。HTTP 请求经由 `plugin-http` 发出，彻底绕开 WebView CORS；界面避让系统栏、自适应输入法弹出、弹窗宽度不超出视口。

## 技术栈

Vue 3 + TypeScript + Vite · Arco Design Vue · vue-router（hash 模式）· fflate（EPUB 打包）· Tauri 2（Rust）· pnpm

## 开发

```bash
pnpm install
pnpm dev              # Vite 开发服务器 http://localhost:1430
pnpm build            # vue-tsc 类型检查 + 生产构建
pnpm test:transport   # transport 层测试（流式 / 错误 / 中断 / 鉴权）
pnpm tauri-dev        # 桌面壳热更调试
```

## Android

前置条件：JDK 17、Android SDK（platform 36、build-tools）+ NDK 27.2（`ANDROID_HOME`/`NDK_HOME`），以及 Rust 目标 `aarch64-linux-android`。

```bash
pnpm android-dev       # 部署到已连接设备/模拟器，热更新调试
pnpm android-build     # debug APK（全 ABI）
pnpm android-release   # 已签名的 release APK，仅 arm64
```

Release 签名读取 `src-tauri/gen/android/app/keystore.properties`（已 gitignore）。引用的 keystore 文件存在时 Gradle 自动签名 release APK，否则产出未签名 APK。

## CI 与发布

`.github/workflows/release.yml` 先跑质量检查（前端构建 + `cargo check`），再构建 Android arm64 APK 并发布到 GitHub Release：

- 推送到 `main` 自动创建 tag 为 `<版本号>+build.<run号>` 的 pre-release。
- 手动发布 GitHub Release 则以该 tag 产出正式版。
- Release notes 自动从上一 tag 以来的 commit 标题生成 "What's Changed" 列表、Full Changelog 对比链接与下载表格。

可选签名 Secrets：`ANDROID_KEYSTORE_BASE64`、`ANDROID_KEYSTORE_PASSWORD`、`ANDROID_KEY_ALIAS`、`ANDROID_KEY_PASSWORD`。未配置时上传未签名 APK（文件名带 `-unsigned` 后缀）。

## 开源协议

[LGPL-3.0-only](LICENSE)
