import type {ContentMode} from "../prompts";

export type MessageRole = "system" | "user" | "assistant";

/** 助手正文的最小单元：文本段与插图段按生成顺序交替排列。 */
export interface TextSegment {
  type: "text";
  text: string;
}

/** 插图生成状态：调用发生时先插入 pending 段，完成或失败后原地更新。 */
export type ImageSegmentStatus = "pending" | "ready" | "failed";

/** 一次插图调用的参数快照，用于卡片展开后回看当时的生成条件；字段缺失表示未记录。 */
export interface ImageSegmentMeta {
  /** 生成该插图的图像模型 id */
  imageModel: string;
  /** 图像模型所属提供商名称 */
  imageProvider: string;
  /** 内容模式：SFW 或 NSFW */
  contentMode: ContentMode | "";
  /** 触发该插图时距离上一张插图的正文段落数 */
  paragraphsSinceLastImage?: number;
  /** 本次回复中的工具调用序号，用于定位卡片；被拒绝的调用同样计入 */
  callIndex?: number;
  /** 图像模型是否标记支持 NSFW */
  imageModelSupportsNsfw?: boolean;
  /** 生成耗时（毫秒），失败时记录已耗时 */
  durationMs?: number;
}

export interface ImageSegment {
  type: "image";
  /** 图片二进制存放在 IndexedDB，本地只在消息中保留引用 id；pending 与 failed 时为空 */
  imageId: string;
  /** 主模型提交给图像模型的提示词，用于展示与导出说明 */
  prompt: string;
  status: ImageSegmentStatus;
  /** 失败原因，仅 failed 状态填写 */
  error?: string;
  /** 调用参数快照，旧数据缺失时按可选处理 */
  meta?: ImageSegmentMeta;
  /**
   * 触发该插图的工具调用 id。
   * 重建上下文时用它把插图还原为 assistant.tool_calls 与对应的 tool 结果，
   * 旧数据缺失时退回文本标注。
   */
  toolCallId?: string;
}

export type MessageSegment = TextSegment | ImageSegment;

export interface MessageNode {
  id: string;
  parentId: string | null;
  childrenIds: string[];
  role: MessageRole;
  segments: MessageSegment[];
  /** 思维链内容（推理模型输出），与正文分开存储 */
  reasoning?: string;
  modelLabel?: string;
  createdAt: number;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: number;
  /** 会话创建时的系统提示词快照，可单独修改 */
  systemPrompt: string;
  /** 会话当前使用的提示词预设 id（用于预设下拉回显） */
  presetId?: string;
  /** 会话级提示词变量（题材 / 文风格式） */
  variables: Record<string, string>;
  /** 会话级生图提示词快照，缺失时回落到当前预设 */
  illustrationPrompts?: {sfw: string; nsfw: string};
  nodes: Record<string, MessageNode>;
  rootIds: string[];
  activeLeafId: string;
}

export const CONVERSATIONS_KEY = "gugle-novel-conversations";
export const ACTIVE_CONVERSATION_KEY = "gugle-novel-active-conversation";

export function createNodeId(): string {
  return globalThis.crypto?.randomUUID?.()
      ?? `node-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createConversationId(): string {
  return globalThis.crypto?.randomUUID?.()
      ?? `conversation-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createConversation(
    systemPrompt: string,
    presetId?: string,
    illustrationPrompts?: {sfw: string; nsfw: string}
): Conversation {
  return {
    id: createConversationId(),
    title: "新对话",
    createdAt: Date.now(),
    systemPrompt,
    presetId,
    variables: {genre: "", style: ""},
    illustrationPrompts: illustrationPrompts
        ? {sfw: illustrationPrompts.sfw, nsfw: illustrationPrompts.nsfw}
        : undefined,
    nodes: {},
    rootIds: [],
    activeLeafId: "",
  };
}

/** 从叶子回溯到根再反转，得到当前浏览路径（含系统提示词虚拟节点之外的纯消息）。 */
export function resolvePath(conversation: Conversation): MessageNode[] {
  const path: MessageNode[] = [];
  let cursor = conversation.activeLeafId;
  let guard = 0;
  while (cursor && guard++ < 10000) {
    const node = conversation.nodes[cursor];
    if (!node) break;
    path.unshift(node);
    cursor = node.parentId ?? "";
  }
  return path;
}

/** 节点的兄弟分支（含自身），按创建时间排序。 */
export function siblingsOf(conversation: Conversation, node: MessageNode): MessageNode[] {
  const ids = node.parentId === null
      ? conversation.rootIds
      : conversation.nodes[node.parentId]?.childrenIds ?? [];
  return ids
      .map((id) => conversation.nodes[id])
      .filter((item): item is MessageNode => Boolean(item))
      .sort((a, b) => a.createdAt - b.createdAt);
}

/** 当前路径上每个节点的兄弟分支信息，用于渲染 ◀ n/m ▶ 切换器。 */
export interface BranchInfo {
  node: MessageNode;
  siblings: MessageNode[];
  index: number;
}

export function pathBranches(conversation: Conversation): BranchInfo[] {
  return resolvePath(conversation).map((node) => {
    const siblings = siblingsOf(conversation, node);
    return {node, siblings, index: siblings.findIndex((item) => item.id === node.id)};
  });
}

/** 判断节点是否位于当前活动路径上。 */
export function isOnActivePath(conversation: Conversation, nodeId: string): boolean {
  return resolvePath(conversation).some((node) => node.id === nodeId);
}

/** 收集子树全部节点 id（含自身）。 */
export function subtreeIds(conversation: Conversation, nodeId: string): string[] {
  const result: string[] = [];
  const stack = [nodeId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    const node = conversation.nodes[id];
    if (!node) continue;
    result.push(id);
    stack.push(...node.childrenIds);
  }
  return result;
}

/** 节点正文的纯文本（忽略插图），用于复制、标题与上下文预算。 */
export function messageText(node: MessageNode): string {
  return node.segments
      .filter((segment): segment is TextSegment => segment.type === "text")
      .map((segment) => stripIllustrationMarkers(segment.text))
      .filter(Boolean)
      .join("\n\n");
}

/**
 * 清理模型误写进正文的插图标记。
 * 插图应由工具调用产生，但模型可能模仿上下文里的标注自行输出方括号说明，
 * 这些文本不属于正文，展示与再次进入上下文前都要剔除。
 */
export function stripIllustrationMarkers(text: string): string {
  return text
      .replace(/\[插图[：:][^\]]*\]/g, "")
      .replace(/<illustration\b[^>]*\/?>/gi, "")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
}

/** 上下文中的一条消息，字段对应 OpenAI Chat Completions 的消息结构。 */
export interface ContextMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  tool_calls?: Array<{id: string; type: "function"; function: {name: string; arguments: string}}>;
  tool_call_id?: string;
}

/** 工具调用的函数名，与 domain/illustration 中的定义保持一致。 */
const ILLUSTRATION_TOOL_FUNCTION = "insert_illustration";

/** 插图成功生成后回填给模型的工具结果文本。 */
const ILLUSTRATION_TOOL_RESULT = "插图已生成并插入到当前段落之后。";

/**
 * 把一条消息还原为上下文消息序列。
 * 插图在生成时本就是一次工具调用，这里重建 assistant.tool_calls 与 tool 结果，
 * 让模型看到的是真实调用记录，避免它模仿文本标注在正文里写插图说明。
 * 缺少调用 id 的历史插图退回文本标注，保证旧会话仍能表达「此处有图」。
 */
export function messageContextMessages(node: MessageNode): ContextMessage[] {
  const messages: ContextMessage[] = [];
  let pendingText = "";

  const flushText = () => {
    if (!pendingText.trim()) return;
    messages.push({role: node.role, content: pendingText});
    pendingText = "";
  };

  for (const segment of node.segments) {
    if (segment.type === "text") {
      const cleaned = stripIllustrationMarkers(segment.text);
      if (!cleaned) continue;
      pendingText = pendingText ? `${pendingText}\n\n${cleaned}` : cleaned;
      continue;
    }
    if (segment.status !== "ready") continue;
    if (!segment.toolCallId) {
      // 旧数据没有调用 id，只能用文本标注表示此处有图
      const description = segment.prompt.replace(/"/g, "'").replace(/\s+/g, " ").trim();
      const marker = `<illustration description="${description}" />`;
      pendingText = pendingText ? `${pendingText}\n\n${marker}` : marker;
      continue;
    }
    // 正文先落到 assistant 消息，插图作为一次工具调用紧随其后
    flushText();
    messages.push({
      role: "assistant",
      content: "",
      tool_calls: [{
        id: segment.toolCallId,
        type: "function",
        function: {name: ILLUSTRATION_TOOL_FUNCTION, arguments: JSON.stringify({prompt: segment.prompt})},
      }],
    });
    messages.push({role: "tool", tool_call_id: segment.toolCallId, content: ILLUSTRATION_TOOL_RESULT});
  }
  flushText();
  return messages;
}

/**
 * 供主模型读取的上下文文本形式。
 * 保留给只接受单条文本的场景（标题生成、token 估算），
 * 插图的真实调用记录由 messageContextMessages 提供。
 */
export function messageContextText(node: MessageNode): string {
  return messageContextMessages(node)
      .map((message) => message.content)
      .filter(Boolean)
      .join("\n\n");
}

/** 追加流式文本：接在当前末尾文本段之后，末尾是插图时新开一段。 */
export function appendTextSegment(node: MessageNode, delta: string): void {
  const last = node.segments[node.segments.length - 1];
  if (last && last.type === "text") {
    last.text += delta;
  } else {
    node.segments.push({type: "text", text: delta});
  }
}

/**
 * 在当前正文之后插入插图卡片，返回该段的引用。
 * 调用时先以 pending 状态插入占位，生图结束后由调用方原地回填图片或失败原因，
 * 保证卡片位置就是插图最终位置。
 */
export function appendImageSegment(
    node: MessageNode,
    prompt: string,
    meta?: ImageSegmentMeta,
    toolCallId?: string
): ImageSegment {
  const segment: ImageSegment = {
    type: "image",
    imageId: "",
    prompt,
    status: "pending",
    meta,
    toolCallId,
  };
  node.segments.push(segment);
  return segment;
}

/** 插图生成完成：回填图片引用与耗时。 */
export function completeImageSegment(
    node: MessageNode,
    segment: ImageSegment,
    imageId: string,
    durationMs?: number
): void {
  const target = node.segments.find(
      (item): item is ImageSegment => item === segment
  );
  if (!target) return;
  target.imageId = imageId;
  target.status = "ready";
  target.error = undefined;
  if (durationMs !== undefined && target.meta) target.meta.durationMs = durationMs;
}

/** 插图生成失败：保留卡片并记录原因，便于在正文中定位。 */
export function failImageSegment(
    node: MessageNode,
    segment: ImageSegment,
    reason: string,
    durationMs?: number
): void {
  const target = node.segments.find(
      (item): item is ImageSegment => item === segment
  );
  if (!target) return;
  target.status = "failed";
  target.error = reason;
  if (durationMs !== undefined && target.meta) target.meta.durationMs = durationMs;
}

/** 节点的全部图片引用 id，用于删除消息后清理无主图片。 */
export function conversationImageIds(conversation: Conversation): string[] {
  const ids = new Set<string>();
  for (const node of Object.values(conversation.nodes)) {
    for (const segment of node.segments) {
      if (segment.type === "image" && segment.imageId) ids.add(segment.imageId);
    }
  }
  return [...ids];
}

/** 统计文本中的正文段落数：空行分段，整段没有空行时按单换行分段，兼容 CRLF。 */
export function countParagraphs(text: string): number {
  const normalized = text.replace(/\r\n?/g, "\n");
  const blocks = normalized.split(/\n{2,}/).filter((block) => block.trim().length > 0);
  // 模型常用单换行分段；整段没有空行时按行统计，避免段落间隔永远达不到
  if (blocks.length <= 1) {
    return normalized.split("\n").filter((line) => line.trim().length > 0).length;
  }
  return blocks.length;
}

/** 自最后一张插图之后累计的正文段落数，用于判断是否达到插图频率。 */
export function paragraphsSinceLastImage(node: MessageNode): number {
  let total = 0;
  for (let index = node.segments.length - 1; index >= 0; index--) {
    const segment = node.segments[index];
    if (segment.type === "image") break;
    total += countParagraphs(segment.text);
  }
  return total;
}

/** 估算当前路径的 token 占用（字符数除以 4）。 */
export function estimatePathTokens(conversation: Conversation): number {
  const chars = resolvePath(conversation)
      .reduce((total, node) => total + messageContextText(node).length, 0)
      + conversation.systemPrompt.length;
  return Math.ceil(chars / 4);
}

/** 整树按父子关系展开为带深度的列表（供分支面板渲染）。 */
export interface TreeRow {
  node: MessageNode;
  depth: number;
  onPath: boolean;
}

export function flattenTree(conversation: Conversation): TreeRow[] {
  const rows: TreeRow[] = [];
  const walk = (ids: string[], depth: number) => {
    for (const id of ids) {
      const node = conversation.nodes[id];
      if (!node) continue;
      rows.push({node, depth, onPath: isOnActivePath(conversation, id)});
      walk(node.childrenIds, depth + 1);
    }
  };
  walk(conversation.rootIds, 0);
  return rows;
}

/** 校验并规整分段数组；旧版本只有 content 字段的数据迁移为单个文本段。 */
export function normalizeSegments(record: Record<string, unknown>): MessageSegment[] {
  const segments: MessageSegment[] = [];
  if (Array.isArray(record.segments)) {
    for (const item of record.segments) {
      if (!item || typeof item !== "object") continue;
      const segment = item as Record<string, unknown>;
      if (segment.type === "image") {
        const imageId = typeof segment.imageId === "string" ? segment.imageId : "";
        const prompt = typeof segment.prompt === "string" ? segment.prompt : "";
        const meta = normalizeImageMeta(segment.meta);
        const toolCallId = typeof segment.toolCallId === "string" && segment.toolCallId
            ? segment.toolCallId
            : undefined;
        // 存储中残留的生成中状态意味着上次生成被打断，运行时已无法回填，
        // 必须在这里降级为失败，否则界面会永久显示进度
        if (segment.status === "pending") {
          segments.push({
            type: "image",
            imageId,
            prompt,
            status: "failed",
            error: "上次生成未完成",
            meta,
            toolCallId,
          });
          continue;
        }
        if (segment.status === "failed") {
          segments.push({
            type: "image",
            imageId,
            prompt,
            status: "failed",
            error: typeof segment.error === "string" ? segment.error : "插图生成失败",
            meta,
            toolCallId,
          });
          continue;
        }
        // 旧数据没有 status 字段：有图片引用即视为已就绪，无引用说明插图数据缺失
        if (imageId) {
          segments.push({type: "image", imageId, prompt, status: "ready", meta, toolCallId});
        } else {
          segments.push({
            type: "image",
            imageId: "",
            prompt,
            status: "failed",
            error: "插图数据缺失",
            meta,
            toolCallId,
          });
        }
        continue;
      }
      if (typeof segment.text === "string") {
        segments.push({type: "text", text: segment.text});
      }
    }
    return segments;
  }
  if (typeof record.content === "string" && record.content.length > 0) {
    return [{type: "text", text: record.content}];
  }
  return [];
}

/**
 * 插图参数快照逐字段校验：记录来源不可信，
 * 无法确认的字段一律留空，由卡片显示「未记录」。
 */
function normalizeImageMeta(value: unknown): ImageSegmentMeta | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  const durationMs = Number(record.durationMs);
  return {
    imageModel: typeof record.imageModel === "string" ? record.imageModel : "",
    imageProvider: typeof record.imageProvider === "string" ? record.imageProvider : "",
    contentMode: record.contentMode === "nsfw" || record.contentMode === "sfw" ? record.contentMode : "",
    paragraphsSinceLastImage: Number.isFinite(Number(record.paragraphsSinceLastImage))
        ? Number(record.paragraphsSinceLastImage)
        : undefined,
    callIndex: Number.isFinite(Number(record.callIndex)) ? Number(record.callIndex) : undefined,
    imageModelSupportsNsfw: typeof record.imageModelSupportsNsfw === "boolean"
        ? record.imageModelSupportsNsfw
        : undefined,
    durationMs: Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : undefined,
  };
}

function normalizeNode(value: unknown): MessageNode | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || !record.id) return null;
  const role: MessageRole = record.role === "user" || record.role === "system" ? record.role : "assistant";
  return {
    id: record.id,
    parentId: typeof record.parentId === "string" ? record.parentId : null,
    childrenIds: Array.isArray(record.childrenIds)
        ? record.childrenIds.filter((id): id is string => typeof id === "string")
        : [],
    role,
    segments: normalizeSegments(record),
    reasoning: typeof record.reasoning === "string" ? record.reasoning : undefined,
    modelLabel: typeof record.modelLabel === "string" ? record.modelLabel : undefined,
    createdAt: typeof record.createdAt === "number" ? record.createdAt : Date.now(),
  };
}

/**
 * 规整消息表：逐节点校验分段与父子引用，丢弃无法定位父节点的孤儿节点，
 * 避免存储损坏的数据在渲染或追加分支时抛异常。
 */
export function normalizeNodes(value: unknown): Record<string, MessageNode> {
  if (!value || typeof value !== "object") return {};
  const source = value as Record<string, unknown>;
  const nodes: Record<string, MessageNode> = {};
  for (const [key, item] of Object.entries(source)) {
    const node = normalizeNode(item);
    if (!node) continue;
    nodes[key] = node;
  }
  for (const node of Object.values(nodes)) {
    node.childrenIds = node.childrenIds.filter((id) => nodes[id] && nodes[id].parentId === node.id);
  }
  for (const node of Object.values(nodes)) {
    if (node.parentId !== null && !nodes[node.parentId]) node.parentId = null;
  }
  return nodes;
}

export function normalizeConversations(value: unknown): Conversation[] {
  if (!Array.isArray(value)) return [];
  const conversations: Conversation[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const nodes = normalizeNodes(record.nodes);
    const rootIds = Array.isArray(record.rootIds)
        ? record.rootIds.filter((id): id is string => typeof id === "string" && Boolean(nodes[id]))
        : [];
    const id = typeof record.id === "string" && record.id.trim() ? record.id : createConversationId();
    const activeLeafId = typeof record.activeLeafId === "string" && nodes[record.activeLeafId]
        ? record.activeLeafId
        : findAnyLeaf(nodes, rootIds);
    conversations.push({
      id,
      title: typeof record.title === "string" && record.title.trim() ? record.title : "新对话",
      createdAt: typeof record.createdAt === "number" ? record.createdAt : Date.now(),
      systemPrompt: typeof record.systemPrompt === "string" ? record.systemPrompt : "",
      presetId: typeof record.presetId === "string" ? record.presetId : undefined,
      variables: record.variables && typeof record.variables === "object"
          ? record.variables as Record<string, string>
          : {},
      illustrationPrompts: normalizeIllustrationPrompts(record.illustrationPrompts),
      nodes,
      rootIds,
      activeLeafId,
    });
  }
  return conversations;
}

/** 会话级生图提示词快照；缺失时保留 undefined，由调用方回落到预设默认值。 */
function normalizeIllustrationPrompts(value: unknown): {sfw: string; nsfw: string} | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  return {
    sfw: typeof record.sfw === "string" ? record.sfw : "",
    nsfw: typeof record.nsfw === "string" ? record.nsfw : "",
  };
}

function findAnyLeaf(nodes: Record<string, MessageNode>, rootIds: string[]): string {
  let leaf = "";
  const walk = (ids: string[]) => {
    for (const id of ids) {
      const node = nodes[id];
      if (!node) continue;
      leaf = id;
      walk(node.childrenIds);
    }
  };
  walk(rootIds);
  return leaf;
}
