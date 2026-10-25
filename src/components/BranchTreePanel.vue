<script setup lang="ts">
import {computed} from "vue";
import {
  messageText,
  resolvePath,
  type Conversation,
  type MessageNode,
  type MessageRole,
} from "../domain/tree";

const props = defineProps<{app: any}>();

const CARD_W = 170;
const CARD_H = 56;
const GAP_X = 36;
const GAP_Y = 12;

interface PlacedNode {
  node: MessageNode;
  x: number;
  y: number;
  onPath: boolean;
  isLeaf: boolean;
}

interface TreeEdge {
  key: string;
  d: string;
  onPath: boolean;
}

function roleLabel(role: MessageRole): string {
  return role === "user" ? "指令" : role === "assistant" ? "正文" : "系统";
}

function summarize(content: string): string {
  const text = content.replace(/\s+/g, " ").trim();
  return text.length > 24 ? `${text.slice(0, 24)}…` : text || "（空）";
}

/** 分支卡片摘要：正文取文本段，附图消息额外标注图片数量。 */
function nodeSummary(node: MessageNode): string {
  const text = summarize(messageText(node));
  const images = node.segments.filter((segment) => segment.type === "image").length;
  return images > 0 ? `${text}（${images} 张插图）` : text;
}

// 横版树布局：根在最左，每层一列向右展开；叶子按顺序分配行，父节点垂直居中于子树
const layout = computed(() => {
  const conversation = props.app.activeConversation as Conversation | null;
  const empty = {nodes: [] as PlacedNode[], edges: [] as TreeEdge[], width: 0, height: 0};
  if (!conversation) return empty;
  const conv: Conversation = conversation;

  const pathIds = new Set(resolvePath(conv).map((node) => node.id));
  const nodes: PlacedNode[] = [];
  const edges: TreeEdge[] = [];
  let cursor = 0;
  let maxDepth = 0;

  const columnX = (depth: number) => depth * (CARD_W + GAP_X);

  function walk(id: string, depth: number): number {
    const node = conv.nodes[id];
    if (!node) return 0;
    maxDepth = Math.max(maxDepth, depth);
    const children = node.childrenIds.filter((childId: string) => conv.nodes[childId]);
    const x = columnX(depth);

    if (children.length === 0) {
      const y = cursor;
      cursor += CARD_H + GAP_Y;
      nodes.push({node, x, y, onPath: pathIds.has(id), isLeaf: conv.activeLeafId === id});
      return y + CARD_H / 2;
    }

    const childCenters = children.map((childId: string) => walk(childId, depth + 1));
    const center = (childCenters[0] + childCenters[childCenters.length - 1]) / 2;
    nodes.push({node, x, y: center - CARD_H / 2, onPath: pathIds.has(id), isLeaf: conv.activeLeafId === id});

    childCenters.forEach((childCenter: number, index: number) => {
      const childId = children[index];
      const x1 = x + CARD_W;
      const x2 = columnX(depth + 1);
      const bend = GAP_X / 2;
      edges.push({
        key: `${id}->${childId}`,
        d: `M ${x1} ${center} C ${x1 + bend} ${center}, ${x2 - bend} ${childCenter}, ${x2} ${childCenter}`,
        onPath: pathIds.has(id) && pathIds.has(childId),
      });
    });
    return center;
  }

  conv.rootIds.forEach((id: string) => walk(id, 0));

  return {
    nodes,
    edges,
    width: (maxDepth + 1) * (CARD_W + GAP_X) - GAP_X,
    height: Math.max(cursor - GAP_Y, CARD_H),
  };
});
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
    <div v-if="layout.nodes.length === 0" class="branch-tree-empty">暂无消息节点</div>
    <div v-else class="branch-graph-scroll">
      <div class="branch-graph" :style="{ width: `${layout.width}px`, height: `${layout.height}px` }">
        <svg class="branch-graph-edges" :width="layout.width" :height="layout.height" aria-hidden="true">
          <path
              v-for="edge in layout.edges"
              :key="edge.key"
              :d="edge.d"
              class="branch-edge"
              :class="{ 'on-path': edge.onPath }"
              fill="none"
          />
        </svg>
        <button
            v-for="placed in layout.nodes"
            :key="placed.node.id"
            type="button"
            class="branch-node"
            :class="[placed.node.role, { 'on-path': placed.onPath, 'is-leaf': placed.isLeaf }]"
            :style="{ left: `${placed.x}px`, top: `${placed.y}px` }"
            :title="messageText(placed.node)"
            @click="app.focusNode(placed.node.id)"
        >
          <span class="branch-node-role">{{ roleLabel(placed.node.role) }}</span>
          <span class="branch-node-summary">{{ nodeSummary(placed.node) }}</span>
        </button>
      </div>
    </div>
  </a-drawer>
</template>
