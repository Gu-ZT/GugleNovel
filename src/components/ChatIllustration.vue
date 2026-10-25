<script setup lang="ts">
import {onBeforeUnmount, ref, watch} from "vue";
import {loadImage} from "../services/image/store";

const props = defineProps<{imageId: string; prompt: string}>();

const objectUrl = ref("");
const missing = ref(false);
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
</script>

<template>
  <figure class="chat-illustration">
    <img v-if="objectUrl" :src="objectUrl" :alt="prompt || '插图'" loading="lazy"/>
    <div v-else-if="missing" class="chat-illustration-missing">
      插图数据缺失，无法显示（仍可继续阅读正文）
    </div>
    <div v-else class="chat-illustration-loading">正在载入插图…</div>
    <figcaption v-if="prompt">{{ prompt }}</figcaption>
  </figure>
</template>
