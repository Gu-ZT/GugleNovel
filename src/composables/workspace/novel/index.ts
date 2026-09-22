import {computed, ref, watch} from "vue";
import {
  CONVERSATIONS_KEY,
  createConversation,
  createNodeId,
  estimatePathTokens,
  flattenTree,
  normalizeConversations,
  pathBranches,
  resolvePath,
  siblingsOf,
  subtreeIds,
  type Conversation,
  type MessageNode,
} from "../../../domain/tree";
import {OpenAIConnection} from "../../../api";
import {renderPromptVariables} from "../../../domain/prompts";
import {resolvedModelLabel, type ResolvedModel} from "../../../domain/models";
import {
  isAbortError,
  requestChatCompletion,
  type ChatRequestMessage,
} from "../../../services/transport";
import {buildExport, saveFileToDisk, type ExportFormat} from "../../../services/export";
import {loadJson, saveJson} from "../../../services/storage";
import type {ProviderSettings} from "../../settings/provider";
import type {PromptSettings} from "../../settings/prompt";
import type {GenerationSettings} from "../../settings/generation";

interface NovelWorkspaceOptions {
  provider: ProviderSettings;
  prompt: PromptSettings;
  generation: GenerationSettings;
}

const persistedConversations = loadJson<Conversation[]>(
    CONVERSATIONS_KEY,
    normalizeConversations,
    []
);

export function useNovelWorkspace(options: NovelWorkspaceOptions) {
  const conversations = ref<Conversation[]>(persistedConversations);
  const activeConversationId = ref(conversations.value[0]?.id ?? "");
  const draft = ref("");
  const generating = ref(false);
  const error = ref("");
  const copiedMessageId = ref("");
  const branchPanelOpen = ref(false);
  const editingMessageId = ref("");
  const editingContent = ref("");
  const systemPromptEditorOpen = ref(false);
  const exportModalOpen = ref(false);
  const exporting = ref(false);
  let abortController: AbortController | null = null;
  let copyTimer: number | null = null;

  const activeConversation = computed(() => conversations.value.find(
      (conversation) => conversation.id === activeConversationId.value
  ) ?? conversations.value[0]);

  const activePath = computed(() => activeConversation.value
      ? resolvePath(activeConversation.value)
      : []);

  const activeBranches = computed(() => activeConversation.value
      ? pathBranches(activeConversation.value)
      : []);

  const treeRows = computed(() => activeConversation.value
      ? flattenTree(activeConversation.value)
      : []);

  const resolvedModel = computed(() => options.provider.resolveModelSelection(
      options.provider.modelSelection.value
  ));

  const contextUsage = computed(() => {
    const conversation = activeConversation.value;
    if (!conversation) return {used: 0, total: 0, ratio: 0};
    const total = resolvedModel.value?.model.contextLength ?? 0;
    const used = estimatePathTokens(conversation);
    return {
      used,
      total,
      ratio: total > 0 ? Math.min(1, used / total) : 0,
    };
  });

  watch(conversations, (value) => saveJson(CONVERSATIONS_KEY, value), {deep: true});

  function mutateConversation(id: string, mutate: (conversation: Conversation) => void) {
    conversations.value = conversations.value.map((conversation) => {
      if (conversation.id !== id) return conversation;
      const next: Conversation = {
        ...conversation,
        variables: {...conversation.variables},
        nodes: {...conversation.nodes},
        rootIds: [...conversation.rootIds],
      };
      mutate(next);
      return next;
    });
  }

  function renderSystemPrompt(conversation: Conversation): string {
    return renderPromptVariables(conversation.systemPrompt, {
      date: new Date().toLocaleDateString("zh-CN"),
      time: new Date().toLocaleTimeString("zh-CN", {hour: "2-digit", minute: "2-digit"}),
      model_name: resolvedModel.value?.model.id ?? "",
      genre: conversation.variables.genre || "不限",
      style: conversation.variables.style || "不限",
    });
  }

  function createNewConversation() {
    if (generating.value) return;
    const preset = options.prompt.activePreset.value;
    const conversation = createConversation(preset?.systemPrompt ?? "", preset?.id);
    conversations.value = [...conversations.value, conversation];
    activeConversationId.value = conversation.id;
    editingMessageId.value = "";
    error.value = "";
  }

  function selectConversation(id: string) {
    if (generating.value) return;
    activeConversationId.value = id;
    editingMessageId.value = "";
    error.value = "";
  }

  function renameConversation(id: string, title: string) {
    const trimmed = title.trim();
    if (!trimmed) return;
    mutateConversation(id, (conversation) => { conversation.title = trimmed; });
  }

  function deleteConversation(id: string) {
    conversations.value = conversations.value.filter((conversation) => conversation.id !== id);
    if (activeConversationId.value === id) {
      activeConversationId.value = conversations.value[0]?.id ?? "";
    }
  }

  function updateSystemPrompt(prompt: string) {
    const conversation = activeConversation.value;
    if (!conversation) return;
    mutateConversation(conversation.id, (target) => { target.systemPrompt = prompt; });
  }

  function updateConversationVariable(key: string, value: string) {
    const conversation = activeConversation.value;
    if (!conversation) return;
    mutateConversation(conversation.id, (target) => { target.variables[key] = value; });
  }

  /** 将提示词预设应用到当前会话（覆盖会话级提示词快照）。 */
  function applyPreset(presetId: string) {
    const preset = options.prompt.presets.value.find((item) => item.id === presetId);
    const conversation = activeConversation.value;
    if (!preset || !conversation) return;
    mutateConversation(conversation.id, (target) => {
      target.systemPrompt = preset.systemPrompt;
      target.presetId = preset.id;
    });
  }

  async function performExport(format: ExportFormat) {
    const conversation = activeConversation.value;
    if (!conversation || exporting.value) return;
    exporting.value = true;
    try {
      const {data, filename} = buildExport(conversation, format);
      const saved = await saveFileToDisk(filename, data);
      if (saved) exportModalOpen.value = false;
    } catch {
      error.value = "导出失败，请重试";
    } finally {
      exporting.value = false;
    }
  }

  function appendNode(conversation: Conversation, node: MessageNode) {
    conversation.nodes[node.id] = node;
    if (node.parentId === null) {
      conversation.rootIds.push(node.id);
    } else {
      const parent = conversation.nodes[node.parentId];
      if (parent) {
        parent.childrenIds = [...parent.childrenIds, node.id];
      }
    }
    conversation.activeLeafId = node.id;
  }

  function connectionFor(model: ResolvedModel): OpenAIConnection {
    return new OpenAIConnection(model.provider.endpoint, model.provider.apiKey);
  }

  /** 组装请求消息：渲染后的系统提示词 + 当前路径消息，按模型上下文预算从旧到新裁剪。 */
  function buildRequestMessages(conversation: Conversation): ChatRequestMessage[] {
    const system = renderSystemPrompt(conversation);
    const path = resolvePath(conversation);
    const contextLength = resolvedModel.value?.model.contextLength ?? 128000;
    const charBudget = contextLength * 4; // 粗略估算：1 token ≈ 4 字符
    const messages: ChatRequestMessage[] = [];
    let used = system.length;
    for (let index = path.length - 1; index >= 0; index--) {
      const node = path[index];
      if (used + node.content.length > charBudget && messages.length > 0) break;
      messages.unshift({role: node.role, content: node.content});
      used += node.content.length;
    }
    return [
      ...(system.trim() ? [{role: "system" as const, content: system}] : []),
      ...messages,
    ];
  }

  /** 基于当前活动叶子发起一次真实生成：先构建消息，再追加助手占位节点并流式写入。 */
  function startGeneration(conversationId: string) {
    const model = resolvedModel.value;
    if (!model) {
      error.value = "请先在设置中配置提供商与模型";
      return;
    }
    const conversation = conversations.value.find((item) => item.id === conversationId);
    if (!conversation) return;
    const messages = buildRequestMessages(conversation);
    if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
      error.value = "请先发送写作指令";
      return;
    }
    generating.value = true;
    error.value = "";
    const assistantNode: MessageNode = {
      id: createNodeId(),
      parentId: conversation.activeLeafId || null,
      childrenIds: [],
      role: "assistant",
      content: "",
      modelLabel: resolvedModelLabel(model),
      createdAt: Date.now() + 1,
    };
    mutateConversation(conversationId, (target) => appendNode(target, assistantNode));
    const controller = new AbortController();
    abortController = controller;
    const outputOverride = options.generation.outputTokenOverride.value;
    void requestChatCompletion({
      connection: connectionFor(model),
      model: model.model.id,
      messages,
      temperature: options.generation.temperature.value,
      maxTokens: outputOverride > 0 ? outputOverride : model.model.maxOutputTokens,
      stream: model.model.capabilities.includes("streaming"),
      signal: controller.signal,
      onDelta: (text) => {
        mutateConversation(conversationId, (target) => {
          const node = target.nodes[assistantNode.id];
          if (node) node.content = text;
        });
      },
      onReasoningDelta: (reasoning) => {
        mutateConversation(conversationId, (target) => {
          const node = target.nodes[assistantNode.id];
          if (node) node.reasoning = reasoning;
        });
      },
    }).then((text) => {
      mutateConversation(conversationId, (target) => {
        const node = target.nodes[assistantNode.id];
        if (node && text.trim()) node.content = text;
      });
      void maybeGenerateTitle(conversationId, model);
    }).catch((reason) => {
      if (isAbortError(reason)) {
        mutateConversation(conversationId, (target) => {
          const node = target.nodes[assistantNode.id];
          if (node && !node.content.trim()) node.content = "（已停止，未生成内容）";
        });
      } else {
        error.value = reason instanceof Error ? reason.message : "生成失败，请重试";
        mutateConversation(conversationId, (target) => {
          const node = target.nodes[assistantNode.id];
          if (node && !node.content.trim()) node.content = "（生成失败，可删除本节点后重试）";
        });
      }
    }).finally(() => {
      if (abortController === controller) abortController = null;
      generating.value = false;
    });
  }

  function sendMessage() {
    const conversation = activeConversation.value;
    const content = draft.value.trim();
    if (!conversation || generating.value || !content) return;
    const userNode: MessageNode = {
      id: createNodeId(),
      parentId: conversation.activeLeafId || null,
      childrenIds: [],
      role: "user",
      content,
      createdAt: Date.now(),
    };
    mutateConversation(conversation.id, (target) => appendNode(target, userNode));
    draft.value = "";
    startGeneration(conversation.id);
  }

  function fallbackTitle(conversationId: string) {
    const conversation = conversations.value.find((item) => item.id === conversationId);
    const firstUserMessage = conversation ? resolvePath(conversation).find((node) => node.role === "user") : null;
    if (!conversation || !firstUserMessage || conversation.title !== "新对话") return;
    mutateConversation(conversationId, (target) => {
      target.title = firstUserMessage.content.trim().split("\n", 1)[0].slice(0, 24) || target.title;
    });
  }

  /** 首轮对话后用当前模型生成真实标题，失败时降级为首句截断。 */
  async function maybeGenerateTitle(conversationId: string, model: ResolvedModel) {
    if (!options.generation.autoTitle.value) return;
    const conversation = conversations.value.find((item) => item.id === conversationId);
    if (!conversation || conversation.title !== "新对话") return;
    const path = resolvePath(conversation);
    const firstUser = path.find((node) => node.role === "user");
    if (!firstUser) return;
    const firstAssistant = path.find((node) => node.role === "assistant");
    try {
      const title = await requestChatCompletion({
        connection: connectionFor(model),
        model: model.model.id,
        messages: [
          {
            role: "system",
            content: "根据第一轮对话生成一个简短中文标题。只返回标题，不要引号、标点说明或其他内容，最多 20 个汉字。",
          },
          {
            role: "user",
            content: `用户: ${firstUser.content}\n\n助手: ${(firstAssistant?.content ?? "").slice(0, 600)}`,
          },
        ],
        stream: false,
        signal: new AbortController().signal,
      });
      const cleaned = title.replace(/^[\s"'“”]+|[\s"'“”]+$/g, "").split("\n", 1)[0].slice(0, 40);
      mutateConversation(conversationId, (target) => {
        if (target.title === "新对话" && cleaned) target.title = cleaned;
      });
    } catch {
      fallbackTitle(conversationId);
    }
  }

  function stopGeneration() {
    abortController?.abort();
  }

  /** 重新生成某个助手回复：活动叶子回退到其父节点，新增兄弟分支并流式生成。 */
  function regenerateMessage(nodeId: string) {
    const conversation = activeConversation.value;
    if (!conversation || generating.value) return;
    const node = conversation.nodes[nodeId];
    if (!node || node.role !== "assistant" || !node.parentId) return;
    mutateConversation(conversation.id, (target) => { target.activeLeafId = node.parentId!; });
    startGeneration(conversation.id);
  }

  /** 编辑消息：保存时克隆为新兄弟节点（编辑即分支）。 */
  function startEditMessage(nodeId: string) {
    const node = activeConversation.value?.nodes[nodeId];
    if (!node || generating.value) return;
    editingMessageId.value = nodeId;
    editingContent.value = node.content;
  }

  function cancelEditMessage() {
    editingMessageId.value = "";
    editingContent.value = "";
  }

  function saveEditedMessage() {
    const conversation = activeConversation.value;
    const node = conversation?.nodes[editingMessageId.value];
    const content = editingContent.value.trim();
    if (!conversation || !node || !content || generating.value) {
      cancelEditMessage();
      return;
    }
    const branch: MessageNode = {
      id: createNodeId(),
      parentId: node.parentId,
      childrenIds: [],
      role: node.role,
      content,
      modelLabel: node.modelLabel,
      createdAt: Date.now(),
    };
    mutateConversation(conversation.id, (target) => appendNode(target, branch));
    cancelEditMessage();
    // 编辑写作指令（用户消息）后自动让 AI 基于新指令重新创作；
    // 编辑 AI 正文不触发生成，仅保留为人工修订分支。
    if (branch.role === "user") {
      startGeneration(conversation.id);
    }
  }

  /** 切换分支：将活动叶子指向所选兄弟分支的最深叶子。 */
  function switchBranch(nodeId: string, direction: -1 | 1) {
    const conversation = activeConversation.value;
    const node = conversation?.nodes[nodeId];
    if (!conversation || !node) return;
    const siblings = siblingsOf(conversation, node);
    const index = siblings.findIndex((item) => item.id === node.id);
    const target = siblings[index + direction];
    if (!target) return;
    let leaf = target.id;
    let guard = 0;
    while (guard++ < 10000) {
      const current = conversation.nodes[leaf];
      if (!current || current.childrenIds.length === 0) break;
      leaf = current.childrenIds[0];
    }
    mutateConversation(conversation.id, (item) => { item.activeLeafId = leaf; });
  }

  /** 从分支面板跳转到任意节点：活动叶子指向该节点子树最深叶子。 */
  function focusNode(nodeId: string) {
    const conversation = activeConversation.value;
    if (!conversation || !conversation.nodes[nodeId]) return;
    let leaf = nodeId;
    let guard = 0;
    while (guard++ < 10000) {
      const current = conversation.nodes[leaf];
      if (!current || current.childrenIds.length === 0) break;
      leaf = current.childrenIds[0];
    }
    mutateConversation(conversation.id, (item) => { item.activeLeafId = leaf; });
  }

  function deleteMessage(nodeId: string) {
    const conversation = activeConversation.value;
    if (!conversation || generating.value) return;
    const node = conversation.nodes[nodeId];
    if (!node) return;
    const removed = new Set(subtreeIds(conversation, nodeId));
    mutateConversation(conversation.id, (target) => {
      for (const id of removed) delete target.nodes[id];
      if (node.parentId === null) {
        target.rootIds = target.rootIds.filter((id) => id !== nodeId);
      } else {
        const parent = target.nodes[node.parentId];
        if (parent) parent.childrenIds = parent.childrenIds.filter((id) => id !== nodeId);
      }
      if (removed.has(target.activeLeafId)) {
        target.activeLeafId = node.parentId ?? "";
      }
    });
  }

  async function copyMessage(nodeId: string, content: string) {
    try {
      await navigator.clipboard.writeText(content);
    } catch (clipboardError) {
      // Android WebView 常因缺少剪贴板权限拒绝 navigator.clipboard，降级 execCommand
      console.warn("navigator.clipboard 不可用，降级 execCommand 复制：", clipboardError);
      const textarea = document.createElement("textarea");
      textarea.value = content;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      let copied = false;
      try {
        copied = document.execCommand("copy");
      } catch (execError) {
        console.error("execCommand 复制失败：", execError);
      }
      textarea.remove();
      if (!copied) {
        error.value = "复制消息失败，请检查系统剪贴板权限";
        return;
      }
    }
    copiedMessageId.value = nodeId;
    if (copyTimer !== null) window.clearTimeout(copyTimer);
    copyTimer = window.setTimeout(() => {
      copiedMessageId.value = "";
      copyTimer = null;
    }, 1600);
  }

  return {
    conversations,
    activeConversationId,
    activeConversation,
    activePath,
    activeBranches,
    treeRows,
    branchPanelOpen,
    draft,
    generating,
    error,
    copiedMessageId,
    editingMessageId,
    editingContent,
    systemPromptEditorOpen,
    exportModalOpen,
    exporting,
    resolvedModel,
    contextUsage,
    renderedSystemPrompt: computed(() => activeConversation.value
        ? renderSystemPrompt(activeConversation.value)
        : ""),
    createNewConversation,
    selectConversation,
    renameConversation,
    deleteConversation,
    updateSystemPrompt,
    updateConversationVariable,
    applyPreset,
    performExport,
    sendMessage,
    stopGeneration,
    regenerateMessage,
    startEditMessage,
    cancelEditMessage,
    saveEditedMessage,
    switchBranch,
    focusNode,
    deleteMessage,
    copyMessage,
  };
}

export type NovelWorkspace = ReturnType<typeof useNovelWorkspace>;
