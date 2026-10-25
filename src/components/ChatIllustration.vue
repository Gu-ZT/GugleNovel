<script setup lang="ts">
import {computed, onBeforeUnmount, ref, watch} from "vue";
import {IconCheck, IconClose, IconDown, IconLoading} from "@arco-design/web-vue/es/icon";
import {loadImage} from "../services/image/store";
import {CONTENT_MODE_LABELS} from "../domain/prompts";
import type {ImageSegmentMeta, ImageSegmentStatus} from "../domain/tree";

const props = defineProps<{
  imageId: string;
  prompt: string;
  status: ImageSegmentStatus;
  error?: string;
  meta?: ImageSegmentMeta;
}>();

const objectUrl = ref("");
const missing = ref(false);
const expanded = ref(false);
/** 递增令牌用于丢弃过期读取结果，避免快速切换时旧图片覆盖新图片 */
let loadToken = 0;
let unmounted = false;

function releaseObjectUrl() {
  if (objectUrl.value) URL.revokeObjectURL(objectUrl.value);
  objectUrl.value = "";
}

watch(() => props.imageId, async (imageId) => {
  const token = ++loadToken;
  releaseObjectUrl();
  missing.value = false;
  if (!imageId) return;
  try {
    const stored = await loadImage(imageId);
    if (unmounted || token !== loadToken) return;
    if (!stored) {
      missing.value = true;
      return;
    }
    objectUrl.value = URL.createObjectURL(stored.blob);
  } catch (loadError) {
    if (unmounted || token !== loadToken) return;
    console.error("读取插图失败：", loadError);
    missing.value = true;
  }
}, {immediate: true});

onBeforeUnmount(() => {
  unmounted = true;
  loadToken++;
  releaseObjectUrl();
});

const statusLabel = computed(() => {
  if (props.status === "pending") return "插图生成中…";
  if (props.status === "failed") return "插图生成失败";
  return "插图";
});

/** 卡片展开后展示的生成参数，缺失字段统一显示「未记录」。 */
const detailRows = computed(() => {
  const meta = props.meta;
  const contentMode = meta?.contentMode
      ? CONTENT_MODE_LABELS[meta.contentMode] ?? meta.contentMode
      : "未记录";
  return [
    {label: "图像模型", value: meta?.imageModel || "未记录"},
    {label: "提供商", value: meta?.imageProvider || "未记录"},
    {label: "内容模式", value: contentMode},
    {
      label: "图像模型 NSFW",
      value: meta?.imageModelSupportsNsfw === undefined
          ? "未记录"
          : meta.imageModelSupportsNsfw ? "支持" : "不支持",
    },
    {
      label: "触发时段落数",
      value: meta?.paragraphsSinceLastImage === undefined
          ? "未记录"
          : `${meta.paragraphsSinceLastImage} 段`,
    },
    {
      label: "调用序号",
      value: meta?.callIndex === undefined ? "未记录" : `第 ${meta.callIndex} 次`,
    },
    {
      label: "耗时",
      value: meta?.durationMs === undefined ? "未记录" : `${(meta.durationMs / 1000).toFixed(1)} 秒`,
    },
  ];
});
</script>

<template>
  <figure class="illustration-card" :class="status">
    <button
        type="button"
        class="illustration-card-header"
        :aria-expanded="expanded"
        :title="expanded ? '收起生成参数' : '展开生成参数'"
        @click="expanded = !expanded"
    >
      <span class="illustration-card-state">
        <IconLoading v-if="status === 'pending'" class="illustration-card-spin" aria-hidden="true"/>
        <IconClose v-else-if="status === 'failed'" aria-hidden="true"/>
        <IconCheck v-else aria-hidden="true"/>
        <span>{{ statusLabel }}</span>
      </span>
      <span class="illustration-card-toggle">
        <span>{{ expanded ? "收起参数" : "查看参数" }}</span>
        <IconDown class="illustration-card-chevron" :class="{open: expanded}" aria-hidden="true"/>
      </span>
    </button>

    <div v-if="status === 'pending'" class="illustration-card-placeholder">
      正在按提示词生成插图，完成后会显示在这里
    </div>
    <div v-else-if="status === 'failed'" class="illustration-card-placeholder failed">
      {{ error || "插图生成失败，正文可继续阅读" }}
    </div>
    <template v-else>
      <img v-if="objectUrl" :src="objectUrl" :alt="prompt || '插图'" loading="lazy"/>
      <div v-else-if="missing" class="illustration-card-placeholder">
        插图数据缺失，无法显示（仍可继续阅读正文）
      </div>
      <div v-else class="illustration-card-placeholder">正在载入插图…</div>
    </template>

    <div v-if="expanded" class="illustration-card-detail">
      <div class="illustration-card-field">
        <span class="illustration-card-label">生图提示词</span>
        <p class="illustration-card-prompt">{{ prompt || "（未记录）" }}</p>
      </div>
      <dl class="illustration-card-meta">
        <div v-for="row in detailRows" :key="row.label" class="illustration-card-meta-row">
          <dt>{{ row.label }}</dt>
          <dd>{{ row.value }}</dd>
        </div>
      </dl>
    </div>
  </figure>
</template>
