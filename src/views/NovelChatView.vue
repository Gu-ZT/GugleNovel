<script setup lang="ts">
import {computed, nextTick, onMounted, ref, watch} from "vue";
import {
  IconBranch,
  IconCheck,
  IconCopy,
  IconDelete,
  IconDownload,
  IconEdit,
  IconLeft,
  IconMenu,
  IconPlus,
  IconRefresh,
  IconRight,
  IconStop,
} from "@arco-design/web-vue/es/icon";
import BranchTreePanel from "../components/BranchTreePanel.vue";
import {useVisualViewport} from "../composables/viewport/visual";
import {renderMarkdown} from "../services/markdown";

const props = defineProps<{app: any}>();
const editingConversationId = ref("");
const editingTitle = ref("");
const conversationDrawerOpen = ref(false);
const configPanelOpen = ref(false);

// Android 原生层已经按 IME inset 缩小 WebView；页面只跟随实际视口高度。
useVisualViewport();
const composerRef = ref<HTMLElement | null>(null);
const composerEditorFocused = ref(false);
let composerScrollTimer: number | null = null;

function isComposerEditor(target: EventTarget | null): boolean {
  return target instanceof HTMLElement
      && Boolean(target.closest(".chat-composer textarea, .chat-composer input"));
}

/** 仅在 WebView 未产生布局 resize 时局部恢复编辑器，避免把整个应用壳滚出屏幕。 */
function ensureFocusedComposerVisible() {
  if (!composerEditorFocused.value || !composerRef.value) return;
  const viewport = window.visualViewport;
  if (!viewport || viewport.height >= window.innerHeight - 1) return;
  const composerRect = composerRef.value.getBoundingClientRect();
  const visibleBottom = viewport.offsetTop + viewport.height;
  if (composerRect.bottom > visibleBottom) {
    document.scrollingElement?.scrollTo({top: 0});
    composerRef.value.scrollIntoView({block: "end", inline: "nearest"});
  }
}

function onComposerFocusIn(event: FocusEvent) {
  composerEditorFocused.value = isComposerEditor(event.target);
  if (!composerEditorFocused.value) return;
  nextTick(ensureFocusedComposerVisible);
  if (composerScrollTimer !== null) window.clearTimeout(composerScrollTimer);
  composerScrollTimer = window.setTimeout(() => {
    composerScrollTimer = null;
    ensureFocusedComposerVisible();
  }, 360);
}

function onComposerFocusOut(event: FocusEvent) {
  const nextTarget = event.relatedTarget;
  if (nextTarget instanceof Node && composerRef.value?.contains(nextTarget)) {
    composerEditorFocused.value = isComposerEditor(nextTarget);
    return;
  }
  composerEditorFocused.value = false;
}

// 消息滚动：切换会话强制滚到底部；流式输出期间仅在用户未上翻时跟随滚动
const messagesRef = ref<HTMLElement | null>(null);
const stickToBottom = ref(true);

function onMessagesScroll() {
  const el = messagesRef.value;
  if (!el) return;
  stickToBottom.value = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
}

function scrollToBottom(force = false) {
  const el = messagesRef.value;
  if (!el || (!force && !stickToBottom.value)) return;
  el.scrollTop = el.scrollHeight;
}

const scrollSignal = computed(() => {
  const path = (props.app.activePath ?? []) as {id: string; content: string; reasoning?: string}[];
  const last = path[path.length - 1];
  return `${path.length}|${last?.content.length ?? 0}|${last?.reasoning?.length ?? 0}`;
});

watch(() => props.app.activeConversationId, () => {
  stickToBottom.value = true;
  nextTick(() => scrollToBottom(true));
});

watch(scrollSignal, () => nextTick(() => scrollToBottom()));

watch(() => props.app.generating, (generating: boolean) => {
  if (!generating) return;
  stickToBottom.value = true;
  nextTick(() => scrollToBottom(true));
});

// 初次进入（含从持久化恢复会话）滚到最新一条
onMounted(() => nextTick(() => scrollToBottom(true)));

function startRename(conversation: any) {
  editingConversationId.value = conversation.id;
  editingTitle.value = conversation.title;
}

function saveRename() {
  if (!editingConversationId.value) return;
  props.app.renameConversation(editingConversationId.value, editingTitle.value);
  editingConversationId.value = "";
  editingTitle.value = "";
}

function selectConversation(id: string) {
  props.app.selectConversation(id);
  conversationDrawerOpen.value = false;
}

function branchInfoFor(nodeId: string) {
  return props.app.activeBranches.find((info: any) => info.node.id === nodeId);
}

/** 该消息是否正在输出（思维链展开中）；输出完毕后思维链折叠 */
function isThinkingMessage(message: any): boolean {
  if (!props.app.generating) return false;
  const path = props.app.activePath ?? [];
  return path[path.length - 1]?.id === message.id;
}
</script>

<template>
  <section class="chat-workspace">
    <div class="chat-main">
      <div class="workspace-toolbar">
        <div class="toolbar-title">
          <a-button type="text" shape="circle" title="作品列表" aria-label="作品列表" @click="conversationDrawerOpen = true"><IconMenu/></a-button>
          <strong>{{ app.activeConversation?.title || '默认标题' }}</strong>
        </div>
        <div class="toolbar-actions">
          <div v-if="app.contextUsage.total > 0" class="context-meter" :title="`上下文估算：${app.contextUsage.used} / ${app.contextUsage.total} tokens（粗略估算）`">
            <span class="context-meter-label">{{ app.contextUsage.used }}/{{ app.contextUsage.total }}</span>
            <a-progress :percent="app.contextUsage.ratio" :show-text="false" :status="app.contextUsage.ratio > 0.9 ? 'danger' : 'normal'" class="context-meter-bar"/>
          </div>
          <a-button type="text" shape="circle" title="导出作品" aria-label="导出作品" :disabled="app.generating || app.activePath.length === 0" @click="app.exportModalOpen = true"><IconDownload/></a-button>
        </div>
      </div>

      <div ref="messagesRef" class="chat-messages" aria-live="polite" @scroll.passive="onMessagesScroll">
        <div class="chat-messages-content">
          <div v-if="app.activePath.length === 0" class="chat-empty">
            <p>向 AI 作家下达第一条写作指令，开始你的小说。</p>
            <p class="chat-empty-hint">例如：写一个雨夜侦探故事的开篇</p>
          </div>
          <article v-for="message in app.activePath" :key="message.id" class="chat-message" :class="message.role">
            <div class="chat-message-header">
              <div class="chat-role">{{ message.role === 'user' ? '你的指令' : 'AI 作家' }}</div>
              <div class="chat-message-tools">
                <template v-if="branchInfoFor(message.id)?.siblings.length > 1">
                  <a-button
                      type="text" shape="circle" size="mini" title="上一分支" aria-label="上一分支"
                      :disabled="branchInfoFor(message.id).index === 0"
                      @click="app.switchBranch(message.id, -1)"
                  ><IconLeft/></a-button>
                  <span class="branch-indicator">{{ branchInfoFor(message.id).index + 1 }}/{{ branchInfoFor(message.id).siblings.length }}</span>
                  <a-button
                      type="text" shape="circle" size="mini" title="下一分支" aria-label="下一分支"
                      :disabled="branchInfoFor(message.id).index === branchInfoFor(message.id).siblings.length - 1"
                      @click="app.switchBranch(message.id, 1)"
                  ><IconRight/></a-button>
                </template>
                <a-button type="text" shape="circle" size="mini" title="编辑（保存为新分支）" aria-label="编辑" :disabled="app.generating" @click="app.startEditMessage(message.id)"><IconEdit/></a-button>
                <a-button v-if="message.role === 'assistant'" type="text" shape="circle" size="mini" title="重新生成（产生新分支）" aria-label="重新生成" :disabled="app.generating" @click="app.regenerateMessage(message.id)"><IconRefresh/></a-button>
                <a-button
                    type="text" shape="circle" size="mini"
                    :title="app.copiedMessageId === message.id ? '已复制' : '复制消息'"
                    :aria-label="app.copiedMessageId === message.id ? '已复制' : '复制消息'"
                    @click="app.copyMessage(message.id, message.content)"
                >
                  <IconCheck v-if="app.copiedMessageId === message.id"/>
                  <IconCopy v-else/>
                </a-button>
                <a-button type="text" shape="circle" size="mini" status="danger" title="删除（连同后续分支）" aria-label="删除" :disabled="app.generating" @click="app.deleteMessage(message.id)"><IconDelete/></a-button>
              </div>
            </div>
            <form v-if="app.editingMessageId === message.id" class="message-edit" @submit.prevent="app.saveEditedMessage">
              <a-textarea v-model="app.editingContent" :auto-size="{minRows: 3, maxRows: 14}"/>
              <div class="message-edit-actions">
                <span class="message-edit-hint">保存将创建新分支，原内容保留</span>
                <a-button size="small" @click="app.cancelEditMessage">取消</a-button>
                <a-button size="small" type="primary" html-type="submit">保存为新分支</a-button>
              </div>
            </form>
            <template v-else>
              <details
                  v-if="message.role === 'assistant' && message.reasoning"
                  class="reasoning-block"
                  :open="isThinkingMessage(message)"
              >
                <summary>{{ isThinkingMessage(message) ? '正在思考…' : '思维链' }}</summary>
                <div class="reasoning-content">{{ message.reasoning }}</div>
              </details>
              <div v-if="message.role === 'assistant'" class="message-content markdown-body" v-html="renderMarkdown(message.content)"></div>
              <p v-else class="message-content">{{ message.content }}</p>
            </template>
            <div v-if="message.modelLabel" class="chat-message-model">{{ message.modelLabel }}</div>
          </article>
          <div v-if="app.generating" class="chat-message assistant chat-thinking">正在创作...</div>
        </div>
      </div>
      <p v-if="app.error" class="error composer-error">{{ app.error }}</p>

      <div
          ref="composerRef"
          class="chat-composer"
          @focusin="onComposerFocusIn"
          @focusout="onComposerFocusOut"
      >
        <div class="composer-config">
          <a-button
              type="text"
              class="composer-config-toggle"
              :aria-expanded="configPanelOpen"
              @click="configPanelOpen = !configPanelOpen"
          >
            <span>模型与配置</span>
            <span class="chevron" :class="{open: configPanelOpen}" aria-hidden="true"></span>
          </a-button>
          <div v-if="configPanelOpen" class="composer-config-panel">
            <div class="field">
              <label>模型</label>
              <a-select
                  v-model="app.modelSelection"
                  :options="app.modelSelectOptions"
                  :disabled="app.modelSelectOptions.length === 0"
                  class="model-provider-select"
                  placeholder="请先在设置中配置提供商与模型"
              >
                <template #label="{data}">
                  <span class="selected-model-label">{{ data.label }}</span>
                  <a-tag v-if="data.providerName" size="small" class="model-provider-tag">{{ data.providerName }}</a-tag>
                </template>
              </a-select>
            </div>
            <div class="field">
              <label>提示词预设</label>
              <div class="preset-picker">
                <a-select
                    :model-value="app.activeConversation?.presetId ?? app.activePresetId"
                    :options="app.presetSelectOptions"
                    placeholder="选择预设并应用到当前会话"
                    class="preset-picker-select"
                    @change="(value: string | number | Record<string, any> | (string | number | Record<string, any>)[]) => app.applyPreset(String(value))"
                />
                <a-button size="small" title="修改当前会话的系统提示词" @click="app.systemPromptEditorOpen = true">编辑提示词</a-button>
              </div>
            </div>
            <div class="composer-config-actions">
              <a-button size="small" @click="app.branchPanelOpen = true; configPanelOpen = false">
                <template #icon><IconBranch/></template>
                分支树
              </a-button>
            </div>
          </div>
        </div>
        <a-textarea v-model="app.draft" :auto-size="{ minRows: 3, maxRows: 8 }" placeholder="输入写作指令，如：续写一段主角发现密信的情节" @keydown.ctrl.enter="app.sendMessage"/>
        <div class="chat-actions">
          <a-button v-if="app.generating" status="danger" class="stop-generation" @click="app.stopGeneration">
            <template #icon><IconStop/></template>
            停止
          </a-button>
          <a-button type="primary" class="chat-send-button" :disabled="app.generating || !app.draft.trim() || !app.modelSelection" @click="app.sendMessage">
            {{ app.generating ? '创作中...' : '发送' }}
          </a-button>
        </div>
      </div>
    </div>

    <a-drawer
        :visible="conversationDrawerOpen"
        title="作品列表"
        placement="left"
        :width="300"
        :footer="false"
        @cancel="conversationDrawerOpen = false"
    >
      <div class="conversation-drawer">
        <a-button type="outline" class="new-conversation-button" :disabled="app.generating" @click="app.createNewConversation(); conversationDrawerOpen = false">
          <IconPlus aria-hidden="true"/><span>新建作品</span>
        </a-button>
        <div class="conversation-drawer-scroll">
          <article
              v-for="conversation in app.conversations"
              :key="conversation.id"
              class="conversation-list-item"
              :class="{ active: app.activeConversationId === conversation.id }"
          >
            <form v-if="editingConversationId === conversation.id" class="conversation-rename" @submit.prevent="saveRename">
              <a-input v-model="editingTitle" autofocus :max-length="80" @keydown.esc="editingConversationId = ''"/>
              <a-button type="text" html-type="submit" title="保存名称" aria-label="保存名称"><IconCheck/></a-button>
            </form>
            <template v-else>
              <button type="button" class="conversation-select" :title="conversation.title" @click="selectConversation(conversation.id)" @dblclick="startRename(conversation)">
                <span class="conversation-title">{{ conversation.title }}</span>
                <span class="conversation-count">{{ Object.keys(conversation.nodes).length }} 个节点</span>
              </button>
              <div class="conversation-item-actions">
                <a-button type="text" shape="circle" title="重命名" aria-label="重命名" @click="startRename(conversation)"><IconEdit/></a-button>
                <a-button type="text" shape="circle" status="danger" title="删除作品" aria-label="删除作品" :disabled="app.generating" @click="app.deleteConversation(conversation.id)"><IconDelete/></a-button>
              </div>
            </template>
          </article>
        </div>
      </div>
    </a-drawer>

    <BranchTreePanel :app="app"/>

    <a-modal
        :visible="app.systemPromptEditorOpen"
        title="会话系统提示词"
        :footer="false"
        @cancel="app.systemPromptEditorOpen = false"
    >
      <div class="system-prompt-editor">
        <p class="field-label">当前会话使用的系统提示词快照（不影响预设）</p>
        <a-textarea
            :model-value="app.activeConversation?.systemPrompt ?? ''"
            :auto-size="{minRows: 8, maxRows: 16}"
            @update:model-value="app.updateSystemPrompt"
        />
        <div class="field-row">
          <div class="field">
            <label>题材变量 <code v-text="'{{genre}}'"/></label>
            <a-input
                :model-value="app.activeConversation?.variables.genre ?? ''"
                placeholder="如：悬疑 / 玄幻 / 科幻"
                @update:model-value="(value: string) => app.updateConversationVariable('genre', value)"
            />
          </div>
          <div class="field">
            <label>文风变量 <code v-text="'{{style}}'"/></label>
            <a-input
                :model-value="app.activeConversation?.variables.style ?? ''"
                placeholder="如：冷峻 / 轻快 / 古典"
                @update:model-value="(value: string) => app.updateConversationVariable('style', value)"
            />
          </div>
        </div>
        <details class="prompt-preview">
          <summary>预览渲染后的提示词</summary>
          <pre>{{ app.renderedSystemPrompt }}</pre>
        </details>
      </div>
    </a-modal>
    <a-modal
        :visible="app.exportModalOpen"
        title="导出作品"
        :footer="false"
        @cancel="app.exportModalOpen = false"
    >
      <div class="export-options">
        <p class="field-label">导出当前浏览路径上的 AI 正文，写作指令不会包含在成书中。</p>
        <a-button long size="large" :loading="app.exporting" @click="app.performExport('txt')">
          导出为 TXT（纯文本）
        </a-button>
        <a-button long size="large" :loading="app.exporting" @click="app.performExport('epub')">
          导出为 EPUB（电子书）
        </a-button>
        <p class="field-label">选择格式后将弹出系统保存对话框指定保存位置；不支持的浏览器会直接下载。</p>
      </div>
    </a-modal>
  </section>
</template>
