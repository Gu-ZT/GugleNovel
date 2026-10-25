import {computed, ref, watch} from "vue";
import {
  ACTIVE_CONVERSATION_KEY,
  CONVERSATIONS_KEY,
  appendImageSegment,
  appendTextSegment,
  completeImageSegment,
  conversationImageIds,
  createConversation,
  createNodeId,
  estimatePathTokens,
  failImageSegment,
  flattenTree,
  messageText,
  normalizeConversations,
  pathBranches,
  resolvePath,
  siblingsOf,
  subtreeIds,
  type Conversation,
  type ImageSegment,
  type MessageNode,
} from "../../../domain/tree";
import {OpenAIConnection} from "../../../api";
import {
  renderPromptVariables,
  type ContentMode,
  type PromptPreset,
} from "../../../domain/prompts";
import {resolvedModelLabel, type ResolvedModel} from "../../../domain/models";
import {isAbortError, requestChatCompletion} from "../../../services/transport";
import {buildExport, saveFileToDisk, type ExportFormat} from "../../../services/export";
import {deleteImages} from "../../../services/image/store";
import {loadJson, saveJson} from "../../../services/storage";
import type {ProviderSettings} from "../../settings/provider";
import type {PromptSettings} from "../../settings/prompt";
import type {GenerationSettings} from "../../settings/generation";
import {
  buildRequestMessages,
  composeSystemPrompt,
  runGeneration,
  type GenerationOptions,
} from "./generation";

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

const persistedActiveConversationId = loadJson<string | null>(
    ACTIVE_CONVERSATION_KEY,
    (value) => typeof value === "string" ? value : null,
    null
);

export function useNovelWorkspace(options: NovelWorkspaceOptions) {
  const conversations = ref<Conversation[]>(persistedConversations);
  const activeConversationId = ref<string>("");
  const initialConversation = conversations.value.find(
      (conversation) => conversation.id === persistedActiveConversationId
  ) ?? conversations.value[0];
  activeConversationId.value = initialConversation?.id ?? "";
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

  const resolvedImageModel = computed(() => options.provider.resolveImageModelSelection(
      options.provider.imageModelSelection.value
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
  watch(activeConversationId, (id) => {
    if (id && conversations.value.some((conversation) => conversation.id === id)) {
      saveJson(ACTIVE_CONVERSATION_KEY, id);
    } else {
      try {
        localStorage.removeItem(ACTIVE_CONVERSATION_KEY);
      } catch {
        // 隐私模式或存储不可用时保持内存态
      }
    }
  });

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
    return renderPromptVariables(conversation.systemPrompt, promptVariables(conversation));
  }

  function promptVariables(conversation: Conversation): Record<string, string> {
    return {
      date: new Date().toLocaleDateString("zh-CN"),
      time: new Date().toLocaleTimeString("zh-CN", {hour: "2-digit", minute: "2-digit"}),
      model_name: resolvedModel.value?.model.id ?? "",
      genre: conversation.variables.genre || "不限",
      style: conversation.variables.style || "不限",
    };
  }

  /** 会话当前生效的生图提示词：优先会话快照，空值或缺省时回落到激活预设。 */
  function illustrationPromptFor(conversation: Conversation, mode: ContentMode): string {
    const snapshot = conversation.illustrationPrompts;
    const preset = options.prompt.activePreset.value;
    const saved = mode === "nsfw" ? snapshot?.nsfw : snapshot?.sfw;
    const fallback = mode === "nsfw" ? preset?.nsfwIllustrationPrompt : preset?.sfwIllustrationPrompt;
    // 空串视为未配置，否则编辑会话提示词后会挡住预设回落
    const source = saved && saved.trim() ? saved : fallback;
    return renderPromptVariables(source ?? "", promptVariables(conversation));
  }

  function presetSnapshot(preset: PromptPreset | undefined): {sfw: string; nsfw: string} | undefined {
    if (!preset) return undefined;
    return {sfw: preset.sfwIllustrationPrompt, nsfw: preset.nsfwIllustrationPrompt};
  }

  function createNewConversation() {
    if (generating.value) return;
    const preset = options.prompt.activePreset.value;
    const conversation = createConversation(
        preset?.systemPrompt ?? "",
        preset?.id,
        presetSnapshot(preset)
    );
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

  async function deleteConversation(id: string) {
    if (generating.value) return;
    const target = conversations.value.find((conversation) => conversation.id === id);
    const removedImageIds = target ? new Set(conversationImageIds(target)) : new Set<string>();
    const remaining = conversations.value.filter((conversation) => conversation.id !== id);
    conversations.value = remaining;
    if (activeConversationId.value === id) {
      activeConversationId.value = remaining[0]?.id ?? "";
    }
    if (removedImageIds.size > 0) await pruneImages(removedImageIds);
  }

  function updateSystemPrompt(prompt: string) {
    const conversation = activeConversation.value;
    if (!conversation) return;
    mutateConversation(conversation.id, (target) => { target.systemPrompt = prompt; });
  }

  function updateIllustrationPrompt(mode: ContentMode, prompt: string) {
    const conversation = activeConversation.value;
    if (!conversation) return;
    // 旧会话没有快照时先补齐两种模式的当前生效值，避免编辑一种模式把另一种写成空串
    const current = conversation.illustrationPrompts ?? {
      sfw: illustrationPromptFor(conversation, "sfw"),
      nsfw: illustrationPromptFor(conversation, "nsfw"),
    };
    mutateConversation(conversation.id, (target) => {
      target.illustrationPrompts = mode === "nsfw"
          ? {...current, nsfw: prompt}
          : {...current, sfw: prompt};
    });
  }

  function updateConversationVariable(key: string, value: string) {
    const conversation = activeConversation.value;
    if (!conversation) return;
    mutateConversation(conversation.id, (target) => { target.variables[key] = value; });
  }

  /** 将提示词预设应用到当前会话（覆盖会话级提示词与生图提示词快照）。 */
  function applyPreset(presetId: string) {
    const preset = options.prompt.presets.value.find((item) => item.id === presetId);
    const conversation = activeConversation.value;
    if (!preset || !conversation) return;
    mutateConversation(conversation.id, (target) => {
      target.systemPrompt = preset.systemPrompt;
      target.presetId = preset.id;
      target.illustrationPrompts = {
        sfw: preset.sfwIllustrationPrompt,
        nsfw: preset.nsfwIllustrationPrompt,
      };
    });
  }

  async function performExport(format: ExportFormat) {
    const conversation = activeConversation.value;
    if (!conversation || exporting.value) return;
    exporting.value = true;
    error.value = "";
    try {
      const {data, filename} = await buildExport(conversation, format);
      const saved = await saveFileToDisk(filename, data);
      if (saved) exportModalOpen.value = false;
    } catch (exportError) {
      error.value = exportError instanceof Error ? exportError.message : "导出失败，请重试";
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

  /**
   * 插图配置检查：返回给用户看的提示与是否需要阻断生成。
   * 除 NSFW 正文能力缺失外，其余问题都降级为只写正文，避免整体拦死生成。
   */
  const illustrationStatus = computed(() => {
    const generation = options.generation;
    const model = resolvedModel.value;
    const imageModel = resolvedImageModel.value;
    // NSFW 正文能力与插图开关无关：主模型未标记支持时禁止发出成人向正文
    if (generation.contentMode.value === "nsfw" && !model?.model.supportsNsfw) {
      return {
        blocking: "当前内容模式为 NSFW，但当前文本模型未标记支持 NSFW，请更换模型或切回 SFW",
        warning: "",
      };
    }
    if (!generation.illustrationEnabled.value) {
      return {blocking: "", warning: ""};
    }
    if (!model) {
      return {blocking: "", warning: ""};
    }
    // 主模型缺少工具能力时插图一定无法触发，此提示优先于图像模型配置
    if (!model.model.capabilities.includes("tools")) {
      return {blocking: "", warning: "插图功能已开启，但当前文本模型未标记支持工具调用，本次只生成正文"};
    }
    if (!imageModel) {
      return {blocking: "", warning: "插图功能已开启，但尚未选择图像模型，本次只生成正文"};
    }
    if (generation.contentMode.value === "nsfw" && !imageModel.model.supportsNsfw) {
      return {
        blocking: "",
        warning: "图像模型未标记支持 NSFW：正文保持成人向，插图提示词会被要求改写为全年龄内容",
      };
    }
    return {blocking: "", warning: ""};
  });

  function startGeneration(conversationId: string) {
    const model = resolvedModel.value;
    if (!model) {
      error.value = "请先在设置中配置提供商与模型";
      return;
    }
    const conversation = conversations.value.find((item) => item.id === conversationId);
    if (!conversation) return;
    const generation = options.generation;
    // NSFW 正文要求主模型标记支持；其余插图问题降级为只写正文
    const status = illustrationStatus.value;
    if (status.blocking) {
      error.value = status.blocking;
      return;
    }
    const options_: GenerationOptions = {
      model,
      connection: connectionFor(model),
      temperature: generation.temperature.value,
      maxTokens: generation.outputTokenOverride.value > 0
          ? generation.outputTokenOverride.value
          : model.model.maxOutputTokens,
      stream: model.model.capabilities.includes("streaming"),
      systemPrompt: renderSystemPrompt(conversation),
      illustration: {
        enabled: generation.illustrationEnabled.value,
        contentMode: generation.contentMode.value,
        paragraphInterval: generation.illustrationParagraphInterval.value,
        systemPrompt: illustrationPromptFor(conversation, generation.contentMode.value),
        imageModel: resolvedImageModel.value,
      },
    };
    const systemPrompt = composeSystemPrompt(options_);
    const messages = buildRequestMessages(conversation, systemPrompt, model.model.contextLength);
    if (messages.length === 0 || messages[messages.length - 1].role !== "user") {
      error.value = "请先发送写作指令";
      return;
    }
    generating.value = true;
    error.value = status.warning;
    const assistantNode: MessageNode = {
      id: createNodeId(),
      parentId: conversation.activeLeafId || null,
      childrenIds: [],
      role: "assistant",
      segments: [],
      modelLabel: resolvedModelLabel(model),
      createdAt: Date.now() + 1,
    };
    mutateConversation(conversationId, (target) => appendNode(target, assistantNode));
    const controller = new AbortController();
    abortController = controller;
    void runGeneration(options_, messages, controller.signal, {
      onTextDelta: (delta) => {
        mutateConversation(conversationId, (target) => {
          const node = target.nodes[assistantNode.id];
          if (node) appendTextSegment(node, delta);
        });
      },
      onReasoning: (reasoning) => {
        mutateConversation(conversationId, (target) => {
          const node = target.nodes[assistantNode.id];
          if (node) node.reasoning = reasoning;
        });
      },
      onIllustrationStart: (start) => {
        mutateConversation(conversationId, (target) => {
          const node = target.nodes[assistantNode.id];
          if (node) appendImageSegment(node, start.prompt, start.meta, start.toolCallId);
        });
      },
      onIllustrationReady: (ready) => {
        mutateConversation(conversationId, (target) => {
          const node = target.nodes[assistantNode.id];
          if (!node) return;
          const segment = findPendingImageSegment(node, ready.callIndex);
          if (segment) {
            completeImageSegment(node, segment, ready.imageId, ready.durationMs);
            return;
          }
          // 找不到对应卡片时图片已成为孤儿，记录以便排查本地存储占用
          console.warn("插图未能回填到消息卡片：", {
            imageId: ready.imageId,
            callIndex: ready.callIndex,
          });
        });
      },
      onIllustrationFailed: (failed) => {
        mutateConversation(conversationId, (target) => {
          const node = target.nodes[assistantNode.id];
          if (!node) return;
          const segment = findPendingImageSegment(node, failed.callIndex);
          if (segment) failImageSegment(node, segment, failed.reason, failed.durationMs);
        });
        if (!error.value) error.value = `插图生成失败：${failed.reason}`;
      },
    }).then(() => {
      // 用户停止后不应再触发标题生成，保持停止语义完整
      if (controller.signal.aborted) return;
      void maybeGenerateTitle(conversationId, model);
    }).catch((reason) => {
      if (isAbortError(reason)) {
        mutateConversation(conversationId, (target) => {
          const node = target.nodes[assistantNode.id];
          if (node && messageText(node).trim().length === 0) {
            appendTextSegment(node, "（已停止，未生成内容）");
          }
        });
      } else {
        error.value = reason instanceof Error ? reason.message : "生成失败，请重试";
        mutateConversation(conversationId, (target) => {
          const node = target.nodes[assistantNode.id];
          if (node && messageText(node).trim().length === 0) {
            appendTextSegment(node, "（生成失败，可删除本节点后重试）");
          }
        });
      }
    }).finally(() => {
      if (abortController === controller) abortController = null;
      generating.value = false;
      // 中断或异常会让还在等待的卡片停在生成中，收尾时统一标记为失败
      mutateConversation(conversationId, (target) => {
        const node = target.nodes[assistantNode.id];
        if (node) failPendingImageSegments(node, controller.signal.aborted ? "已停止生成" : "生成被中断");
      });
    });
  }

  /** 把仍处于生成中的插图卡片标记为失败，避免界面永久显示进度。 */
  function failPendingImageSegments(node: MessageNode, reason: string) {
    for (const segment of node.segments) {
      if (segment.type === "image" && segment.status === "pending") {
        failImageSegment(node, segment, reason);
      }
    }
  }

  /** 定位待回填的插图卡片：调用序号在同一回复内唯一，据此匹配。 */
  function findPendingImageSegment(node: MessageNode, callIndex: number): ImageSegment | undefined {
    for (let index = node.segments.length - 1; index >= 0; index--) {
      const segment = node.segments[index];
      if (segment.type !== "image" || segment.status !== "pending") continue;
      if (segment.meta?.callIndex === callIndex) return segment;
    }
    return undefined;
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
      segments: [{type: "text", text: content}],
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
    const firstLine = messageText(firstUserMessage).trim().split("\n", 1)[0].slice(0, 24);
    mutateConversation(conversationId, (target) => {
      target.title = firstLine || target.title;
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
            content: `用户: ${messageText(firstUser)}\n\n助手: ${firstAssistant ? messageText(firstAssistant).slice(0, 600) : ""}`,
          },
        ],
        stream: false,
        signal: new AbortController().signal,
      });
      const cleaned = title.text.replace(/^[\s"'“”]+|[\s"'“”]+$/g, "").split("\n", 1)[0].slice(0, 40);
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
    // 配置阻断时不要先回退活动叶子，否则原回复会从当前路径上消失
    if (illustrationStatus.value.blocking) {
      error.value = illustrationStatus.value.blocking;
      return;
    }
    mutateConversation(conversation.id, (target) => { target.activeLeafId = node.parentId!; });
    startGeneration(conversation.id);
  }

  /** 编辑消息：保存时克隆为新兄弟节点（编辑即分支）。 */
  function startEditMessage(nodeId: string) {
    const node = activeConversation.value?.nodes[nodeId];
    if (!node || generating.value) return;
    editingMessageId.value = nodeId;
    editingContent.value = messageText(node);
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
      segments: [{type: "text", text: content}],
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

  async function deleteMessage(nodeId: string) {
    const conversation = activeConversation.value;
    if (!conversation || generating.value) return;
    const node = conversation.nodes[nodeId];
    if (!node) return;
    const removed = new Set(subtreeIds(conversation, nodeId));
    const removedImageIds = new Set<string>();
    for (const id of removed) {
      const removedNode = conversation.nodes[id];
      if (!removedNode) continue;
      for (const segment of removedNode.segments) {
        // 未完成或失败的卡片没有图片引用，不能进入待删除集合
        if (segment.type === "image" && segment.imageId) removedImageIds.add(segment.imageId);
      }
    }
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
    await pruneImages(removedImageIds);
  }

  /**
   * 删除不再被任何会话引用的图片。只在删除动作后调用，
   * 保证被其他分支共享的图片不会被误删。
   */
  async function pruneImages(candidateIds: Set<string>) {
    if (candidateIds.size === 0) return;
    const stillReferenced = new Set<string>();
    for (const conversation of conversations.value) {
      for (const id of conversationImageIds(conversation)) stillReferenced.add(id);
    }
    const orphans = [...candidateIds].filter((id) => !stillReferenced.has(id));
    if (orphans.length === 0) return;
    const failed = await deleteImages(orphans);
    if (failed.length > 0) {
      console.warn("部分插图未能从本地仓库删除：", failed);
    }
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
    resolvedImageModel,
    illustrationStatus,
    contextUsage,
    renderedSystemPrompt: computed(() => activeConversation.value
        ? renderSystemPrompt(activeConversation.value)
        : ""),
    renderedIllustrationPrompt: computed(() => activeConversation.value
        ? illustrationPromptFor(activeConversation.value, options.generation.contentMode.value)
        : ""),
    createNewConversation,
    selectConversation,
    renameConversation,
    deleteConversation,
    updateSystemPrompt,
    updateIllustrationPrompt,
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
