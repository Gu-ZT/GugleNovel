import {strToU8, zipSync} from "fflate";
import {resolvePath, type Conversation, type MessageNode} from "../../domain/tree";
import {inTauriShell} from "../../composables/fetch";

export type ExportFormat = "txt" | "epub";

/** 导出当前浏览路径上的 AI 正文（assistant 消息），指令消息不进入成书。 */
function exportableChapters(conversation: Conversation): MessageNode[] {
  return resolvePath(conversation)
      .filter((node) => node.role === "assistant" && node.content.trim().length > 0);
}

export function buildTxt(conversation: Conversation): string {
  const chapters = exportableChapters(conversation);
  const body = chapters.map((node) => node.content.trim()).join("\n\n");
  return `${conversation.title}\n\n${body}\n`;
}

function escapeXml(text: string): string {
  return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
}

function chapterXhtml(title: string, content: string): string {
  const paragraphs = content
      .split(/\n{2,}/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean)
      .map((paragraph) => `<p>${escapeXml(paragraph).replace(/\n/g, "<br/>")}</p>`)
      .join("\n");
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh-CN">
<head><title>${escapeXml(title)}</title></head>
<body>
<h2>${escapeXml(title)}</h2>
${paragraphs}
</body>
</html>`;
}

/** 生成最小可用 EPUB 3 包（mimetype 首个且不压缩，其余文件存储式打包）。 */
export function buildEpub(conversation: Conversation): Uint8Array {
  const chapters = exportableChapters(conversation);
  const title = conversation.title || "未命名作品";
  const bookId = `gugle-novel-${conversation.id}`;
  const chapterFiles = chapters.map((_, index) => `chapter-${index + 1}.xhtml`);

  const manifestItems = chapterFiles
      .map((file, index) => `<item id="ch${index + 1}" href="${file}" media-type="application/xhtml+xml"/>`)
      .join("\n    ");
  const spineItems = chapterFiles
      .map((_, index) => `<itemref idref="ch${index + 1}"/>`)
      .join("\n    ");
  const navItems = chapterFiles
      .map((file, index) => `<li><a href="${file}">第 ${index + 1} 节</a></li>`)
      .join("\n      ");

  const files: Record<string, Uint8Array> = {
    "mimetype": strToU8("application/epub+zip"),
    "META-INF/container.xml": strToU8(`<?xml version="1.0" encoding="utf-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`),
    "OEBPS/content.opf": strToU8(`<?xml version="1.0" encoding="utf-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="zh-CN">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">${escapeXml(bookId)}</dc:identifier>
    <dc:title>${escapeXml(title)}</dc:title>
    <dc:language>zh-CN</dc:language>
    <meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/, "Z")}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    ${manifestItems}
  </manifest>
  <spine>
    ${spineItems}
  </spine>
</package>`),
    "OEBPS/nav.xhtml": strToU8(`<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" xml:lang="zh-CN">
<head><title>${escapeXml(title)}</title></head>
<body>
<nav epub:type="toc">
  <h1>${escapeXml(title)}</h1>
  <ol>
      ${navItems}
  </ol>
</nav>
</body>
</html>`),
  };
  chapters.forEach((node, index) => {
    files[`OEBPS/${chapterFiles[index]}`] = strToU8(
        chapterXhtml(`${title} · 第 ${index + 1} 节`, node.content.trim())
    );
  });
  return zipSync(files, {level: 0});
}

export function buildExport(conversation: Conversation, format: ExportFormat): {data: Blob; filename: string} {
  const safeTitle = (conversation.title || "未命名作品").replace(/[\\/:*?"<>|]/g, "_");
  if (format === "epub") {
    return {
      data: new Blob([buildEpub(conversation).slice().buffer as ArrayBuffer], {type: "application/epub+zip"}),
      filename: `${safeTitle}.epub`,
    };
  }
  return {
    data: new Blob([buildTxt(conversation)], {type: "text/plain;charset=utf-8"}),
    filename: `${safeTitle}.txt`,
  };
}

function blobToBase64(data: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.readAsDataURL(data);
  });
}

/** Tauri 壳内：系统保存对话框选位置，经 Rust save_file 命令写盘（WebView 不支持下载与 showSaveFilePicker）。 */
async function saveFileInTauri(filename: string, data: Blob): Promise<boolean> {
  const {save} = await import("@tauri-apps/plugin-dialog");
  const {invoke} = await import("@tauri-apps/api/core");
  const path = await save({defaultPath: filename});
  if (!path) return false;
  await invoke("save_file", {path, base64Data: await blobToBase64(data)});
  return true;
}

/** 保存优先级：Tauri 壳（对话框 + Rust 写盘）→ File System Access API → 浏览器下载。 */
export async function saveFileToDisk(filename: string, data: Blob): Promise<boolean> {
  if (inTauriShell) return saveFileInTauri(filename, data);
  const picker = (window as unknown as {
    showSaveFilePicker?: (options: {suggestedName: string}) => Promise<{
      createWritable(): Promise<{write(data: Blob): Promise<void>; close(): Promise<void>}>;
    }>;
  }).showSaveFilePicker;
  if (typeof picker === "function") {
    try {
      const handle = await picker({suggestedName: filename});
      const writable = await handle.createWritable();
      await writable.write(data);
      await writable.close();
      return true;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return false;
      // 继续走下载降级
    }
  }
  const url = URL.createObjectURL(data);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
