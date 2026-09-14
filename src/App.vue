<script setup lang="ts">
import {RouterView} from "vue-router";
import {
  IconEdit,
  IconSettings,
} from "@arco-design/web-vue/es/icon";
import {useAppController} from "./composables/controller";
import ModelModal from "./components/modals/ModelModal.vue";
import UnsavedChangesModal from "./components/modals/UnsavedChangesModal.vue";

const {appMode, setAppMode, viewModel} = useAppController();
</script>

<template>
  <main class="app">
    <div class="content">
      <RouterView v-slot="{ Component }">
        <component :is="Component" :app="viewModel"/>
      </RouterView>
    </div>

    <nav class="tab-bar" aria-label="主导航">
      <a-button
          type="text"
          class="tab-bar-button"
          :class="{ active: appMode === 'chat' }"
          title="写作"
          @click="setAppMode('chat')"
      >
        <IconEdit aria-hidden="true"/>
        <span>写作</span>
      </a-button>
      <a-button
          type="text"
          class="tab-bar-button"
          :class="{ active: appMode === 'settings' }"
          title="设置"
          @click="setAppMode('settings')"
      >
        <IconSettings aria-hidden="true"/>
        <span>设置</span>
      </a-button>
    </nav>

    <ModelModal :app="viewModel"/>
    <UnsavedChangesModal :app="viewModel"/>
  </main>
</template>

<style src="./styles/app.css"></style>
