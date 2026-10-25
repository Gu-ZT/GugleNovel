<script setup lang="ts">
import {
  ALL_CAPABILITIES,
  CAPABILITY_LABELS,
  MODEL_KIND_LABELS,
  type ModelCapability,
  type ModelKind,
} from "../../domain/models";

defineProps<{app: any}>();

function capabilityLabel(capability: ModelCapability): string {
  return CAPABILITY_LABELS[capability];
}

const MODEL_KINDS: ModelKind[] = ["text", "image"];
</script>

<template>
  <teleport to="body">
    <div v-if="app.modelModalOpen" class="modal-backdrop" role="dialog" aria-modal="true">
      <section class="modal-card modal-card-wide">
        <header class="modal-header">
          <strong>{{ app.modelDraftOriginalId ? "编辑模型" : "新增模型" }}</strong>
          <a-button type="text" shape="circle" aria-label="关闭" @click="app.closeModelModal">✕</a-button>
        </header>
        <div class="modal-form">
          <div class="field">
            <label>模型类型</label>
            <a-radio-group
                :model-value="app.modelDraftKind"
                type="button"
                @change="(value: string | number | boolean) => app.setDraftKind(String(value))"
            >
              <a-radio v-for="kind in MODEL_KINDS" :key="kind" :value="kind">
                {{ MODEL_KIND_LABELS[kind] }}
              </a-radio>
            </a-radio-group>
            <p class="field-label">
              文本模型用于续写正文；图像模型只在使用 insert_illustration 工具时按提示词生成插图。
            </p>
          </div>
          <div class="field">
            <label>模型 ID</label>
            <a-input
                v-model="app.modelDraftId"
                :placeholder="app.modelDraftKind === 'image' ? '如 gpt-image-1 / dall-e-3' : '如 gpt-4.1-mini / deepseek-chat'"
            />
          </div>
          <div class="field">
            <label>显示名称</label>
            <a-input v-model="app.modelDraftDisplayName" placeholder="留空则使用模型 ID"/>
          </div>
          <div class="field">
            <label>描述</label>
            <a-input v-model="app.modelDraftDescription" placeholder="可选"/>
          </div>
          <div v-if="app.modelDraftKind === 'text'" class="field">
            <label>模型能力</label>
            <div class="capability-checkboxes">
              <a-checkbox
                  v-for="capability in ALL_CAPABILITIES"
                  :key="capability"
                  :model-value="app.modelDraftCapabilities.includes(capability)"
                  @change="app.toggleDraftCapability(capability)"
              >
                {{ capabilityLabel(capability) }}
              </a-checkbox>
            </div>
            <p class="field-label">勾选“工具调用”后，该模型才可以在正文中触发插图生成。</p>
          </div>
          <div class="field">
            <label>内容限制</label>
            <a-checkbox
                :model-value="app.modelDraftSupportsNsfw"
                @change="app.modelDraftSupportsNsfw = $event"
            >
              该模型允许生成 NSFW 内容
            </a-checkbox>
            <p class="field-label">
              按提供商的实际可用范围勾选。文本模型未勾选时无法在 NSFW 模式下生成；
              图像模型未勾选时，NSFW 模式下的插图提示词会被要求改写为全年龄内容。
            </p>
          </div>
          <div v-if="app.modelDraftKind === 'text'" class="field-row">
            <div class="field">
              <label>输入上下文上限（tokens）</label>
              <a-input-number v-model="app.modelDraftContextLength" :min="1" :step="1024"/>
            </div>
            <div class="field">
              <label>最大输出（tokens）</label>
              <a-input-number v-model="app.modelDraftMaxOutputTokens" :min="1" :step="512"/>
            </div>
          </div>
          <p v-if="app.modelDraftError" class="error">{{ app.modelDraftError }}</p>
        </div>
        <footer class="modal-actions">
          <a-button @click="app.closeModelModal">取消</a-button>
          <a-button type="primary" @click="app.saveModelDraft">保存</a-button>
        </footer>
      </section>
    </div>
  </teleport>
</template>
