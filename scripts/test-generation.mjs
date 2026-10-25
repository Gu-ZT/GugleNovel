/* eslint-disable no-console */
// 生成循环验证：正文 → 工具调用 → 生图 → 工具结果 → 续写的完整顺序，
// 以及段落频率拒绝、生图失败、调用上限、插图降级与停止中断。
import http from "node:http";

globalThis.window = globalThis;

// IndexedDB 内存桩：只实现 store.ts 用到的最小接口
const imageStore = new Map();

function createFakeIndexedDB() {
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
      put: (record) => makeRequest(() => {
        imageStore.set(record.id, record);
        return record.id;
      }),
      get: (key) => makeRequest(() => imageStore.get(key)),
      delete: (key) => makeRequest(() => {
        imageStore.delete(key);
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

globalThis.indexedDB = createFakeIndexedDB();

const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const chatRequests = [];
const imageRequests = [];
/** 服务端按请求序号返回预设脚本，模拟主模型多轮行为 */
let chatScript = [];

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type, authorization");
  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }
  let raw = "";
  req.on("data", (chunk) => raw += chunk);
  req.on("end", () => {
    const body = JSON.parse(raw);
    if (req.url?.endsWith("/images/generations")) {
      imageRequests.push(body);
      res.writeHead(200, {"Content-Type": "application/json"});
      res.end(JSON.stringify({data: [{b64_json: TINY_PNG_BASE64}]}));
      return;
    }
    if (!req.url?.endsWith("/chat/completions")) {
      res.writeHead(404).end();
      return;
    }
    chatRequests.push(body);
    const step = chatScript.shift() ?? {text: "结束。", toolCalls: []};
    if (step.error) {
      res.writeHead(500, {"Content-Type": "application/json"});
      res.end(JSON.stringify({error: {message: step.error}}));
      return;
    }
    res.writeHead(200, {"Content-Type": "application/json"});
    res.end(JSON.stringify({
      choices: [{
        message: {
          content: step.text,
          ...(step.toolCalls?.length ? {
            tool_calls: step.toolCalls.map((call, index) => ({
              id: call.id ?? `call_${index}`,
              type: "function",
              function: {name: call.name, arguments: call.arguments},
            })),
          } : {}),
        },
      }],
    }));
  });
});

await new Promise((resolve) => server.listen(8767, "127.0.0.1", resolve));

const generation = await import(new URL("./generation-bundle.mjs", import.meta.url).href);
const tree = await import(new URL("./domain-tree-bundle.mjs", import.meta.url).href);
const prompts = await import(new URL("./domain-prompts-bundle.mjs", import.meta.url).href);

let failures = 0;
function check(name, ok) {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}`);
  if (!ok) failures++;
}

const textModel = {
  provider: {id: "p1", name: "测试商", endpoint: "http://127.0.0.1:8767", apiKey: "k"},
  model: {
    id: "text-model",
    kind: "text",
    capabilities: ["text", "tools"],
    supportsNsfw: false,
    contextLength: 128000,
    maxOutputTokens: 4096,
  },
};
const imageModel = {
  provider: {id: "p1", name: "测试商", endpoint: "http://127.0.0.1:8767", apiKey: "k"},
  model: {id: "image-model", kind: "image", supportsNsfw: false},
};

/** 构造生成参数；illustration 内的字段覆盖插图配置，model 覆盖主模型。 */
function makeOptions(overrides = {}) {
  const {illustration = {}, model = textModel} = overrides;
  return {
    model,
    // 传输层只依赖 baseUrl 与 jsonHeaders，测试直接给出连接对象
    connection: {
      baseUrl: "http://127.0.0.1:8767/v1",
      jsonHeaders: {"Content-Type": "application/json"},
    },
    temperature: 0.9,
    maxTokens: 1024,
    stream: false,
    systemPrompt: "你是小说作家",
    illustration: {
      enabled: true,
      contentMode: "sfw",
      paragraphInterval: 2,
      systemPrompt: "插图规则",
      imageModel,
      ...illustration,
    },
  };
}

function makeCallbacks(target) {
  const events = [];
  return {
    events,
    onTextDelta: (delta) => {
      events.push(["text", delta]);
      tree.appendTextSegment(target, delta);
    },
    onReasoning: () => {},
    onIllustrationStart: () => events.push(["illustration-start"]),
    onIllustration: (imageId, prompt) => {
      events.push(["illustration", prompt]);
      tree.appendImageSegment(target, imageId, prompt);
    },
    onIllustrationFailed: (reason) => events.push(["illustration-failed", reason]),
  };
}

function newTarget(id) {
  return {id, parentId: null, childrenIds: [], role: "assistant", segments: [], createdAt: 1};
}

/** 统一入口：系统提示词由 composeSystemPrompt 组装后随请求发送，与生产调用方一致。 */
async function run(options, callbacks, {userText = "写", signal = new AbortController().signal} = {}) {
  const system = generation.composeSystemPrompt(options);
  const messages = system.trim()
      ? [{role: "system", content: system}, {role: "user", content: userText}]
      : [{role: "user", content: userText}];
  return generation.runGeneration(options, messages, signal, callbacks);
}

function reset() {
  chatRequests.length = 0;
  imageRequests.length = 0;
  imageStore.clear();
  chatScript = [];
}

const illustrationPromptText = "插图规则";

// 场景 1：正文 → 工具调用 → 生图 → 工具结果 → 续写
reset();
chatScript = [
  {text: "第一段\n\n第二段", toolCalls: [{name: "insert_illustration", arguments: "{\"prompt\":\"雨夜街灯\"}"}]},
  {text: "第三段", toolCalls: []},
];
const node1 = newTarget("n1");
await run(
  makeOptions(),
  makeCallbacks(node1),
  {userText: "写一段", signal: new AbortController().signal},
);

check("完整链路：两轮主模型请求", chatRequests.length === 2);
check("完整链路：一次图像请求", imageRequests.length === 1);
check("图像请求使用所选图像模型", imageRequests[0]?.model === "image-model");
check("图像请求携带工具提交的提示词", imageRequests[0]?.prompt === "雨夜街灯");
check("完整链路：图片写入 IndexedDB", imageStore.size === 1);
check("完整链路：分段顺序为 文本-图片-文本", node1.segments.map((s) => s.type).join(",") === "text,image,text");
check("完整链路：图片段带提示词", node1.segments[1]?.prompt === "雨夜街灯");
check("完整链路：续写落在图片之后", node1.segments[2]?.text === "第三段");
check("请求包含工具定义", Array.isArray(chatRequests[0]?.tools) && chatRequests[0].tools.length === 1);
check("请求禁止并行工具调用", chatRequests[0]?.parallel_tool_calls === false);
check(
  "系统提示词包含生图提示词",
  String(chatRequests[0]?.messages?.[0]?.content).includes(illustrationPromptText),
);
check("第二轮请求包含 assistant.tool_calls", Array.isArray(chatRequests[1]?.messages?.at(-2)?.tool_calls));
check("第二轮请求包含 tool 结果", chatRequests[1]?.messages?.at(-1)?.role === "tool");
check("工具结果包含成功说明", String(chatRequests[1]?.messages?.at(-1)?.content).includes("插图已生成"));
check("工具结果关联调用 id", chatRequests[1]?.messages?.at(-1)?.tool_call_id === "call_0");

// 场景 2：段落不足时拒绝生图，并把原因回告主模型
reset();
chatScript = [
  {text: "只有一段", toolCalls: [{name: "insert_illustration", arguments: "{\"prompt\":\"太早\"}"}]},
  {text: "继续写", toolCalls: []},
];
const node2 = newTarget("n2");
await run(
  makeOptions(),
  makeCallbacks(node2),
  {userText: "写", signal: new AbortController().signal},
);
check("未达间隔：没有发起图像请求", imageRequests.length === 0);
check("未达间隔：没有插入图片段", node2.segments.every((s) => s.type === "text"));
check(
  "未达间隔：工具结果说明所需段落数",
  String(chatRequests[1]?.messages?.at(-1)?.content).includes("需要至少 2 个段落"),
);

// 场景 3：同一响应中的第二个合法调用必须被拒（插图后段落清零）
reset();
chatScript = [
  {
    text: "一\n\n二",
    toolCalls: [
      {id: "call_a", name: "insert_illustration", arguments: "{\"prompt\":\"第一张\"}"},
      {id: "call_b", name: "insert_illustration", arguments: "{\"prompt\":\"第二张\"}"},
    ],
  },
  {text: "三\n\n四", toolCalls: []},
];
const node3 = newTarget("n3");
await run(
  makeOptions(),
  makeCallbacks(node3),
  {userText: "写", signal: new AbortController().signal},
);
check("同轮两个调用：只生成一张图", imageRequests.length === 1);
check("同轮两个调用：只插入一个图片段", node3.segments.filter((s) => s.type === "image").length === 1);
check(
  "同轮两个调用：第二个收到间隔拒绝",
  String(chatRequests[1]?.messages?.at(-1)?.content).includes("需要至少 2 个段落"),
);
check(
  "同轮两个调用：工具结果按调用顺序对应",
  chatRequests[1]?.messages?.at(-2)?.tool_call_id === "call_a"
  && chatRequests[1]?.messages?.at(-1)?.tool_call_id === "call_b",
);

// 场景 4：生图失败时保留正文，继续续写
reset();
chatScript = [
  {text: "一\n\n二", toolCalls: [{name: "insert_illustration", arguments: "{\"prompt\":\"失败\"}"}]},
  {text: "三", toolCalls: []},
];
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  if (String(input).includes("/images/generations")) {
    return new Response(JSON.stringify({error: {message: "内容被拒绝"}}), {status: 400});
  }
  return originalFetch(input, init);
};
const node4 = newTarget("n4");
const callbacks4 = makeCallbacks(node4);
await run(
  makeOptions(),
  callbacks4,
  {userText: "写", signal: new AbortController().signal},
);
globalThis.fetch = originalFetch;
check("生图失败：没有插入图片段", node4.segments.every((s) => s.type === "text"));
check("生图失败：正文继续生成", tree.messageText(node4).includes("三"));
check(
  "生图失败：失败原因回告主模型",
  String(chatRequests[1]?.messages?.at(-1)?.content).includes("HTTP 400"),
);
check("生图失败：通知回调", callbacks4.events.some(([kind]) => kind === "illustration-failed"));

// 场景 5：非法参数与未知函数都只回告，不中断
reset();
chatScript = [
  {text: "一\n\n二", toolCalls: [
    {name: "insert_illustration", arguments: "not json"},
    {name: "unknown_tool", arguments: "{}"},
  ]},
  {text: "继续", toolCalls: []},
];
const node5 = newTarget("n5");
await run(
  makeOptions(),
  makeCallbacks(node5),
  {userText: "写", signal: new AbortController().signal},
);
check("非法参数：不发起图像请求", imageRequests.length === 0);
check("非法参数：回告提示词格式问题", String(chatRequests[1]?.messages?.at(-2)?.content).includes("格式错误"));
check("未知函数：回告不支持", String(chatRequests[1]?.messages?.at(-1)?.content).includes("不支持的函数"));

// 场景 6：模型反复调用时停止，并抛出具象错误
reset();
chatScript = Array.from({length: generation.MAX_TOOL_CALLS_PER_RESPONSE + 2}, (_, index) => ({
  text: `第 ${index} 段`,
  toolCalls: [{name: "insert_illustration", arguments: "{\"prompt\":\"循环\"}"}],
}));
let limitError = "";
try {
  await run(
  makeOptions({illustration: {paragraphInterval: 1}}),
  makeCallbacks(newTarget("n6")),
  );
} catch (error) {
  limitError = error.message;
}
check("调用上限：抛出具象错误", limitError.includes(String(generation.MAX_TOOL_CALLS_PER_RESPONSE)));

// 场景 7：插图关闭时不发送 tools、不注入生图提示词
reset();
chatScript = [{text: "普通回复", toolCalls: []}];
await generation.runGeneration(
  makeOptions({illustration: {enabled: false}}),
  [{role: "user", content: "写"}],
  new AbortController().signal,
  makeCallbacks(newTarget("n7")),
  {userText: "写", signal: new AbortController().signal},
);
check("关闭插图：请求不带 tools", chatRequests[0]?.tools === undefined);
check(
  "关闭插图：系统提示词不含生图提示词",
  !String(chatRequests[0]?.messages?.[0]?.content).includes(illustrationPromptText),
);
check("关闭插图：不请求图像", imageRequests.length === 0);

// 场景 8：插图开启但主模型未标记工具能力时，降级为只写正文
reset();
chatScript = [{text: "普通回复", toolCalls: []}];
await run(
  makeOptions({model: {...textModel, model: {...textModel.model, capabilities: ["text"]}}}),
  makeCallbacks(newTarget("n8")),
  {userText: "写", signal: new AbortController().signal},
);
check("未标记工具能力：请求不带 tools", chatRequests[0]?.tools === undefined);
check(
  "未标记工具能力：不注入生图提示词",
  !String(chatRequests[0]?.messages?.[0]?.content).includes(illustrationPromptText),
);

// 场景 9：未配置图像模型时同样降级
reset();
chatScript = [{text: "普通回复", toolCalls: []}];
await run(
  makeOptions({illustration: {imageModel: null}}),
  makeCallbacks(newTarget("n9")),
  {userText: "写", signal: new AbortController().signal},
);
check("无图像模型：请求不带 tools", chatRequests[0]?.tools === undefined);

// 场景 10：NSFW + 生图模型不支持时追加全年龄约束
reset();
chatScript = [{text: "回复", toolCalls: []}];
await run(
  makeOptions({
    illustration: {contentMode: "nsfw"},
    model: {...textModel, model: {...textModel.model, supportsNsfw: true}},
  }),
  makeCallbacks(newTarget("n10")),
  {userText: "写", signal: new AbortController().signal},
);
const nsfwSystem = String(chatRequests[0]?.messages?.[0]?.content);
check("NSFW + 生图模型不支持：追加全年龄约束", nsfwSystem.includes(prompts.SFW_ONLY_ILLUSTRATION_CONSTRAINT));
check("NSFW：仍然注入生图提示词", nsfwSystem.includes(illustrationPromptText));

// 场景 11：NSFW + 生图模型支持时不追加约束
reset();
chatScript = [{text: "回复", toolCalls: []}];
await run(
  makeOptions({
    illustration: {
      contentMode: "nsfw",
      imageModel: {...imageModel, model: {...imageModel.model, supportsNsfw: true}},
    },
    model: {...textModel, model: {...textModel.model, supportsNsfw: true}},
  }),
  makeCallbacks(newTarget("n11")),
  {userText: "写", signal: new AbortController().signal},
);
check(
  "NSFW + 生图模型支持：不追加全年龄约束",
  !String(chatRequests[0]?.messages?.[0]?.content).includes(prompts.SFW_ONLY_ILLUSTRATION_CONSTRAINT),
);

// 场景 12：中断后不再继续请求
reset();
chatScript = [{text: "一\n\n二", toolCalls: [{name: "insert_illustration", arguments: "{\"prompt\":\"图\"}"}]}];
const abortController = new AbortController();
const abortCallbacks = makeCallbacks(newTarget("n12"));
abortCallbacks.onIllustrationStart = () => abortController.abort();
let aborted = false;
try {
  await generation.runGeneration(
    makeOptions(),
    [{role: "user", content: "写"}],
    abortController.signal,
    abortCallbacks,
  );
} catch (error) {
  aborted = error instanceof DOMException && error.name === "AbortError";
}
check("中断：抛出 AbortError 供上层识别", aborted);
check("中断：只请求了一次主模型", chatRequests.length === 1);

server.closeAllConnections?.();
await new Promise((resolve) => server.close(resolve));
console.log(failures === 0 ? "ALL TESTS PASSED" : `${failures} TEST(S) FAILED`);
setTimeout(() => process.exit(failures === 0 ? 0 : 1), 300);
