<script setup lang="ts">
import {computed} from "vue";
import {RouterView, useRoute, useRouter} from "vue-router";
import {IconRight} from "@arco-design/web-vue/es/icon";

defineProps<{app: any}>();

const route = useRoute();
const router = useRouter();

const isHome = computed(() => route.name === "settings");

const MENU = [
  {key: "settings-providers", label: "提供商与模型", description: "接口地址、API Key、模型能力与上下文"},
  {key: "settings-prompt", label: "系统提示词", description: "AI 作家的创作人格预设"},
  {key: "settings-general", label: "生成设置", description: "温度、输出上限等生成参数"},
];
</script>

<template>
  <section class="settings-workspace">
    <div class="settings-scroll">
      <template v-if="isHome">
        <header class="settings-home-header">
          <h2>设置</h2>
        </header>
        <div class="settings-list">
          <a-button
              v-for="item in MENU"
              :key="item.key"
              type="text"
              class="settings-list-item"
              @click="router.push({name: item.key})"
          >
            <span class="settings-list-item-text">
              <span class="settings-list-item-label">{{ item.label }}</span>
              <span class="settings-list-item-description">{{ item.description }}</span>
            </span>
            <IconRight class="settings-list-item-arrow" aria-hidden="true"/>
          </a-button>
        </div>
      </template>
      <RouterView v-else v-slot="{ Component }">
        <component :is="Component" :app="app"/>
      </RouterView>
    </div>
  </section>
</template>
