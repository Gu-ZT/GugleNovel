/* eslint-disable no-console */
// 逻辑验证：编辑用户指令保存后必须自动触发生成；编辑 AI 正文不得触发。
// 运行前由 package.json 脚本用 esbuild 打包 composable。
import {createRequire} from "node:module";
import {fileURLToPath} from "node:url";
import path from "node:path";
import {spawnSync} from "node:child_process";

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
if (process.env.GUGLE_SESSION_STORAGE) {
  store.set("gugle-novel-conversations", process.env.GUGLE_SESSION_STORAGE);
}
if (process.env.GUGLE_ACTIVE_STORAGE) {
  store.set("gugle-novel-active-conversation", process.env.GUGLE_ACTIVE_STORAGE);
}

// 模块级恢复状态依赖首次加载时的 store，因此以下恢复场景在独立 Node 进程中验证。
const scenario = process.argv[2];

const bundledModule = () => require(path.join(root, "scripts", "novel-bundle.cjs"));
let useNovelWorkspace;

const resolvedModel = {
  provider: {id: "p1", name: "测试商", endpoint: "http://127.0.0.1:9", apiKey: "", models: []},
  model: {id: "m1", displayName: "测试模型", description: "", capabilities: ["streaming"], contextLength: 128000, maxOutputTokens: 4096},
};

let workspace;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitSettled() {
  for (let i = 0; i < 100 && workspace.generating.value; i++) await sleep(50);
}

async function waitForPersistence() {
  await sleep(20);
}

function createWorkspace() {
  return useNovelWorkspace({
    provider: {modelSelection: {value: "p1|m1"}, resolveModelSelection: () => resolvedModel},
    prompt: {presets: {value: []}, activePreset: {value: null}},
    generation: {temperature: {value: 0.9}, outputTokenOverride: {value: 0}, autoTitle: {value: false}},
  });
}

let failed = false;
function assert(condition, message) {
  if (condition) console.log(`PASS: ${message}`);
  else { failed = true; console.error(`FAIL: ${message}`); }
}

if (scenario) {
  void runSessionPersistenceScenario(scenario).then(() => {
    process.exit(failed ? 1 : 0);
  });
} else {
  useNovelWorkspace = bundledModule().useNovelWorkspace;
  workspace = createWorkspace();
  void runMainTests();
}

async function runMainTests() {
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

  // 会话恢复测试在子进程中运行，避免模块级 persistedActiveConversationId 被缓存。
  const persistenceScenarios = [
    "persists-selected",
    "restores-selected",
    "deletes-selected",
    "invalid-selected",
    "no-conversations",
  ];
  for (const persistenceScenario of persistenceScenarios) {
    const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), persistenceScenario], {
      cwd: root,
      encoding: "utf8",
    });
    if (result.stdout) process.stdout.write(result.stdout.replace(/^(PASS|FAIL):/gm, "    $1:"));
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.error) throw result.error;
    assert(result.status === 0, `会话持久化场景 ${persistenceScenario}`);
  }

  console.log(failed ? "SOME TESTS FAILED" : "ALL TESTS PASSED");
  process.exit(failed ? 1 : 0);
}

async function runSessionPersistenceScenario(name) {
  useNovelWorkspace = bundledModule().useNovelWorkspace;
  const firstSession = createWorkspace();
  if (name === "restores-selected-process") {
    const savedId = JSON.parse(localStorage.getItem("gugle-novel-active-conversation"));
    assert(firstSession.activeConversationId.value === savedId, "重新加载工作台时恢复上次保存的活动会话");
    assert(
        firstSession.conversations.value.some((conversation) => conversation.id === savedId),
        "恢复的活动会话仍存在",
    );
    return;
  }

  if (name === "invalid-selected-process") {
    assert(
        firstSession.activeConversationId.value === firstSession.conversations.value[0]?.id,
        "无效活动 ID 回退到首条会话",
    );
    return;
  }

  firstSession.createNewConversation();
  const firstId = firstSession.activeConversation.value?.id;
  firstSession.createNewConversation();
  const secondId = firstSession.activeConversation.value?.id;
  await waitForPersistence();

  if (name === "persists-selected") {
    assert(Boolean(firstId && secondId && firstId !== secondId), "连续新建两个会话");
    assert(
        JSON.parse(localStorage.getItem("gugle-novel-active-conversation")) === secondId,
        "选中新会话后立即保存其会话 ID",
    );
    return;
  }

  if (name === "restores-selected") {
    const processResult = startSecondSession("restores-selected-process");
    if (processResult.stderr) process.stderr.write(processResult.stderr);
    assert(processResult.status === 0, "重新加载工作台时恢复上次选中的会话");
    return;
  }

  if (name === "deletes-selected") {
    firstSession.deleteConversation(secondId);
    await waitForPersistence();
    assert(
        firstSession.activeConversation.value?.id === firstId,
        "删除当前会话后回退到首条会话",
    );
    assert(
        JSON.parse(localStorage.getItem("gugle-novel-active-conversation")) === firstId,
        "删除当前会话后保存新的活动会话 ID",
    );
    const processResult = startSecondSession("restores-selected-process");
    if (processResult.stderr) process.stderr.write(processResult.stderr);
    assert(processResult.status === 0, "重新加载工作台时恢复删除后的活动会话");
    return;
  }

  if (name === "invalid-selected") {
    store.set("gugle-novel-conversations", JSON.stringify(firstSession.conversations.value));
    store.set("gugle-novel-active-conversation", "conversation-missing");
    const processResult = startSecondSession("invalid-selected-process");
    if (processResult.stderr) process.stderr.write(processResult.stderr);
    assert(processResult.status === 0, "无效活动 ID 回退到首条会话");
    return;
  }

  if (name === "no-conversations") {
    store.clear();
    const empty = createWorkspace();
    assert(empty.conversations.value.length === 0, "没有会话时不伪造数据");
    assert(empty.activeConversationId.value === "", "没有会话时活动 ID 为空");
    assert(localStorage.getItem("gugle-novel-active-conversation") === null, "没有会话时不写入活动 ID");
    return;
  }
}

function startSecondSession(environmentName) {
  const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), environmentName], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      GUGLE_SESSION_STORAGE: localStorage.getItem("gugle-novel-conversations"),
      GUGLE_ACTIVE_STORAGE: localStorage.getItem("gugle-novel-active-conversation"),
    },
  });
  return result;
}
