<div align="center">

<img src="src-tauri/icons/icon.png" width="256" height="256" alt="GugleNovel icon">

# GugleNovel

**A conversational AI novel generator with branching message trees, streaming generation, and TXT/EPUB export — built with Vue 3 and Tauri 2 for mobile and desktop.**

English | [简体中文](README.zh_CN.md)

</div>

## Features

- **Configurable providers and models**: multiple OpenAI-compatible providers, per-model capabilities (streaming / reasoning / JSON), input context length, and max output tokens.
- **System prompt presets and variables**: reusable prompt presets with per-conversation variables such as `{{genre}}` and `{{style}}`.
- **Branching conversations**: every conversation is a message tree — editing a message creates a branch, assistant replies can be regenerated as siblings, and a branch tree panel lets you focus any node.
- **Real streaming generation**: OpenAI-compatible SSE with abort support, context-aware message trimming, and automatic conversation titles.
- **Export**: save the active path as TXT or EPUB, through the browser (File System Access API / download) or the Tauri shell (native save dialog).
- **Tauri 2 shell**: Android and desktop. HTTP requests go through `plugin-http`, bypassing WebView CORS entirely; the UI avoids system bars, adapts to the IME, and keeps modals within the viewport.

## Tech Stack

Vue 3 + TypeScript + Vite · Arco Design Vue · vue-router (hash) · fflate (EPUB) · Tauri 2 (Rust) · pnpm

## Development

```bash
pnpm install
pnpm dev              # Vite dev server on http://localhost:1430
pnpm build            # vue-tsc type check + production build
pnpm test:transport   # transport layer tests (streaming / errors / abort / auth)
pnpm tauri-dev        # desktop shell with hot reload
```

## Android

Prerequisites: JDK 17, Android SDK (platform 36, build-tools) + NDK 27.2 (`ANDROID_HOME`/`NDK_HOME`), and the Rust target `aarch64-linux-android`.

```bash
pnpm android-dev       # deploy to a connected device/emulator with hot reload
pnpm android-build     # debug APK (all ABIs)
pnpm android-release   # signed release APK, arm64 only
```

Release signing reads `src-tauri/gen/android/app/keystore.properties` (gitignored). When the referenced keystore file exists, Gradle signs the release APK automatically; otherwise an unsigned APK is produced.

## CI & Release

`.github/workflows/release.yml` runs quality checks (frontend build + `cargo check`), then builds the Android arm64 APK and publishes it to a GitHub Release:

- Pushes to `main` create a prerelease tagged `<version>+build.<run>`.
- Publishing a GitHub Release manually produces a stable build from that tag.
- Release notes are generated from commit subjects since the previous tag ("What's Changed"), a Full Changelog compare link, and a download table.

Optional signing secrets: `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS`, `ANDROID_KEY_PASSWORD`. Without them the APK is uploaded unsigned (file name carries an `-unsigned` suffix).

## License

[LGPL-3.0-only](LICENSE)
