/* eslint-disable no-console */
// 传输层验证：流式/非流式文本与思维链、错误与中断、工具调用分片累计、图像生成两种返回形态。
import http from "node:http";
import {requestChatCompletion, isAbortError} from "./transport.mjs";
import {OpenAIConnection} from "./api-bundle.mjs";
import {generateIllustration} from "./image-bundle.mjs";

const capturedBodies = [];

/** 1x1 PNG，用于验证 base64 与下载两条图片路径都能得到可用 Blob。 */
const TINY_PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type, authorization");
  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }
  if (req.method === "GET" && req.url === "/image.png") {
    res.writeHead(200, {"Content-Type": "image/png"});
    res.end(Buffer.from(TINY_PNG_BASE64, "base64"));
    return;
  }
  let raw = "";
  req.on("data", (chunk) => raw += chunk);
  req.on("end", () => {
    const body = JSON.parse(raw);
    capturedBodies.push({url: req.url, body});

    if (req.url?.endsWith("/images/generations")) {
      if (body.model === "image-url") {
        res.writeHead(200, {"Content-Type": "application/json"});
        res.end(JSON.stringify({data: [{url: `http://127.0.0.1:8765/image.png`}]}));
        return;
      }
      if (body.model === "image-broken") {
        res.writeHead(200, {"Content-Type": "application/json"});
        res.end(JSON.stringify({data: []}));
        return;
      }
      res.writeHead(200, {"Content-Type": "application/json"});
      res.end(JSON.stringify({data: [{b64_json: TINY_PNG_BASE64}]}));
      return;
    }

    if (!req.url?.endsWith("/chat/completions")) {
      res.writeHead(404).end();
      return;
    }
    if (body.model === "err") {
      res.writeHead(429, {"Content-Type": "application/json"});
      res.end(JSON.stringify({error: {message: "rate limited"}}));
      return;
    }
    if (body.stream) {
      res.writeHead(200, {"Content-Type": "text/event-stream"});
      if (body.model === "think") {
        res.write(`data: ${JSON.stringify({choices: [{delta: {reasoning_content: "让我想想"}}]})}\n\n`);
        setTimeout(() => {
          res.write(`data: ${JSON.stringify({choices: [{delta: {reasoning_content: "，雨后会有脚印"}}]})}\n\n`);
          res.write(`data: ${JSON.stringify({choices: [{delta: {content: "第一章"}}]})}\n\n`);
          res.write("data: [DONE]\n\n");
          res.end();
        }, 20);
        return;
      }
      if (body.model === "tool-stream") {
        res.write(`data: ${JSON.stringify({choices: [{delta: {content: "雨停下了。"}}]})}\n\n`);
        setTimeout(() => {
          // 工具调用分片：首片带 id 与函数名，后续片只带参数片段
          res.write(`data: ${JSON.stringify({
            choices: [{delta: {tool_calls: [{index: 0, id: "call_1", type: "function", function: {name: "insert_illustration", arguments: ""}}]}}],
          })}\n\n`);
          res.write(`data: ${JSON.stringify({
            choices: [{delta: {tool_calls: [{index: 0, function: {arguments: "{\"prompt\":\"雨夜"}}]}}],
          })}\n\n`);
          res.write(`data: ${JSON.stringify({
            choices: [{delta: {tool_calls: [{index: 0, function: {arguments: "街灯\"}"}}]}}],
          })}\n\n`);
          res.write("data: [DONE]\n\n");
          res.end();
        }, 20);
        return;
      }
      if (body.model === "tool-only") {
        // 只有工具调用、没有正文，不应被当成空响应报错
        res.write(`data: ${JSON.stringify({
          choices: [{delta: {tool_calls: [{index: 0, id: "call_only", type: "function", function: {name: "insert_illustration", arguments: "{\"prompt\":\"空镜\"}"}}]}}],
        })}\n\n`);
        res.write("data: [DONE]\n\n");
        res.end();
        return;
      }
      if (body.model === "tool-no-index") {
        // 兼容实现只在首片给 index，后续分片省略 index，参数必须仍能拼接完整
        res.write(`data: ${JSON.stringify({
          choices: [{delta: {tool_calls: [{index: 0, id: "call_ni", type: "function", function: {name: "insert_illustration", arguments: "{\"prompt\":"}}]}}],
        })}\n\n`);
        setTimeout(() => {
          res.write(`data: ${JSON.stringify({
            choices: [{delta: {tool_calls: [{function: {arguments: "\"晨雾\"}"}}]}}],
          })}\n\n`);
          res.write("data: [DONE]\n\n");
          res.end();
        }, 20);
        return;
      }
      if (body.model === "tool-parallel") {
        // 两个并行工具调用交替分片，必须按 index 分别累计
        res.write(`data: ${JSON.stringify({
          choices: [{delta: {tool_calls: [{index: 0, id: "call_p0", type: "function", function: {name: "insert_illustration", arguments: "{\"prompt\":\"甲\"}"}}]}}],
        })}\n\n`);
        res.write(`data: ${JSON.stringify({
          choices: [{delta: {tool_calls: [{index: 1, id: "call_p1", type: "function", function: {name: "insert_illustration", arguments: "{\"prompt\":\"乙\"}"}}]}}],
        })}\n\n`);
        res.write("data: [DONE]\n\n");
        res.end();
        return;
      }
      if (body.model === "tool-message-shape") {
        // 少数兼容实现在流式响应中直接给出完整 message.tool_calls
        res.write(`data: ${JSON.stringify({
          choices: [{message: {content: "已处理。", tool_calls: [{id: "call_msg", type: "function", function: {name: "insert_illustration", arguments: "{\"prompt\":\"檐下\"}"}}]}}],
        })}\n\n`);
        res.write("data: [DONE]\n\n");
        res.end();
        return;
      }
      res.write(`data: ${JSON.stringify({choices: [{delta: {content: "你好"}}]})}\n\n`);
      setTimeout(() => {
        res.write(`data: ${JSON.stringify({choices: [{delta: {content: "，世界"}}]})}\n\n`);
        res.write("data: [DONE]\n\n");
        res.end();
      }, 20);
      return;
    }
    if (body.model === "think") {
      res.writeHead(200, {"Content-Type": "application/json"});
      res.end(JSON.stringify({choices: [{message: {content: "完整回复", reasoning: "完整思维链"}}]}));
      return;
    }
    if (body.model === "tool-plain") {
      res.writeHead(200, {"Content-Type": "application/json"});
      res.end(JSON.stringify({
        choices: [{
          message: {
            content: "先到这里。",
            tool_calls: [{id: "call_2", type: "function", function: {name: "insert_illustration", arguments: "{\"prompt\":\"窗前\"}"}}],
          },
        }],
      }));
      return;
    }
    res.writeHead(200, {"Content-Type": "application/json"});
    res.end(JSON.stringify({choices: [{message: {content: "完整回复"}}]}));
  });
});

await new Promise((resolve) => server.listen(8765, "127.0.0.1", resolve));
const conn = new OpenAIConnection("http://127.0.0.1:8765", "test-key");
const messages = [{role: "user", content: "hi"}];
let failures = 0;
const check = (name, ok) => { console.log(`${ok ? "PASS" : "FAIL"} ${name}`); if (!ok) failures++; };

// 1. 流式
const deltas = [];
const stream = await requestChatCompletion({
  connection: conn, model: "m", messages, stream: true,
  signal: new AbortController().signal, onDelta: (t) => deltas.push(t),
});
check("stream final text", stream.text === "你好，世界");
check("stream deltas cumulative", deltas.join("|") === "你好|你好，世界");
check("stream without tools has none", stream.toolCalls.length === 0);

// 2. 非流式
const plain = await requestChatCompletion({
  connection: conn, model: "m", messages, stream: false,
  signal: new AbortController().signal,
});
check("non-stream text", plain.text === "完整回复");

// 3. 错误
let errMsg = "";
try {
  await requestChatCompletion({connection: conn, model: "err", messages, stream: false, signal: new AbortController().signal});
} catch (error) { errMsg = error.message; }
check("error message", errMsg.includes("HTTP 429") && errMsg.includes("rate limited"));

// 4. 中断
const controller = new AbortController();
let aborted = false;
let partial = "";
try {
  await requestChatCompletion({
    connection: conn, model: "m", messages, stream: true,
    signal: controller.signal,
    onDelta: (t) => { partial = t; controller.abort(); },
  });
} catch (error) { aborted = isAbortError(error); }
check("abort raises AbortError", aborted);
check("abort keeps partial text", partial === "你好");

// 5. baseUrl 自动补 /v1
check("baseUrl appends /v1", conn.baseUrl === "http://127.0.0.1:8765/v1");
check("auth header", conn.jsonHeaders.Authorization === "Bearer test-key");

// 6. 思维链：流式 reasoning_content 累积 + 与正文分离
const reasoningDeltas = [];
const think = await requestChatCompletion({
  connection: conn, model: "think", messages, stream: true,
  signal: new AbortController().signal,
  onReasoningDelta: (r) => reasoningDeltas.push(r),
});
check("stream reasoning cumulative", reasoningDeltas.join("|") === "让我想想|让我想想，雨后会有脚印");
check("stream reasoning separated from text", think.text === "第一章");

// 7. 思维链：非流式 reasoning 字段
let plainReasoning = "";
const thinkPlain = await requestChatCompletion({
  connection: conn, model: "think", messages, stream: false,
  signal: new AbortController().signal,
  onReasoningDelta: (r) => { plainReasoning = r; },
});
check("non-stream reasoning field", plainReasoning === "完整思维链");
check("non-stream text unaffected", thinkPlain.text === "完整回复");

// 8. 工具调用：流式分片累计
const toolStream = await requestChatCompletion({
  connection: conn, model: "tool-stream", messages, stream: true,
  tools: [{
    type: "function",
    function: {name: "insert_illustration", description: "插图", parameters: {type: "object", properties: {}}},
  }],
  signal: new AbortController().signal,
});
check("tool stream keeps text", toolStream.text === "雨停下了。");
check("tool stream single call", toolStream.toolCalls.length === 1);
check("tool stream merges id", toolStream.toolCalls[0]?.id === "call_1");
check("tool stream merges name", toolStream.toolCalls[0]?.name === "insert_illustration");
check(
  "tool stream concatenates arguments",
  toolStream.toolCalls[0]?.arguments === "{\"prompt\":\"雨夜街灯\"}",
);

// 9. 工具调用：非流式
const toolPlain = await requestChatCompletion({
  connection: conn, model: "tool-plain", messages, stream: false,
  signal: new AbortController().signal,
});
check("non-stream tool call parsed", toolPlain.toolCalls[0]?.arguments === "{\"prompt\":\"窗前\"}");
check("non-stream tool keeps text", toolPlain.text === "先到这里。");

// 10. 只有工具调用、没有正文时不报错
const toolOnly = await requestChatCompletion({
  connection: conn, model: "tool-only", messages, stream: true,
  signal: new AbortController().signal,
});
check("tool-only response accepted", toolOnly.toolCalls.length === 1 && toolOnly.text === "");

// 11. 请求体：带 tools 时禁用并行调用
const toolRequest = capturedBodies.find((entry) => entry.body.model === "tool-stream");
check("tools sent in request", Array.isArray(toolRequest?.body.tools) && toolRequest.body.tools.length === 1);
check("parallel tool calls disabled", toolRequest?.body.parallel_tool_calls === false);

// 11b. 分片缺少 index 时续写最后一个桶
const noIndexCall = await requestChatCompletion({
  connection: conn, model: "tool-no-index", messages, stream: true,
  signal: new AbortController().signal,
});
check("missing index keeps single call", noIndexCall.toolCalls.length === 1);
check(
  "missing index still concatenates arguments",
  noIndexCall.toolCalls[0]?.arguments === "{\"prompt\":\"晨雾\"}",
);

// 11c. 并行调用按 index 分别累计
const parallelCall = await requestChatCompletion({
  connection: conn, model: "tool-parallel", messages, stream: true,
  signal: new AbortController().signal,
});
check("parallel calls keep both entries", parallelCall.toolCalls.length === 2);
check("parallel call order by index", parallelCall.toolCalls[0]?.id === "call_p0"
  && parallelCall.toolCalls[1]?.id === "call_p1");
check("parallel call arguments separated", parallelCall.toolCalls[0]?.arguments === "{\"prompt\":\"甲\"}"
  && parallelCall.toolCalls[1]?.arguments === "{\"prompt\":\"乙\"}");

// 11d. 流式响应中直接给出 message.tool_calls 也能解析
const messageShapeCall = await requestChatCompletion({
  connection: conn, model: "tool-message-shape", messages, stream: true,
  signal: new AbortController().signal,
});
check("message-shape tool call parsed", messageShapeCall.toolCalls[0]?.arguments === "{\"prompt\":\"檐下\"}");
check("message-shape text kept", messageShapeCall.text === "已处理。");

// 12. 图像生成：base64 返回
const imageConn = new OpenAIConnection("http://127.0.0.1:8765", "test-key");
const imageModel = {provider: {endpoint: "http://127.0.0.1:8765", apiKey: "test-key"}, model: {id: "image-b64"}};
const b64Image = await generateIllustration({
  model: imageModel,
  prompt: "雨夜街灯",
  signal: new AbortController().signal,
});
check("image b64 returns blob", b64Image.blob.size > 0);
check("image b64 mime detected", b64Image.mimeType === "image/png");

// 13. 图像生成：URL 返回会被下载为本地 Blob
const urlImage = await generateIllustration({
  model: {...imageModel, model: {id: "image-url"}},
  prompt: "窗前",
  signal: new AbortController().signal,
});
check("image url downloaded", urlImage.blob.size > 0 && urlImage.mimeType === "image/png");

// 14. 图像生成：空数据报错，不返回虚假成功
let imageError = "";
try {
  await generateIllustration({model: {...imageModel, model: {id: "image-broken"}}, prompt: "x", signal: new AbortController().signal});
} catch (error) { imageError = error.message; }
check("empty image data rejected", imageError.includes("未返回图片"));

// 15. 图像请求体包含 model/prompt/n
const imageRequest = capturedBodies.find((entry) => entry.url?.endsWith("/images/generations"));
check("image request body", imageRequest?.body.model === "image-b64"
  && imageRequest?.body.prompt === "雨夜街灯"
  && imageRequest?.body.n === 1);
check("image request has no api key in url", !String(imageRequest?.url).includes("sk-"));

// 16. Tauri HTTP 作用域拦截必须提示为客户端授权问题，禁止误报为网络故障
const originalFetchForScope = globalThis.fetch;
globalThis.fetch = async () => {
  throw new Error(
    "url not allowed on the configured scope: http://192.168.20.28:8000/v1/images/generations",
  );
};
let scopeImageError = "";
try {
  await generateIllustration({
    model: {provider: {endpoint: "http://192.168.20.28:8000", apiKey: "k"}, model: {id: "image-scope"}},
    prompt: "x",
    signal: new AbortController().signal,
  });
} catch (error) { scopeImageError = error.message; }
check("scope denial mentions app authorization", scopeImageError.includes("应用未允许访问该接口地址"));
check("scope denial keeps original detail", scopeImageError.includes("url not allowed on the configured scope"));

let scopeChatError = "";
try {
  await requestChatCompletion({
    connection: new OpenAIConnection("http://192.168.20.28:8000", "k"),
    model: "m", messages, stream: false,
    signal: new AbortController().signal,
  });
} catch (error) { scopeChatError = error.message; }
check("scope denial also applies to chat requests", scopeChatError.includes("应用未允许访问该接口地址"));
globalThis.fetch = originalFetchForScope;

server.closeAllConnections?.();
await new Promise((resolve) => server.close(resolve));
console.log(failures === 0 ? "ALL TESTS PASSED" : `${failures} TEST(S) FAILED`);
// 等待 undici keep-alive 句柄收尾，避免 Windows 下进程退出时的 libuv 杂音
setTimeout(() => process.exit(failures === 0 ? 0 : 1), 300);
