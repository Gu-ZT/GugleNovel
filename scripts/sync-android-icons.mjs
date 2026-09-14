import {cp, mkdir, access} from "node:fs/promises";
import {fileURLToPath} from "node:url";
import path from "node:path";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = path.join(projectRoot, "src-tauri", "icons", "android");
const resourceDir = path.join(projectRoot, "src-tauri", "gen", "android", "app", "src", "main", "res");

try {
  await access(sourceDir);
} catch {
  console.log("No android icons to synchronize yet.");
  process.exit(0);
}

await mkdir(resourceDir, {recursive: true});
await cp(sourceDir, resourceDir, {recursive: true, force: true});

console.log("Android launcher icons synchronized.");
