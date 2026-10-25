/* eslint-disable no-console */
// 导出验证：TXT 标记插图位置、EPUB 内嵌插图并补齐 manifest、图片缺失时明确失败。
const {unzipSync, strFromU8} = await import(new URL("./fflate-bundle.mjs", import.meta.url).href);

globalThis.window = globalThis;

const imageRecords = new Map();
const requestedKeys = [];

/** 按 id 返回预设图片；缺失的 id 返回 undefined，用于验证导出报错。 */
function makeIndexedDB() {
  function makeRequest(perform) {
    const request = {result: undefined, onsuccess: null, onerror: null};
    setTimeout(() => {
      request.result = perform();
      request.onsuccess?.();
    }, 0);
    return request;
  }
  function makeTransaction() {
    const transaction = {onerror: null, onabort: null, error: null};
    const objectStore = {
      get: (key) => makeRequest(() => {
        requestedKeys.push(key);
        return imageRecords.get(key);
      }),
      put: (record) => makeRequest(() => {
        imageRecords.set(record.id, record);
        return record.id;
      }),
      delete: (key) => makeRequest(() => {
        imageRecords.delete(key);
        return undefined;
      }),
    };
    transaction.objectStore = () => objectStore;
    let completeHandler = null;
    Object.defineProperty(transaction, "oncomplete", {
      configurable: true,
      get: () => completeHandler,
      set: (handler) => {
        completeHandler = handler;
        setTimeout(() => handler?.(), 1);
      },
    });
    return transaction;
  }
  return {
    open() {
      const request = {result: null, onsuccess: null, onerror: null};
      setImmediate(() => {
        request.result = {
          objectStoreNames: {contains: () => true},
          transaction: () => makeTransaction(),
        };
        request.onsuccess?.();
      });
      return request;
    },
  };
}

globalThis.indexedDB = makeIndexedDB();

const exportService = await import(new URL("./export-bundle.mjs", import.meta.url).href);

let failures = 0;
function check(name, ok) {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}`);
  if (!ok) failures++;
}

const PNG_BYTES = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);
imageRecords.set("img-1", {id: "img-1", blob: new Blob([PNG_BYTES], {type: "image/png"}), mimeType: "image/png", createdAt: 1});

function makeConversation(nodes, activeLeafId) {
  return {
    id: "conv-1",
    title: "测试作品",
    createdAt: 1,
    systemPrompt: "",
    variables: {},
    nodes,
    rootIds: ["u1"],
    activeLeafId,
  };
}

const conversation = makeConversation({
  u1: {id: "u1", parentId: null, childrenIds: ["a1"], role: "user", segments: [{type: "text", text: "写第一章"}], createdAt: 1},
  a1: {
    id: "a1", parentId: "u1", childrenIds: [], role: "assistant", createdAt: 2,
    segments: [
      {type: "text", text: "开篇正文\n\n第二段正文"},
      {type: "image", imageId: "img-1", prompt: "雨夜街灯"},
      {type: "text", text: "插图之后的正文"},
    ],
  },
}, "a1");

// TXT
const txt = exportService.buildTxt(conversation);
check("TXT 不含写作指令", !txt.includes("写第一章"));
check("TXT 按段落保留正文", txt.includes("第二段正文") && txt.includes("插图之后的正文"));
check("TXT 在图片位置写入占位", txt.includes("[插图：雨夜街灯]"));
check("TXT 占位在前后正文之间", txt.indexOf("第二段正文") < txt.indexOf("[插图：雨夜街灯]")
  && txt.indexOf("[插图：雨夜街灯]") < txt.indexOf("插图之后的正文"));

// EPUB
const epubBytes = await exportService.buildEpub(conversation);
const files = unzipSync(epubBytes);
const names = Object.keys(files);
check("EPUB 包含 mimetype", names.includes("mimetype"));
check("EPUB mimetype 内容正确", strFromU8(files.mimetype) === "application/epub+zip");
check("EPUB 包含容器描述", names.includes("META-INF/container.xml"));
check("EPUB 包含章节", names.includes("OEBPS/chapter-1.xhtml"));
check("EPUB 包含嵌入的图片", names.some((name) => name.startsWith("OEBPS/images/") && name.endsWith(".png")));
check("EPUB 包含样式", names.includes("OEBPS/style.css"));

const imageName = names.find((name) => name.startsWith("OEBPS/images/"));
const imageBytes = files[imageName];
check("EPUB 图片字节与仓库一致", imageBytes.length === PNG_BYTES.length
  && imageBytes.every((byte, index) => byte === PNG_BYTES[index]));

const opf = strFromU8(files["OEBPS/content.opf"]);
check("EPUB manifest 声明图片", opf.includes(`href="images/`) && opf.includes("media-type=\"image/png\""));
check("EPUB manifest 声明样式", opf.includes("href=\"style.css\"") && opf.includes("media-type=\"text/css\""));

const chapter = strFromU8(files["OEBPS/chapter-1.xhtml"]);
check("EPUB 章节引用图片", chapter.includes("<img src=\"images/"));
check("EPUB 章节包含插图描述", chapter.includes("雨夜街灯"));
check("EPUB 图片位于前后正文之间", chapter.indexOf("第二段正文") < chapter.indexOf("<img ")
  && chapter.indexOf("<img ") < chapter.indexOf("插图之后的正文"));
check("EPUB 章节引用了样式表", chapter.includes("<link rel=\"stylesheet\""));

// 图片缺失时 buildEpub 必须抛出错误，禁止产出缺图电子书
const missingConversation = makeConversation({
  u1: {id: "u1", parentId: null, childrenIds: ["a1"], role: "user", segments: [{type: "text", text: "写"}], createdAt: 1},
  a1: {
    id: "a1", parentId: "u1", childrenIds: [], role: "assistant", createdAt: 2,
    segments: [
      {type: "text", text: "正文"},
      {type: "image", imageId: "img-missing", prompt: "丢失的图"},
    ],
  },
}, "a1");

let missingError = "";
try {
  await exportService.buildEpub(missingConversation);
} catch (error) {
  missingError = error.message;
}
check("图片缺失时导出失败", missingError.includes("无法读取的插图"));

// 纯插图消息（只有图片、没有文字）也必须进入导出
const imageOnlyConversation = makeConversation({
  u1: {id: "u1", parentId: null, childrenIds: ["a1"], role: "user", segments: [{type: "text", text: "写"}], createdAt: 1},
  a1: {
    id: "a1", parentId: "u1", childrenIds: [], role: "assistant", createdAt: 2,
    segments: [{type: "image", imageId: "img-1", prompt: "纯插图"}],
  },
}, "a1");
const imageOnlyTxt = exportService.buildTxt(imageOnlyConversation);
check("TXT 保留纯插图消息", imageOnlyTxt.includes("[插图：纯插图]"));
const imageOnlyFiles = unzipSync(await exportService.buildEpub(imageOnlyConversation));
check(
  "EPUB 保留纯插图消息",
  Object.keys(imageOnlyFiles).some((name) => name.startsWith("OEBPS/images/")),
);

// JPEG 与 WebP 必须映射为各自真实的 media-type
imageRecords.set("img-jpeg", {
  id: "img-jpeg",
  blob: new Blob([Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])], {type: "image/jpeg"}),
  mimeType: "image/jpeg",
  createdAt: 1,
});
const jpegConversation = makeConversation({
  u1: {id: "u1", parentId: null, childrenIds: ["a1"], role: "user", segments: [{type: "text", text: "写"}], createdAt: 1},
  a1: {
    id: "a1", parentId: "u1", childrenIds: [], role: "assistant", createdAt: 2,
    segments: [{type: "text", text: "正文"}, {type: "image", imageId: "img-jpeg", prompt: "JPEG 图"}],
  },
}, "a1");
const jpegFiles = unzipSync(await exportService.buildEpub(jpegConversation));
const jpegName = Object.keys(jpegFiles).find((name) => name.startsWith("OEBPS/images/"));
check("JPEG 使用 .jpg 扩展名", jpegName?.endsWith(".jpg") === true);
check(
  "JPEG 在 manifest 中声明为 image/jpeg",
  strFromU8(jpegFiles["OEBPS/content.opf"]).includes("media-type=\"image/jpeg\""),
);

// 未知图片格式必须明确失败，禁止写出与实际字节不符的 media-type
imageRecords.set("img-unknown", {
  id: "img-unknown",
  blob: new Blob([Uint8Array.from([1, 2, 3])], {type: "application/octet-stream"}),
  mimeType: "application/octet-stream",
  createdAt: 1,
});
const unsupportedConversation = makeConversation({
  u1: {id: "u1", parentId: null, childrenIds: ["a1"], role: "user", segments: [{type: "text", text: "写"}], createdAt: 1},
  a1: {
    id: "a1", parentId: "u1", childrenIds: [], role: "assistant", createdAt: 2,
    segments: [{type: "text", text: "正文"}, {type: "image", imageId: "img-unknown", prompt: "未知格式"}],
  },
}, "a1");
let unsupportedError = "";
try {
  await exportService.buildEpub(unsupportedConversation);
} catch (error) {
  unsupportedError = error.message;
}
check("未知图片格式导出失败", unsupportedError.includes("不支持的插图格式"));

// 同一张图被多个分支引用时只打包一次
const sharedConversation = makeConversation({
  u1: {id: "u1", parentId: null, childrenIds: ["a1"], role: "user", segments: [{type: "text", text: "写"}], createdAt: 1},
  a1: {
    id: "a1", parentId: "u1", childrenIds: [], role: "assistant", createdAt: 2,
    segments: [
      {type: "text", text: "一"},
      {type: "image", imageId: "img-1", prompt: "共用图"},
      {type: "text", text: "二"},
      {type: "image", imageId: "img-1", prompt: "共用图"},
    ],
  },
}, "a1");
const sharedFiles = unzipSync(await exportService.buildEpub(sharedConversation));
const sharedImages = Object.keys(sharedFiles).filter((name) => name.startsWith("OEBPS/images/"));
check("同一图片只打包一次", sharedImages.length === 1);

console.log(failures === 0 ? "ALL TESTS PASSED" : `${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
