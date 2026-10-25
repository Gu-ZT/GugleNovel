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
      <p class="field-label">
        预设决定 AI 作家的创作人格与插图指令。新建作品时使用当前激活预设的快照；会话内可在写作页单独调整。
      </p>
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
          <a-input v-model="app.presetDraftName" placeholder="如：小说作家 / 悬疑专用"/>
        </div>
        <div class="field">
          <label>系统提示词</label>
          <a-textarea v-model="app.presetDraftSystemPrompt" :auto-size="{minRows: 8, maxRows: 16}"/>
        </div>
        <div class="field">
          <label>SFW 插图提示词</label>
          <a-textarea v-model="app.presetDraftSfwIllustrationPrompt" :auto-size="{minRows: 5, maxRows: 12}"/>
          <p class="field-label">
            内容模式为 SFW 且插图开启时追加到系统提示词。要求文本模型自行判断并提交符合全年龄要求的画面描述。
          </p>
        </div>
        <div class="field">
          <label>NSFW 插图提示词</label>
          <a-textarea v-model="app.presetDraftNsfwIllustrationPrompt" :auto-size="{minRows: 5, maxRows: 12}"/>
          <p class="field-label">
            内容模式为 NSFW 且插图开启时追加到系统提示词。若图像模型未标记支持 NSFW，程序会自动再追加一条把生图提示词限制为全年龄的约束。
          </p>
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
              @click="app.savePresetDraft"
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
