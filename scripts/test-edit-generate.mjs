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


// IndexedDB 桩：记录删除过的图片 id，用于验证无主图片清理
const deletedImages = [];
const idbRecords = new Map();
/** 插图清理场景复用的图片 id，需在子进程分派前完成初始化。 */
const imageIds = {
  shared: "shared-image",
  exclusive: "only-in-b",
};

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
      get: (key) => makeRequest(() => idbRecords.get(key)),
      put: (record) => makeRequest(() => {
        idbRecords.set(record.id, record);
        return record.id;
      }),
      delete: (key) => makeRequest(() => {
        deletedImages.push(key);
        idbRecords.delete(key);
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

// 模块级恢复状态依赖首次加载时的 store，因此以下恢复场景在独立 Node 进程中验证。
const scenario = process.argv[2];

const bundledModule = () => require(path.join(root, "scripts", "novel-bundle.cjs"));
let useNovelWorkspace;

const resolvedModel = {
  provider: {id: "p1", name: "测试商", endpoint: "http://127.0.0.1:9", apiKey: "", models: []},
  model: {id: "m1", displayName: "测试模型", description: "", kind: "text", capabilities: ["streaming"], supportsNsfw: false, contextLength: 128000, maxOutputTokens: 4096},
};

let workspace;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitSettled() {
  for (let i = 0; i < 100 && workspace.generating.value; i++) await sleep(50);
}

async function waitForPersistence() {
  await sleep(20);
}

function createWorkspace(overrides = {}) {
  const resolved = overrides.resolvedModel ?? resolvedModel;
  const resolvedImage = overrides.resolvedImageModel ?? null;
  return useNovelWorkspace({
    provider: {
      modelSelection: {value: "p1|m1"},
      imageModelSelection: {value: resolvedImage ? "p1|img" : ""},
      resolveModelSelection: () => resolved,
      resolveImageModelSelection: () => resolvedImage,
    },
    prompt: {presets: {value: []}, activePreset: {value: null}},
    generation: {
      temperature: {value: 0.9},
      outputTokenOverride: {value: 0},
      autoTitle: {value: false},
      contentMode: {value: overrides.contentMode ?? "sfw"},
      illustrationEnabled: {value: overrides.illustrationEnabled === true},
      illustrationParagraphInterval: {value: 3},
    },
  });
}

let failed = false;
function assert(condition, message) {
  if (condition) console.log(`PASS: ${message}`);
  else { failed = true; console.error(`FAIL: ${message}`); }
}

if (scenario) {
  const isImageScenario = scenario.startsWith("prunes-") || scenario === "keeps-shared-image";
  const runner = isImageScenario
      ? runImageScenario(scenario)
      : runSessionPersistenceScenario(scenario);
  void runner.then(() => {
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
  assert(newPath.some((node) => node.segments[0]?.text === "写第一章（重写开篇）"), "活动路径包含新分支指令");
  await waitSettled();

  // 编辑 AI 正文不应触发生成
  workspace.startEditMessage(assistantNode.id);
  workspace.editingContent.value = "人工修订的正文";
  workspace.saveEditedMessage();
  assert(workspace.generating.value === false, "编辑 AI 正文不触发生成");

  // 插图配置检查：只有 NSFW 正文能力缺失会阻断生成，其余问题降级为只写正文
  const nsfwModel = {...resolvedModel, model: {...resolvedModel.model, supportsNsfw: false}};
  const imageModel = {...resolvedModel, model: {id: "img", kind: "image", supportsNsfw: false}};

  const nsfwBlocked = createWorkspace({resolvedModel: nsfwModel, contentMode: "nsfw"});
  assert(
    nsfwBlocked.illustrationStatus.value.blocking.includes("NSFW"),
    "NSFW 模式 + 主模型不支持时给出阻断原因",
  );

  const nsfwWithImages = createWorkspace({
    resolvedModel: nsfwModel,
    contentMode: "nsfw",
    illustrationEnabled: true,
  });
  assert(
    nsfwWithImages.illustrationStatus.value.blocking.includes("NSFW"),
    "关闭/开启插图都不影响 NSFW 正文的阻断判定",
  );

  const noToolsModel = {...resolvedModel, model: {...resolvedModel.model, capabilities: ["streaming"]}};
  const noTools = createWorkspace({resolvedModel: noToolsModel, illustrationEnabled: true});
  assert(
    noTools.illustrationStatus.value.blocking === ""
    && noTools.illustrationStatus.value.warning.includes("工具调用"),
    "主模型无工具能力时仅提示并降级为只写正文",
  );

  const noImageModel = createWorkspace({
    resolvedModel: {...resolvedModel, model: {...resolvedModel.model, capabilities: ["streaming", "tools"]}},
    illustrationEnabled: true,
  });
  assert(
    noImageModel.illustrationStatus.value.blocking === ""
    && noImageModel.illustrationStatus.value.warning.includes("图像模型"),
    "未选择图像模型时仅提示并降级为只写正文",
  );

  const imageNsfwMissing = createWorkspace({
    resolvedModel: {...resolvedModel, model: {...resolvedModel.model, capabilities: ["streaming", "tools"], supportsNsfw: true}},
    resolvedImageModel: imageModel,
    contentMode: "nsfw",
    illustrationEnabled: true,
  });
  assert(
    imageNsfwMissing.illustrationStatus.value.blocking === ""
    && imageNsfwMissing.illustrationStatus.value.warning.includes("全年龄"),
    "图像模型不支持 NSFW 时提示正文保持成人向、插图提示词受限",
  );

  // 图片清理依赖模块级持久化状态，必须在独立进程中验证
  const imageScenarios = ["prunes-unshared-image", "keeps-shared-image", "prunes-on-conversation-delete"];
  for (const imageScenario of imageScenarios) {
    const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), imageScenario], {
      cwd: root,
      encoding: "utf8",
    });
    if (result.stdout) process.stdout.write(result.stdout.replace(/^(PASS|FAIL):/gm, "    $1:"));
    if (result.stderr) process.stderr.write(result.stderr);
    if (result.error) throw result.error;
    assert(result.status === 0, `插图清理场景 ${imageScenario}`);
  }

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


function seedImageConversation() {
  idbRecords.set(imageIds.shared, {id: imageIds.shared, blob: new Blob(["a"]), mimeType: "image/png", createdAt: 1});
  idbRecords.set(imageIds.exclusive, {id: imageIds.exclusive, blob: new Blob(["b"]), mimeType: "image/png", createdAt: 1});
  const userNode = {
    id: "u1", parentId: null, childrenIds: ["a1", "a2"], role: "user",
    segments: [{type: "text", text: "写"}], createdAt: 1,
  };
  const branchA = {
    id: "a1", parentId: "u1", childrenIds: [], role: "assistant", createdAt: 2,
    segments: [
      {type: "text", text: "分支一"},
      {type: "image", imageId: imageIds.shared, prompt: "共享图"},
    ],
  };
  const branchB = {
    id: "a2", parentId: "u1", childrenIds: [], role: "assistant", createdAt: 3,
    segments: [
      {type: "text", text: "分支二"},
      {type: "image", imageId: imageIds.shared, prompt: "共享图"},
      {type: "image", imageId: imageIds.exclusive, prompt: "仅分支二"},
    ],
  };
  store.set("gugle-novel-conversations", JSON.stringify([{
    id: "conversation-image",
    title: "插图清理",
    createdAt: 1,
    systemPrompt: "",
    variables: {},
    nodes: {u1: userNode, a1: branchA, a2: branchB},
    rootIds: ["u1"],
    activeLeafId: "a2",
  }]));
  deletedImages.length = 0;
  // 模块级持久化状态在 require 时读取，必须先把数据写入 localStorage 再加载模块
  useNovelWorkspace = bundledModule().useNovelWorkspace;
  return createWorkspace();
}

async function runImageScenario(name) {
  const imageWorkspace = seedImageConversation();
  assert(imageWorkspace.activeConversation.value?.nodes.a2 !== undefined, "恢复含插图的会话");

  if (name === "prunes-unshared-image") {
    await imageWorkspace.deleteMessage("a2");
    assert(deletedImages.includes(imageIds.exclusive), "删除分支后清理该分支独有的图片");
    assert(!deletedImages.includes(imageIds.shared), "被其他分支共享的图片不得删除");
    return;
  }

  if (name === "keeps-shared-image") {
    await imageWorkspace.deleteMessage("a2");
    assert(!deletedImages.includes(imageIds.shared), "共享图片在删除分支后仍被保留");
    return;
  }

  if (name === "prunes-on-conversation-delete") {
    await imageWorkspace.deleteConversation(imageWorkspace.activeConversation.value.id);
    assert(deletedImages.includes(imageIds.shared), "删除作品后清理其中的图片");
    return;
  }

  // 未实现的场景名必须明确失败，禁止静默返回后被父进程当成通过
  assert(false, `未实现的插图清理场景 ${name}`);
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

  // 未实现的场景名必须明确失败，禁止静默返回后被父进程当成通过
  assert(false, `未实现的会话场景 ${name}`);
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
