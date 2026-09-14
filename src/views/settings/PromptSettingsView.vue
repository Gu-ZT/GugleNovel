<script setup lang="ts">
import {useRouter} from "vue-router";
import {IconDelete, IconLeft, IconPlus} from "@arco-design/web-vue/es/icon";
import {PROMPT_VARIABLES} from "../../domain/prompts";

defineProps<{app: any}>();
const router = useRouter();
</script>

<template>
  <section class="settings-page">
    <header class="settings-page-header">
      <div class="settings-subpage-title">
        <a-button type="text" shape="circle" title="返回设置" aria-label="返回设置" @click="router.push({name: 'settings'})"><IconLeft/></a-button>
        <h2>系统提示词预设</h2>
      </div>
      <p class="field-label">预设决定 AI 作家的创作人格。新建作品时使用当前激活预设的快照；会话内可在写作页单独调整。</p>
    </header>

    <div class="provider-layout">
      <aside class="provider-list" aria-label="预设列表">
        <a-button type="outline" class="new-conversation-button" @click="app.addPreset">
          <IconPlus aria-hidden="true"/><span>新增预设</span>
        </a-button>
        <article
            v-for="preset in app.presets"
            :key="preset.id"
            class="provider-list-item"
            :class="{ active: app.editingPresetId === preset.id }"
        >
          <button type="button" class="conversation-select" @click="app.selectPreset(preset.id)">
            <span class="conversation-title">
              {{ preset.name }}
              <a-tag v-if="app.activePresetId === preset.id" size="small" color="arcoblue">激活</a-tag>
            </span>
            <span class="conversation-count">{{ preset.systemPrompt.length }} 字</span>
          </button>
        </article>
      </aside>

      <div class="provider-detail">
        <div class="field">
          <label>预设名称</label>
          <a-input v-model="app.draftName" placeholder="如：小说作家 / 悬疑专用"/>
        </div>
        <div class="field">
          <label>系统提示词</label>
          <a-textarea v-model="app.draftSystemPrompt" :auto-size="{minRows: 10, maxRows: 20}"/>
        </div>
        <div class="prompt-variables">
          <span class="field-label">可用变量：</span>
          <a-tooltip v-for="variable in PROMPT_VARIABLES" :key="variable.token" :content="variable.description">
            <code class="prompt-variable-token">{{ variable.token }}</code>
          </a-tooltip>
        </div>
        <div class="provider-draft-actions">
          <a-button
              type="primary"
              :disabled="!app.editingPresetId"
              @click="app.saveDraft"
          >保存预设</a-button>
          <a-button
              :disabled="!app.editingPresetId || app.activePresetId === app.editingPresetId"
              @click="app.setActivePreset(app.editingPresetId)"
          >设为激活预设</a-button>
          <a-popconfirm content="删除该预设？" @ok="app.removePreset(app.editingPresetId)">
            <a-button status="danger" :disabled="app.presets.find((p: any) => p.id === app.editingPresetId)?.isDefault">
              <template #icon><IconDelete/></template>
              删除
            </a-button>
          </a-popconfirm>
        </div>
      </div>
    </div>
  </section>
</template>
