<script setup lang="ts">
import {useRouter} from "vue-router";
import {IconDelete, IconEdit, IconLeft, IconPlus} from "@arco-design/web-vue/es/icon";
import {
  CAPABILITY_LABELS,
  MODEL_KIND_LABELS,
  modelDisplayName,
  type ModelCapability,
  type ModelKind,
} from "../../domain/models";

const props = defineProps<{app: any}>();
const router = useRouter();

function capabilityLabel(capability: ModelCapability): string {
  return CAPABILITY_LABELS[capability];
}

function kindLabel(kind: ModelKind): string {
  return MODEL_KIND_LABELS[kind];
}

function removeProvider() {
  const provider = props.app.selectedProvider;
  if (provider) props.app.removeProvider(provider);
}
</script>

<template>
  <section class="settings-page">
    <header class="settings-page-header">
      <div class="settings-subpage-title">
        <a-button type="text" shape="circle" title="返回设置" aria-label="返回设置" @click="router.push({name: 'settings'})"><IconLeft/></a-button>
        <h2>提供商与模型</h2>
      </div>
      <p class="field-label">配置 OpenAI 兼容接口的提供商，以及每个提供商下的文本模型与图像模型。浏览器直连要求提供商允许跨域（CORS）请求；被拦截时请改用支持 CORS 的中转地址。</p>
    </header>

    <div class="provider-layout">
      <aside class="provider-list" aria-label="提供商列表">
        <a-button type="outline" class="new-conversation-button" @click="app.addProvider">
          <IconPlus aria-hidden="true"/><span>新增提供商</span>
        </a-button>
        <article
            v-for="provider in app.connectionProfiles"
            :key="provider.id"
            class="provider-list-item"
            :class="{ active: app.selectedProviderId === provider.id }"
        >
          <button type="button" class="conversation-select" :title="provider.endpoint" @click="app.selectProvider(provider.id)">
            <span class="conversation-title">{{ provider.name }}</span>
            <span class="conversation-count">
              {{ provider.models.filter((m: any) => m.kind === 'text').length }} 个文本模型 ·
              {{ provider.models.filter((m: any) => m.kind === 'image').length }} 个图像模型
            </span>
          </button>
        </article>
      </aside>

      <div v-if="app.selectedProvider" class="provider-detail">
        <div class="field">
          <label>提供商名称</label>
          <a-input v-model="app.draftName" placeholder="如 OpenAI / DeepSeek"/>
        </div>
        <div class="field">
          <label>API 地址（OpenAI 兼容 /v1）</label>
          <a-input v-model="app.draftEndpoint" placeholder="https://api.openai.com/v1"/>
        </div>
        <div class="field">
          <label>API Key</label>
          <a-input-password v-model="app.draftApiKey" placeholder="sk-..."/>
        </div>
        <p v-if="app.draftError" class="error">{{ app.draftError }}</p>
        <div class="provider-draft-actions">
          <a-tag v-if="app.hasUnsavedChanges" color="orange">有未保存修改</a-tag>
          <a-button @click="app.cancelDraft">还原</a-button>
          <a-button type="primary" @click="app.saveDraft">保存</a-button>
          <a-popconfirm content="确定删除该提供商及其全部模型？" @ok="removeProvider">
            <a-button status="danger" :disabled="app.connectionProfiles.length <= 1">
              <template #icon><IconDelete/></template>
              删除提供商
            </a-button>
          </a-popconfirm>
        </div>

        <div class="model-section">
          <div class="model-section-header">
            <h3>模型列表</h3>
            <a-button size="small" type="outline" :disabled="app.draftIsNew" @click="app.openModelModal(app.selectedProvider.id)">
              <template #icon><IconPlus/></template>
              新增模型
            </a-button>
          </div>
          <div v-if="app.selectedProvider.models.length === 0" class="model-list-empty">
            暂无模型，点击“新增模型”添加
          </div>
          <div v-else class="model-list">
            <article v-for="model in app.selectedProvider.models" :key="model.id" class="model-card">
              <div class="model-card-header">
                <strong class="model-card-name">{{ modelDisplayName(model) }}</strong>
                <div class="model-card-actions">
                  <a-button type="text" shape="circle" size="mini" title="编辑模型" aria-label="编辑模型" @click="app.openModelModal(app.selectedProvider.id, model)"><IconEdit/></a-button>
                  <a-popconfirm content="删除该模型？" @ok="app.removeProviderModel(app.selectedProvider.id, model.id)">
                    <a-button type="text" shape="circle" size="mini" status="danger" title="删除模型" aria-label="删除模型"><IconDelete/></a-button>
                  </a-popconfirm>
                </div>
              </div>
              <p v-if="model.description" class="model-description">{{ model.description }}</p>
              <div class="model-card-meta">
                <a-tag size="small" class="capability-tag">{{ kindLabel(model.kind) }}</a-tag>
                <a-tag v-if="model.supportsNsfw" size="small" color="orange" class="capability-tag">NSFW</a-tag>
                <a-tag v-for="capability in model.capabilities" :key="capability" size="small" class="capability-tag">
                  {{ capabilityLabel(capability) }}
                </a-tag>
              </div>
              <div v-if="model.kind === 'text'" class="model-card-meta model-card-limits">
                <span>输入上下文 {{ model.contextLength.toLocaleString() }} tokens</span>
                <span>最大输出 {{ model.maxOutputTokens.toLocaleString() }} tokens</span>
              </div>
            </article>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>
