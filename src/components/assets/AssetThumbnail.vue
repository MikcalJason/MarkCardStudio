<script setup>
import { onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import AppIcon from "../AppIcon.vue";

const props = defineProps({
  asset: {
    type: Object,
    required: true,
  },
  getThumb: {
    type: Function,
    required: true,
  },
  alt: {
    type: String,
    default: "",
  },
  fit: {
    type: String,
    default: "cover",
  },
});

const root = ref(null);
const src = ref("");
const loading = ref(false);
const failed = ref(false);
const { t } = useI18n();
let observer = null;

async function load() {
  if (src.value || loading.value || !props.asset?.assetId) return;
  loading.value = true;
  failed.value = false;
  try {
    const url = await props.getThumb(props.asset.assetId);
    if (url) src.value = url;
    else failed.value = true;
  } finally {
    loading.value = false;
  }
}

function observe() {
  if (typeof IntersectionObserver === "undefined") {
    load();
    return;
  }
  observer?.disconnect();
  observer = new IntersectionObserver(
    (entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        load();
        observer?.disconnect();
        observer = null;
      }
    },
    { rootMargin: "240px" },
  );
  if (root.value) observer.observe(root.value);
}

onMounted(observe);
onBeforeUnmount(() => observer?.disconnect());

watch(
  () => props.asset?.assetId,
  () => {
    src.value = "";
    failed.value = false;
    observe();
  },
);
</script>

<template>
  <div ref="root" class="relative flex h-full w-full items-center justify-center overflow-hidden bg-slate-100 dark:bg-slate-800">
    <img
      v-if="src"
      :src="src"
      :alt="alt || asset.alt || asset.name || ''"
      class="h-full w-full"
      :class="fit === 'contain' ? 'object-contain' : 'object-cover'"
      draggable="false"
      @error="src = ''; failed = true"
    />
    <div v-else class="flex flex-col items-center gap-1.5 text-slate-500 dark:text-slate-400">
      <AppIcon :name="loading ? 'loader' : 'image'" :size="22" :class="{ 'animate-spin': loading }" />
      <span v-if="failed" class="text-[11px]">{{ t("assets.loadFailed") }}</span>
    </div>
  </div>
</template>
