<script setup lang="ts">
import {useRouter} from "vue-router";
import {IconLeft} from "@arco-design/web-vue/es/icon";
import {CONTENT_MODE_LABELS, type ContentMode} from "../../domain/prompts";
import {
  DEFAULT_ILLUSTRATION_PARAGRAPH_INTERVAL,
  MAX_ILLUSTRATION_PARAGRAPH_INTERVAL,
  MIN_ILLUSTRATION_PARAGRAPH_INTERVAL,
} from "../../composables/settings/generation";

defineProps<{app: any}>();
const router = useRouter();

const CONTENT_MODES: ContentMode[] = ["sfw", "nsfw"];
</script>

<template>
  <section class="settings-page">
    <header class="settings-page-header">
      <div class="settings-subpage-title">
        <a-button type="text" shape="circle" title="返回设置" aria-label="返回设置" @click="router.push({name: 'settings'})"><IconLeft/></a-button>
        <h2>生成设置</h2>
      </div>
      <p class="field-label">控制正文生成参数与插图策略。插图由文本模型通过工具调用触发，并插入正文中间。</p>
    </header>

    <div class="general-settings">
      <div class="field">
        <label>温度（temperature）：{{ app.temperature.toFixed(1) }}</label>
        <a-slider v-model="app.temperature" :min="0" :max="2" :step="0.1" :marks="{0: '精确', 1: '均衡', 2: '发散'}"/>
        <p class="field-label">越高越有创造性，越低越稳定。小说创作建议 0.7–1.2。</p>
      </div>
      <div class="field">
        <label>单次输出上限覆盖（tokens，0 = 跟随模型配置）</label>
        <a-input-number v-model="app.outputTokenOverride" :min="0" :max="128000" :step="512"/>
      </div>
      <div class="field">
        <a-checkbox :model-value="app.autoTitle" @change="app.autoTitle = $event">首轮对话后自动生成作品标题</a-checkbox>
      </div>

      <div class="field">
        <label>内容模式</label>
        <a-radio-group v-model="app.contentMode" type="button">
          <a-radio v-for="mode in CONTENT_MODES" :key="mode" :value="mode">
            {{ CONTENT_MODE_LABELS[mode] }}
          </a-radio>
        </a-radio-group>
        <p class="field-label">
          SFW 模式下由文本模型自行判断生图提示词是否符合全年龄要求；
          NSFW 模式下正文与插图可以保持成人向尺度，但仍要求模型避开未成年人、性暴力与极端伤害内容。
        </p>
      </div>

      <div class="field">
        <a-checkbox :model-value="app.illustrationEnabled" @change="app.illustrationEnabled = $event">
          在正文中生成插图
        </a-checkbox>
        <p class="field-label">开启后文本模型会获得 insert_illustration 工具，可自行决定插图时机与画面描述。</p>
      </div>

      <template v-if="app.illustrationEnabled">
        <div class="field">
          <label>图像模型</label>
          <a-select
              v-model="app.imageModelSelection"
              :options="app.imageModelSelectOptions"
              :disabled="app.imageModelSelectOptions.length === 0"
              placeholder="请先在提供商设置中添加图像模型"
          />
        </div>
        <div class="field">
          <label>插图间隔：每 {{ app.illustrationParagraphInterval }} 个正文段落最多 1 张</label>
          <a-slider
              v-model="app.illustrationParagraphInterval"
              :min="MIN_ILLUSTRATION_PARAGRAPH_INTERVAL"
              :max="MAX_ILLUSTRATION_PARAGRAPH_INTERVAL"
              :step="1"
              :marks="{1: '1', [DEFAULT_ILLUSTRATION_PARAGRAPH_INTERVAL]: '默认', [MAX_ILLUSTRATION_PARAGRAPH_INTERVAL]: String(MAX_ILLUSTRATION_PARAGRAPH_INTERVAL)}"
          />
          <p class="field-label">
            段落以空行分隔。未达到间隔时的插图调用会被拒绝并回告文本模型，由它继续写正文。
          </p>
        </div>
        <p v-if="app.illustrationStatus.warning" class="error">{{ app.illustrationStatus.warning }}</p>
        <p v-else-if="app.illustrationStatus.blocking" class="error">{{ app.illustrationStatus.blocking }}</p>
      </template>
    </div>
  </section>
</template>
