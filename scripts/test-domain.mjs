/* eslint-disable no-console */
// 领域逻辑验证：分段消息、段落后插图频率、提示词组合与工具参数解析。
const tree = await import(new URL("./domain-tree-bundle.mjs", import.meta.url).href);
const prompts = await import(new URL("./domain-prompts-bundle.mjs", import.meta.url).href);
const illustration = await import(new URL("./domain-illustration-bundle.mjs", import.meta.url).href);
const generation = await import(new URL("./generation-bundle.mjs", import.meta.url).href);

let failures = 0;
function check(name, ok) {
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}`);
  if (!ok) failures++;
}

// --- 分段消息 ---
const node = {id: "n1", parentId: null, childrenIds: [], role: "assistant", segments: [], createdAt: 1};
tree.appendTextSegment(node, "第一段\n\n第二段");
check("appendTextSegment 写入首个文本段", node.segments.length === 1 && node.segments[0].text.includes("第二段"));

tree.appendImageSegment(node, "雨夜街灯");
check(
  "appendImageSegment 追加生成中的插图卡片",
  node.segments.length === 2
  && node.segments[1].type === "image"
  && node.segments[1].status === "pending",
);

tree.appendTextSegment(node, "第三段");
check("插图之后的文本另起一段", node.segments.length === 3 && node.segments[2].type === "text");

check("messageText 忽略图片", !tree.messageText(node).includes("雨夜街灯"));
check("pending 插图不进入模型上下文", !tree.messageContextText(node).includes("[插图"));
const completedSegment = node.segments[1];
tree.completeImageSegment(node, completedSegment, "img-1", 1200);
check("completeImageSegment 回填图片引用", completedSegment.status === "ready" && completedSegment.imageId === "img-1");
check(
  "messageContextText 用结构化标注代替已完成的插图",
  tree.messageContextText(node).includes('<illustration description="雨夜街灯" />'),
);

// --- 插图标记清洗 ---
check(
  "清洗方括号插图标记",
  tree.stripIllustrationMarkers("正文一\n\n[插图：清晨的厨房，逆光]\n\n正文二") === "正文一\n\n正文二",
);
check(
  "清洗英文冒号的插图标记",
  tree.stripIllustrationMarkers("正文[插图: 画面]继续") === "正文继续",
);
check(
  "清洗结构化标注只删除标记本身",
  tree.stripIllustrationMarkers('正文 <illustration description="画面" /> 后续') === "正文  后续",
);
check(
  "清洗整行结构化标注",
  !tree.stripIllustrationMarkers('正文\n<illustration description="画面" />\n后续').includes("illustration"),
);
check(
  "清洗标注保留其后的正文",
  tree.stripIllustrationMarkers('正文\n<illustration description="画面" />\n后续').includes("后续"),
);
check("清洗后不残留多余空行", tree.stripIllustrationMarkers("一\n\n\n\n二") === "一\n\n二");
check("普通正文不受影响", tree.stripIllustrationMarkers("她推开木门。") === "她推开木门。");

// 历史消息中模型自写的标记不得进入上下文，避免被继续模仿
const pollutedNode = {
  id: "n-polluted", parentId: null, childrenIds: [], role: "assistant", createdAt: 1,
  segments: [{type: "text", text: "正文\n\n[插图：模型自己写的画面]\n\n后续正文"}],
};
check(
  "上下文剔除模型自写的插图标记",
  !tree.messageContextText(pollutedNode).includes("[插图"),
);
check(
  "上下文保留标记两侧正文",
  tree.messageContextText(pollutedNode).includes("正文")
  && tree.messageContextText(pollutedNode).includes("后续正文"),
);
check(
  "纯文本输出剔除模型自写的插图标记",
  !tree.messageText(pollutedNode).includes("[插图"),
);
check(
  "上下文占位使用结构化标注",
  tree.messageContextText(node).includes("<illustration description="),
);
check(
  "上下文占位不再使用正文式方括号",
  !tree.messageContextText(node).includes("[插图"),
);

// --- 插图作为工具调用记录进入上下文 ---
const toolNode = {id: "n-tool", parentId: null, childrenIds: [], role: "assistant", segments: [], createdAt: 1};
tree.appendTextSegment(toolNode, "第一段正文");
const toolSegment = tree.appendImageSegment(toolNode, "雨夜街灯", undefined, "call_abc");
tree.completeImageSegment(toolNode, toolSegment, "img-tool");
tree.appendTextSegment(toolNode, "第二段正文");

const contextMessages = tree.messageContextMessages(toolNode);
check(
  "插图重建为 assistant 工具调用与 tool 结果",
  contextMessages.some((message) => message.role === "assistant" && message.tool_calls?.length === 1)
  && contextMessages.some((message) => message.role === "tool"),
);
const toolCallMessage = contextMessages.find((message) => message.tool_calls?.length === 1);
check("工具调用使用原始调用 id", toolCallMessage?.tool_calls?.[0]?.id === "call_abc");
check("工具调用函数名为 insert_illustration",
  toolCallMessage?.tool_calls?.[0]?.function.name === "insert_illustration");
check(
  "工具调用参数保留提示词",
  JSON.parse(toolCallMessage.tool_calls[0].function.arguments).prompt === "雨夜街灯",
);
const toolResultMessage = contextMessages.find((message) => message.role === "tool");
check("工具结果关联调用 id", toolResultMessage?.tool_call_id === "call_abc");
check("上下文不再出现插图标记文本", !tree.messageContextText(toolNode).includes("illustration"));
check(
  "正文与工具调用顺序保持",
  contextMessages[0].content === "第一段正文"
  && contextMessages.at(-1).content === "第二段正文",
);

// 未完成或缺失调用 id 的插图不重建为真实调用
const pendingToolNode = {id: "n-pending", parentId: null, childrenIds: [], role: "assistant", createdAt: 1, segments: []};
tree.appendTextSegment(pendingToolNode, "正文");
const pendingSegment = tree.appendImageSegment(pendingToolNode, "还没好", undefined, "call_pending");
tree.failImageSegment(pendingToolNode, pendingSegment, "HTTP 500");
check(
  "失败的插图不重建为工具调用",
  !tree.messageContextMessages(pendingToolNode).some((message) => message.role === "tool"),
);

const legacyToolNode = {id: "n-legacy", parentId: null, childrenIds: [], role: "assistant", createdAt: 1, segments: []};
tree.appendTextSegment(legacyToolNode, "正文");
const legacySegment = tree.appendImageSegment(legacyToolNode, "旧图");
tree.completeImageSegment(legacyToolNode, legacySegment, "img-legacy");
check(
  "缺少调用 id 的旧插图退回文本标注",
  tree.messageContextText(legacyToolNode).includes("<illustration description=")
  && !tree.messageContextMessages(legacyToolNode).some((message) => message.role === "tool"),
);

// --- 插图卡片状态 ---
const meta = {
  imageModel: "image-model",
  imageProvider: "测试商",
  contentMode: "sfw",
  paragraphsSinceLastImage: 3,
  callIndex: 1,
  imageModelSupportsNsfw: false,
};
const cardNode = {id: "n-card", parentId: null, childrenIds: [], role: "assistant", segments: [], createdAt: 1};
const card = tree.appendImageSegment(cardNode, "雨夜街灯", meta);
check("卡片初始为生成中且无图片引用", card.status === "pending" && card.imageId === "");
check("卡片保留调用参数快照", card.meta?.imageModel === "image-model" && card.meta.callIndex === 1);

tree.completeImageSegment(cardNode, card, "img-card", 2400);
check("完成后状态变为 ready", card.status === "ready");
check("完成时记录耗时", card.meta?.durationMs === 2400);
check("完成后保留提示词与参数", card.prompt === "雨夜街灯" && card.meta?.imageProvider === "测试商");

const failedCard = tree.appendImageSegment(cardNode, "失败的图", meta);
tree.failImageSegment(cardNode, failedCard, "HTTP 400", 500);
check("失败卡片保留在正文中", failedCard.status === "failed");
check("失败卡片记录原因", failedCard.error === "HTTP 400");
check("失败卡片记录耗时", failedCard.meta?.durationMs === 500);
check("失败插图不进入模型上下文", !tree.messageContextText(cardNode).includes("失败的图"));

// 旧数据缺少 status 时按图片引用判断状态
const legacyReady = tree.normalizeSegments({segments: [{type: "image", imageId: "old-img", prompt: "旧图"}]});
check("旧数据有图片引用时视为已完成", legacyReady[0].status === "ready");
const legacyPending = tree.normalizeSegments({segments: [{type: "image", prompt: "没有图片"}]});
check("旧数据无图片引用时按失败处理", legacyPending[0].status === "failed");
check("旧数据缺图时给出具体原因", legacyPending[0].error === "插图数据缺失");

// 存储中残留的生成中状态必须降级，否则刷新后卡片会永久转圈
const restoredPending = tree.normalizeSegments({
  segments: [{type: "image", imageId: "", prompt: "被打断", status: "pending"}],
});
check("残留的生成中状态降级为失败", restoredPending[0].status === "failed");
check("残留状态附带可读原因", restoredPending[0].error === "上次生成未完成");

// 参数快照缺失或损坏时字段留空，卡片显示未记录
const metaWithoutFields = tree.normalizeSegments({
  segments: [{type: "image", imageId: "i1", prompt: "图", status: "ready", meta: {}}],
});
check("缺失的参数快照字段留空", metaWithoutFields[0].meta?.paragraphsSinceLastImage === undefined
  && metaWithoutFields[0].meta?.imageModelSupportsNsfw === undefined);
const badMode = tree.normalizeSegments({
  segments: [{type: "image", imageId: "i1", prompt: "图", status: "ready", meta: {contentMode: "unknown"}}],
});
check("非法内容模式不冒充有效值", badMode[0].meta?.contentMode === "");

// --- 段落计数与频率 ---
check("countParagraphs 按空行分段", tree.countParagraphs("一段\n\n二段\n\n三段") === 3);
check("countParagraphs 忽略空块", tree.countParagraphs("一段\n\n\n\n二段") === 2);

const intervalNode = {
  id: "n2", parentId: null, childrenIds: [], role: "assistant", segments: [], createdAt: 1,
};
tree.appendTextSegment(intervalNode, "一\n\n二");
check("未达间隔时段落数为 2", tree.paragraphsSinceLastImage(intervalNode) === 2);
tree.appendTextSegment(intervalNode, "\n\n三");
check("同一文本段内段落连续累加", tree.paragraphsSinceLastImage(intervalNode) === 3);
tree.appendImageSegment(intervalNode, "插图");
check("插图之后计数归零", tree.paragraphsSinceLastImage(intervalNode) === 0);
tree.appendTextSegment(intervalNode, "四");
check("插图之后重新累计", tree.paragraphsSinceLastImage(intervalNode) === 1);

// 段落间隔按单条助手回复独立计算：上一条回复写满段落也不计入本条回复
const previousNode = {
  id: "prev", parentId: null, childrenIds: [], role: "assistant", segments: [], createdAt: 1,
};
tree.appendTextSegment(previousNode, "前一段\n\n前二段\n\n前三段");
const freshNode = {
  id: "fresh", parentId: "prev", childrenIds: [], role: "assistant", segments: [], createdAt: 2,
};
check("上一条回复的段落不计入本条回复", tree.paragraphsSinceLastImage(freshNode) === 0);
tree.appendTextSegment(freshNode, "本条第一段\n\n本条第二段");
check("本条回复独立累计段落", tree.paragraphsSinceLastImage(freshNode) === 2);

// CRLF 与单换行分段的兼容
check("CRLF 段落计数正确", tree.countParagraphs("一\r\n\r\n二\r\n\r\n三") === 3);
check("单换行分段按行计数", tree.countParagraphs("一\n二\n三") === 3);

// --- 旧数据迁移与损坏数据 ---
const migrated = tree.normalizeConversations([{
  id: "c1",
  nodes: {
    n1: {id: "n1", parentId: null, childrenIds: ["n2"], role: "user", content: "旧版正文", createdAt: 1},
    n2: {id: "n2", parentId: "n1", childrenIds: [], role: "assistant", content: "旧版回复", createdAt: 2},
  },
  rootIds: ["n1"],
  activeLeafId: "n2",
}]);
check("旧版 content 迁移为文本段", migrated[0].nodes.n1.segments[0].text === "旧版正文");
check("迁移后路径完整", tree.resolvePath(migrated[0]).length === 2);

const brokenNodes = tree.normalizeNodes({
  a: {id: "a", parentId: "missing", childrenIds: ["b"], role: "assistant", content: "x"},
  b: {id: "b", parentId: "a", childrenIds: ["ghost"], role: "assistant", content: "y"},
});
check("孤儿节点降级为根", brokenNodes.a.parentId === null);
check("失效子节点被剔除", brokenNodes.b.childrenIds.length === 0);
check("节点 segments 一定存在", Array.isArray(brokenNodes.a.segments));

// --- 生图工具 ---
const sfwTool = illustration.buildIllustrationTool({
  contentMode: "sfw",
  imageModelAllowsNsfw: true,
  paragraphInterval: 3,
});
check("工具名为 insert_illustration", sfwTool.function.name === illustration.ILLUSTRATION_TOOL_NAME);
check("SFW 工具描述使用全年龄内容规则", sfwTool.function.description.includes(illustration.SFW_ILLUSTRATION_CONTENT_RULE));
check("工具描述写入段落间隔", sfwTool.function.description.includes("3 个段落"));
check("工具参数只要求 prompt", Array.isArray(sfwTool.function.parameters.required)
  && sfwTool.function.parameters.required.length === 1
  && sfwTool.function.parameters.required[0] === "prompt");

const nsfwTool = illustration.buildIllustrationTool({
  contentMode: "nsfw",
  imageModelAllowsNsfw: true,
  paragraphInterval: 3,
});
check(
  "NSFW + 支持图像模型时使用成人向规则",
  nsfwTool.function.description.includes(illustration.NSFW_ILLUSTRATION_CONTENT_RULE)
  && !nsfwTool.function.description.includes(illustration.SFW_ILLUSTRATION_CONTENT_RULE),
);

const nsfwSafeTool = illustration.buildIllustrationTool({
  contentMode: "nsfw",
  imageModelAllowsNsfw: false,
  paragraphInterval: 3,
});
check(
  "NSFW + 不支持图像模型时退回全年龄规则",
  nsfwSafeTool.function.description.includes(illustration.SFW_ILLUSTRATION_CONTENT_RULE),
);

check("解析合法参数", illustration.parseIllustrationPrompt("{\"prompt\":\" 雨夜街灯 \"}") === "雨夜街灯");
check("空提示词返回 null", illustration.parseIllustrationPrompt("{\"prompt\":\"   \"}") === null);
check("非法 JSON 返回 null", illustration.parseIllustrationPrompt("not json") === null);
check("缺字段返回 null", illustration.parseIllustrationPrompt("{}") === null);

// --- 系统提示词组合 ---
function makeRuntime(overrides = {}) {
  return {
    model: {provider: {}, model: {id: "m", capabilities: ["text", "tools"]}},
    connection: {},
    temperature: 0.9,
    maxTokens: 1024,
    stream: true,
    systemPrompt: "你是小说作家",
    illustration: {
      enabled: true,
      contentMode: "sfw",
      paragraphInterval: 3,
      systemPrompt: "插图规则",
      imageModel: {provider: {}, model: {id: "img", supportsNsfw: false}},
      ...overrides,
    },
  };
}

const sfwComposed = generation.composeSystemPrompt(makeRuntime());
check("SFW 组合包含生图提示词", sfwComposed.includes("插图规则"));
check("SFW 不追加 NSFW 限制", !sfwComposed.includes(prompts.SFW_ONLY_ILLUSTRATION_CONSTRAINT));

const nsfwComposed = generation.composeSystemPrompt(makeRuntime({contentMode: "nsfw"}));
check(
  "NSFW + 图像模型不支持时追加限制",
  nsfwComposed.includes(prompts.SFW_ONLY_ILLUSTRATION_CONSTRAINT),
);

const nsfwAllowed = generation.composeSystemPrompt(makeRuntime({
  contentMode: "nsfw",
  imageModel: {provider: {}, model: {id: "img", supportsNsfw: true}},
}));
check("NSFW + 图像模型支持时不追加限制", !nsfwAllowed.includes("只接受全年龄内容"));

const disabled = generation.composeSystemPrompt(makeRuntime({enabled: false, systemPrompt: "不该出现"}));
check("关闭插图时不注入生图提示词", !disabled.includes("不该出现") && !disabled.includes("全年龄"));

// --- 上下文裁剪 ---
const conversation = {
  id: "c2", title: "t", createdAt: 1, systemPrompt: "sys", variables: {},
  nodes: {
    u1: {id: "u1", parentId: null, childrenIds: ["a1"], role: "user", segments: [{type: "text", text: "写一段"}], createdAt: 1},
    a1: {id: "a1", parentId: "u1", childrenIds: [], role: "assistant",
      segments: [{type: "text", text: "正文"}, {type: "image", imageId: "i1", prompt: "画面", status: "ready"}], createdAt: 2},
  },
  rootIds: ["u1"],
  activeLeafId: "a1",
};
const requestMessages = generation.buildRequestMessages(conversation, "system", 128000);
check("请求消息首条为系统提示词", requestMessages[0].role === "system");
check("图片以结构化标注进入上下文", requestMessages.at(-1).content.includes('<illustration description="画面" />'));

const tinyBudget = generation.buildRequestMessages(conversation, "system", 1);
check("超预算时仍保留系统提示词", tinyBudget[0]?.role === "system");
check("超预算时保留最新一条消息", tinyBudget.at(-1)?.content.includes('<illustration description="画面" />'));
check("超预算时裁掉更早的消息", !tinyBudget.some((message) => message.content === "写一段"));

// --- 默认提示词 ---
const preset = prompts.defaultPromptPreset();
check("默认预设包含 SFW 生图提示词", preset.sfwIllustrationPrompt.length > 0);
check("默认预设包含 NSFW 生图提示词", preset.nsfwIllustrationPrompt.length > 0);
check("默认预设为内置预设", preset.isDefault === true);

const normalized = prompts.normalizePromptPresets([{id: "custom", name: "自定义", systemPrompt: "正文"}]);
check("自定义预设补齐生图提示词", normalized[1].sfwIllustrationPrompt.length > 0);
check("缺失内置预设时自动补回", normalized[0].id === prompts.DEFAULT_PROMPT_PRESET_ID);

console.log(failures === 0 ? "ALL TESTS PASSED" : `${failures} TEST(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
