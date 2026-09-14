<script setup lang="ts">
defineProps<{app: any}>();
</script>

<template>
  <teleport to="body">
    <div v-if="app.unsavedModalOpen" class="modal-backdrop" role="dialog" aria-modal="true">
      <section class="modal-card">
        <header class="modal-header">
          <strong>存在未保存的修改</strong>
        </header>
        <p class="modal-text">当前提供商配置尚未保存，切换前要保存吗？</p>
        <footer class="modal-actions">
          <a-button @click="app.resolveUnsavedChanges('cancel')">取消</a-button>
          <a-button status="danger" @click="app.resolveUnsavedChanges('discard')">丢弃修改</a-button>
          <a-button type="primary" @click="app.resolveUnsavedChanges('save')">保存</a-button>
        </footer>
      </section>
    </div>
  </teleport>
</template>
