import {strToU8, zipSync} from "fflate";
import {resolvePath, type Conversation, type ImageSegment, type MessageNode} from "../../domain/tree";
import {inTauriShell} from "../../composables/fetch";
import {loadImage} from "../image/store";

export type ExportFormat = "txt" | "epub";

/** 导出当前浏览路径上的 AI 正文（assistant 消息），指令消息不进入成书。 */
function exportableChapters(conversation: Conversation): MessageNode[] {
  return resolvePath(conversation).filter((node) => {
    if (node.role !== "assistant") return false;
    return node.segments.some((segment) => segment.type === "image"
        ? segment.status === "ready" && Boolean(segment.imageId)
        : segment.text.trim().length > 0);
  });
}

/** 正文中的插图占位文本，TXT 用它标记图片位置；未成功的插图不进入成书。 */
function imagePlaceholder(segment: ImageSegment): string {
  if (segment.status !== "ready") return "";
  return segment.prompt ? `[插图：${segment.prompt}]` : "[插图]";
}

export function buildTxt(conversation: Conversation): string {
  const chapters = exportableChapters(conversation);
  const body = chapters
      .map((node) => node.segments
          .map((segment) => segment.type === "text"
              ? segment.text.trim()
              : imagePlaceholder(segment))
          .filter(Boolean)
          .join("\n\n"))
      .join("\n\n");
  return `${conversation.title}\n\n${body}\n`;
}

function escapeXml(text: string): string {
  return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
}

function paragraphsHtml(content: string): string {
  return content
      .split(/\n{2,}/)
      .map((paragraph) => paragraph.trim())
      .filter(Boolean)
      .map((paragraph) => `<p>${escapeXml(paragraph).replace(/\n/g, "<br/>")}</p>`)
      .join("\n");
}

function chapterXhtml(title: string, bodyHtml: string): string {
  return `<?xml version="1.0" encoding="utf-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xml:lang="zh-CN">
<head><title>${escapeXml(title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body>
<h2>${escapeXml(title)}</h2>
${bodyHtml}
</body>
</html>`;
}

/** 扩展名与 media-type 对应关系，EPUB manifest 需要逐项声明。 */
function imageFileMeta(mimeType: string): {extension: string; mediaType: string} {
  if (mimeType === "image/jpeg") return {extension: "jpg", mediaType: "image/jpeg"};
  if (mimeType === "image/webp") return {extension: "webp", mediaType: "image/webp"};
  if (mimeType === "image/gif") return {extension: "gif", mediaType: "image/gif"};
  if (mimeType === "image/png") return {extension: "png", mediaType: "image/png"};
  // 未知格式必须明确失败，禁止用错误的 media-type 写出阅读器无法渲染的图片
  throw new Error(`不支持的插图格式：${mimeType || "未知"}`);
}

interface ChapterImage {
  imageId: string;
  fileName: string;
  mediaType: string;
  bytes: Uint8Array;
}

/**
 * 生成最小可用 EPUB 3 包（mimetype 首个且不压缩，其余文件存储式打包）。
 * 插图从本地仓库读取后与正文一起打包；任一图片缺失时终止导出，
 * 避免产出正文有图位但没有图片的电子书。
 */
export async function buildEpub(conversation: Conversation): Promise<Uint8Array> {
  const chapters = exportableChapters(conversation);
  const title = conversation.title || "未命名作品";
  const bookId = `gugle-novel-${conversation.id}`;
  const chapterFiles = chapters.map((_, index) => `chapter-${index + 1}.xhtml`);
  const images = new Map<string, ChapterImage>();
  const chapterBodies: string[] = [];

  for (const [chapterIndex, node] of chapters.entries()) {
    const parts: string[] = [];
    for (const segment of node.segments) {
      if (segment.type === "text") {
        const html = paragraphsHtml(segment.text.trim());
        if (html) parts.push(html);
        continue;
      }
      // 未成功的插图不写入成书，避免出现有图位没有图片的版面
      if (segment.status !== "ready") continue;
      // 文件名按导出顺序分配，避免不同图片 id 生成相同文件名而互相覆盖
      const stored = images.get(segment.imageId)
          ?? await loadStoredImage(segment.imageId, images.size + 1);
      images.set(segment.imageId, stored);
      parts.push(`<div class="illustration"><img src="images/${stored.fileName}" alt="${escapeXml(segment.prompt)}"/></div>`);
    }
    const chapterTitle = `${title} · 第 ${chapterIndex + 1} 节`;
    chapterBodies.push(chapterXhtml(chapterTitle, parts.join("\n")));
  }

  const imageItems = [...images.values()];
  const manifestItems = [
    `<item id="css" href="style.css" media-type="text/css"/>`,
    ...chapterFiles.map((file, index) => `<item id="ch${index + 1}" href="${file}" media-type="application/xhtml+xml"/>`),
    ...imageItems.map((image, index) => `<item id="img${index + 1}" href="images/${image.fileName}" media-type="${image.mediaType}"/>`),
  ].join("\n    ");
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
<head><title>${escapeXml(title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body>
<nav epub:type="toc">
  <h1>${escapeXml(title)}</h1>
  <ol>
      ${navItems}
  </ol>
</nav>
</body>
</html>`),
    "OEBPS/style.css": strToU8(`.illustration { margin: 1em 0; text-align: center; }
.illustration img { max-width: 100%; height: auto; }`),
  };
  chapters.forEach((_, index) => {
    files[`OEBPS/${chapterFiles[index]}`] = strToU8(chapterBodies[index]);
  });
  for (const image of imageItems) {
    files[`OEBPS/images/${image.fileName}`] = image.bytes;
  }
  return zipSync(files, {level: 0});
}

/** index 为本次导出中的序号，保证不同图片得到唯一文件名。 */
async function loadStoredImage(imageId: string, index: number): Promise<ChapterImage> {
  const stored = await loadImage(imageId);
  if (!stored) throw new Error("作品中存在无法读取的插图，请删除该插图后重新导出");
  const meta = imageFileMeta(stored.mimeType);
  const bytes = new Uint8Array(await stored.blob.arrayBuffer());
  return {
    imageId,
    fileName: `image-${index}.${meta.extension}`,
    mediaType: meta.mediaType,
    bytes,
  };
}

export async function buildExport(
    conversation: Conversation,
    format: ExportFormat
): Promise<{data: Blob; filename: string}> {
  const safeTitle = (conversation.title || "未命名作品").replace(/[\\/:*?"<>|]/g, "_");
  if (format === "epub") {
    const bytes = await buildEpub(conversation);
    return {
      data: new Blob([bytes.slice().buffer as ArrayBuffer], {type: "application/epub+zip"}),
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
