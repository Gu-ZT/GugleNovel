import http from "node:http";
import {requestChatCompletion, isAbortError} from "./transport.mjs";
import {OpenAIConnection} from "./api-bundle.mjs";

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "content-type, authorization");
  if (req.method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }
  if (req.method !== "POST" || !req.url?.endsWith("/chat/completions")) {
    res.writeHead(404).end();
    return;
  }
  let raw = "";
  req.on("data", (chunk) => raw += chunk);
  req.on("end", () => {
    const body = JSON.parse(raw);
    if (body.model === "err") {
      res.writeHead(429, {"Content-Type": "application/json"});
      res.end(JSON.stringify({error: {message: "rate limited"}}));
      return;
    }
    if (body.stream) {
      res.writeHead(200, {"Content-Type": "text/event-stream"});
      res.write(`data: ${JSON.stringify({choices: [{delta: {content: "你好"}}]})}\n\n`);
      setTimeout(() => {
        res.write(`data: ${JSON.stringify({choices: [{delta: {content: "，世界"}}]})}\n\n`);
        res.write("data: [DONE]\n\n");
        res.end();
      }, 50);
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
const streamText = await requestChatCompletion({
  connection: conn, model: "m", messages, stream: true,
  signal: new AbortController().signal, onDelta: (t) => deltas.push(t),
});
check("stream final text", streamText === "你好，世界");
check("stream deltas cumulative", deltas.join("|") === "你好|你好，世界");

// 2. 非流式
const plainText = await requestChatCompletion({
  connection: conn, model: "m", messages, stream: false,
  signal: new AbortController().signal,
});
check("non-stream text", plainText === "完整回复");

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

server.closeAllConnections?.();
await new Promise((resolve) => server.close(resolve));
console.log(failures === 0 ? "ALL TESTS PASSED" : `${failures} TEST(S) FAILED`);
// 等待 undici keep-alive 句柄收尾，避免 Windows 下进程退出时的 libuv 杂音
setTimeout(() => process.exit(failures === 0 ? 0 : 1), 300);
