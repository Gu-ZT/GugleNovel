export type MessageRole = "system" | "user" | "assistant";

export interface MessageNode {
  id: string;
  parentId: string | null;
  childrenIds: string[];
  role: MessageRole;
  content: string;
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
  nodes: Record<string, MessageNode>;
  rootIds: string[];
  activeLeafId: string;
}

export const CONVERSATIONS_KEY = "gugle-novel-conversations";

export function createNodeId(): string {
  return globalThis.crypto?.randomUUID?.()
      ?? `node-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createConversationId(): string {
  return globalThis.crypto?.randomUUID?.()
      ?? `conversation-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function createConversation(systemPrompt: string, presetId?: string): Conversation {
  return {
    id: createConversationId(),
    title: "新对话",
    createdAt: Date.now(),
    systemPrompt,
    presetId,
    variables: {genre: "", style: ""},
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

/** 估算当前路径的 token 占用（粗略：字符数 / 4，原型标注“估算”）。 */
export function estimatePathTokens(conversation: Conversation): number {
  const chars = resolvePath(conversation)
      .reduce((total, node) => total + node.content.length, 0)
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

export function normalizeConversations(value: unknown): Conversation[] {
  if (!Array.isArray(value)) return [];
  const conversations: Conversation[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    const nodes = record.nodes && typeof record.nodes === "object"
        ? record.nodes as Record<string, MessageNode>
        : {};
    const rootIds = Array.isArray(record.rootIds)
        ? record.rootIds.filter((id): id is string => typeof id === "string")
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
      nodes,
      rootIds,
      activeLeafId,
    });
  }
  return conversations;
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
