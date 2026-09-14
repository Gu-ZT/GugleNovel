<script setup lang="ts">
import type {MessageRole} from "../domain/tree";

defineProps<{app: any}>();

function roleLabel(role: MessageRole): string {
  return role === "user" ? "指令" : role === "assistant" ? "正文" : "系统";
}

function summarize(content: string): string {
  const text = content.replace(/\s+/g, " ").trim();
  return text.length > 42 ? `${text.slice(0, 42)}…` : text || "（空）";
}
</script>

<template>
  <a-drawer
      :visible="app.branchPanelOpen"
      title="分支树"
      placement="right"
      :width="360"
      @cancel="app.branchPanelOpen = false"
      @ok="app.branchPanelOpen = false"
  >
    <div v-if="app.treeRows.length === 0" class="branch-tree-empty">暂无消息节点</div>
    <div v-else class="branch-tree-scroll">
      <ul class="branch-tree">
        <li
            v-for="row in app.treeRows"
            :key="row.node.id"
            class="branch-tree-row"
            :class="{ 'on-path': row.onPath, [row.node.role]: true }"
            :style="{ paddingLeft: `${row.depth * 18 + 8}px` }"
        >
          <a-button type="text" class="branch-tree-item" @click="app.focusNode(row.node.id)">
            <a-tag size="small" :color="row.node.role === 'user' ? 'arcoblue' : 'green'">{{ roleLabel(row.node.role) }}</a-tag>
            <span class="branch-tree-summary">{{ summarize(row.node.content) }}</span>
            <span v-if="row.onPath" class="branch-tree-path-dot" title="当前路径" aria-label="当前路径"></span>
          </a-button>
        </li>
      </ul>
    </div>
  </a-drawer>
</template>
