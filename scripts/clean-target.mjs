import {rm} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import path from "node:path";

// 每次 Android 构建完成后清理 Rust 构建缓存（体积可达数 GB）；
// APK 产物位于 gen/android/app/build/outputs，不受影响。
const target = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src-tauri", "target");
await rm(target, {recursive: true, force: true});
console.log("src-tauri/target 已清理（APK 产物保留在 gen/android/app/build/outputs）");
