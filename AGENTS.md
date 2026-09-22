# GugleNovel 工程约定

对话式 AI 小说生成器：Vue 3 + TypeScript + Vite + Arco Design 前端，Tauri 2（Rust）桌面/Android 壳。

## 常用命令

- `pnpm dev`：Vite 开发服务器（固定端口 1430）
- `pnpm build`：vue-tsc 类型检查 + 生产构建（提交前必须通过）
- `pnpm test`：transport 层与编辑-生成链路逻辑测试
- `pnpm tauri-dev`：桌面壳热更调试
- `pnpm android-build` / `pnpm android-release`：Android debug / release（arm64，签名）APK

## Android 构建环境

- `ANDROID_HOME` / `NDK_HOME` 指向本机 SDK 与 NDK 27.2，`JAVA_HOME` 使用 JDK 17（如 `C:\Program Files\Java\jbr-17`）
- 签名配置在 `src-tauri/gen/android/app/keystore.properties`（与 `*.keystore` 均已 gitignore，不入库）
- `gen/android` 已入库且含定制（系统栏、主题、签名、lint 配置），**不可再执行 `tauri android init` 覆盖**
- **每次构建完成后清理 `src-tauri/target` 路径，只保留构建产物**（APK 位于 `src-tauri/gen/android/app/build/outputs/apk/`，与 target 无关）；`android-build` / `android-release` 脚本已内置 `scripts/clean-target.mjs` 自动清理

## CI 与发布

- `.github/workflows/release.yml`：quality → prepare → android → update-release-notes
- 推送 main 自动出 pre-release（tag `<version>+build.<run>`）；手动发布 GitHub Release 出正式版
- Release notes 由 commit 标题生成（What's Changed + 下载表格），因此提交信息必须遵循 Conventional Commits 中文规范
- 签名 Secrets：`ANDROID_KEYSTORE_BASE64` / `ANDROID_KEYSTORE_PASSWORD` / `ANDROID_KEY_ALIAS` / `ANDROID_KEY_PASSWORD`，缺失时出 `-unsigned` 包

## 代码结构

- `src/domain/`：纯领域模型（消息树、模型/提供商、提示词变量），不依赖 UI
- `src/services/`：transport（OpenAI 兼容 SSE）、export（TXT/EPUB）、markdown（marked + DOMPurify）、storage
- `src/composables/`：按领域聚合，最终合并为单一 viewModel 传给视图；**各 composable 返回的键不得重名**
- `src/views/`、`src/components/`：视图层，移动端优先（底部 Tab 导航、原生滚动、弹窗不超屏宽）

## 行为约定

- 编辑用户指令保存后自动触发生成（编辑即分支）；编辑 AI 正文不触发，视为人工修订
- 思维链（reasoning_content/reasoning）与正文分开存储，灰色展示，输出完毕后折叠
- 流式输出自动跟随滚动，用户上翻超过 80px 暂停跟随
- 开源协议：LGPL-3.0-only
