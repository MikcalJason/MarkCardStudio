<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import CoverDesignArtwork from "./CoverDesignArtwork.vue";
import { getCoverRatio } from "../../config/coverTemplates.js";

const props = defineProps({
  design: {
    type: Object,
    required: true,
  },
  showSafeArea: {
    type: Boolean,
    default: false,
  },
});

const viewportHeight = ref(typeof window !== "undefined" ? window.innerHeight : 900);

const ratio = computed(() => {
  const item = getCoverRatio(props.design?.ratio);
  return item.width / item.height;
});
const frameSize = computed(() => {
  let height = Math.min(560, Math.max(280, viewportHeight.value * 0.5));
  let width = height * ratio.value;
  if (width > 620) {
    width = 620;
    height = width / ratio.value;
  }
  return { width: `${Math.round(width)}px`, height: `${Math.round(height)}px` };
});

function handleResize() {
  viewportHeight.value = window.innerHeight;
}

onMounted(() => window.addEventListener("resize", handleResize));
onBeforeUnmount(() => window.removeEventListener("resize", handleResize));
</script>

<template>
  <div class="flex h-full min-h-0 flex-col items-center justify-center gap-4 overflow-auto p-5">
    <div
      class="relative shrink-0 overflow-hidden rounded-xl shadow-[0_24px_70px_rgba(15,23,42,0.35)]"
      :style="frameSize"
    >
      <CoverDesignArtwork :design="design" :show-safe-area="showSafeArea" />
    </div>
    <p class="text-[11px] font-medium text-slate-500 dark:text-slate-400">
      {{ design.ratio }} · {{ getCoverRatio(design.ratio).width }} × {{ getCoverRatio(design.ratio).height }}
    </p>
  </div>
</template>
