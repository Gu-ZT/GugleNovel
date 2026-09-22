/* eslint-disable no-console */
// 逻辑验证：编辑用户指令保存后必须自动触发生成；编辑 AI 正文不得触发。
// 运行前由 package.json 脚本用 esbuild 打包 composable。
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import path from "node:path";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

// 浏览器环境桩：localStorage / window（@tauri-apps/api 的 isTauri 依赖 window 判定）
const store = new Map();
globalThis.localStorage = {
  getItem: (key) => (store.has(key) ? store.get(key) : null),
  setItem: (key, value) => store.set(key, String(value)),
  removeItem: (key) => store.delete(key),
  clear: () => store.clear(),
};
globalThis.window = globalThis;

const {useNovelWorkspace} = require(path.join(root, "scripts", "novel-bundle.cjs"));

const resolvedModel = {
  provider: {id: "p1", name: "测试商", endpoint: "http://127.0.0.1:9", apiKey: "", models: []},
  model: {id: "m1", displayName: "测试模型", description: "", capabilities: ["streaming"], contextLength: 128000, maxOutputTokens: 4096},
};

const workspace = useNovelWorkspace({
  provider: {modelSelection: {value: "p1|m1"}, resolveModelSelection: () => resolvedModel},
  prompt: {presets: {value: []}, activePreset: {value: null}},
  generation: {temperature: {value: 0.9}, outputTokenOverride: {value: 0}, autoTitle: {value: false}},
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitSettled() {
  for (let i = 0; i < 100 && workspace.generating.value; i++) await sleep(50);
}

let failed = false;
function assert(condition, message) {
  if (condition) console.log(`PASS: ${message}`);
  else { failed = true; console.error(`FAIL: ${message}`); }
}

workspace.createNewConversation();
workspace.draft.value = "写第一章";
workspace.sendMessage();
assert(workspace.generating.value === true, "发送指令后立即进入生成中");
await waitSettled();

const firstPath = workspace.activePath.value;
const userNode = firstPath.find((node) => node.role === "user");
const assistantNode = firstPath.find((node) => node.role === "assistant");
assert(Boolean(userNode && assistantNode), "首轮包含用户指令与 AI 占位/结果节点");

// 编辑用户指令（该节点已有子节点，即历史 bug 场景）
workspace.startEditMessage(userNode.id);
workspace.editingContent.value = "写第一章（重写开篇）";
workspace.saveEditedMessage();
assert(workspace.generating.value === true, "编辑用户指令保存后自动开始生成");

const newPath = workspace.activePath.value;
const lastNode = newPath[newPath.length - 1];
assert(lastNode?.role === "assistant", "生成占位节点追加在新指令分支之后");
assert(newPath.some((node) => node.content === "写第一章（重写开篇）"), "活动路径包含新分支指令");
await waitSettled();

// 编辑 AI 正文不应触发生成
workspace.startEditMessage(assistantNode.id);
workspace.editingContent.value = "人工修订的正文";
workspace.saveEditedMessage();
assert(workspace.generating.value === false, "编辑 AI 正文不触发生成");

console.log(failed ? "SOME TESTS FAILED" : "ALL TESTS PASSED");
process.exit(failed ? 1 : 0);
