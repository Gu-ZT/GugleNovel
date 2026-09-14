<script setup lang="ts">
import {ALL_CAPABILITIES, CAPABILITY_LABELS, type ModelCapability} from "../../domain/models";

defineProps<{app: any}>();

function capabilityLabel(capability: ModelCapability): string {
  return CAPABILITY_LABELS[capability];
}
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
            <label>模型 ID</label>
            <a-input v-model="app.modelDraftId" placeholder="如 gpt-4.1-mini / deepseek-chat"/>
          </div>
          <div class="field">
            <label>显示名称</label>
            <a-input v-model="app.modelDraftDisplayName" placeholder="留空则使用模型 ID"/>
          </div>
          <div class="field">
            <label>描述</label>
            <a-input v-model="app.modelDraftDescription" placeholder="可选"/>
          </div>
          <div class="field">
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
          </div>
          <div class="field-row">
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
