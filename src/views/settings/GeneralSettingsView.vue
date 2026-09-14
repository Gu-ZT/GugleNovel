<script setup lang="ts">
import {useRouter} from "vue-router";
import {IconLeft} from "@arco-design/web-vue/es/icon";

defineProps<{app: any}>();
const router = useRouter();
</script>

<template>
  <section class="settings-page">
    <header class="settings-page-header">
      <div class="settings-subpage-title">
        <a-button type="text" shape="circle" title="返回设置" aria-label="返回设置" @click="router.push({name: 'settings'})"><IconLeft/></a-button>
        <h2>生成设置</h2>
      </div>
      <p class="field-label">以下为原型占位配置，接入真实模型后生效。</p>
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
    </div>
  </section>
</template>
