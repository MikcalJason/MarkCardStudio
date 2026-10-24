<script setup>
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import AppIcon from "./AppIcon.vue";

const props = defineProps({
  mode: {
    type: String,
    default: "gallery",
  },
});

defineEmits(["switch-write"]);
const { t } = useI18n();

const isGallery = computed(() => props.mode === "gallery");
const title = computed(() =>
  isGallery.value ? t("workspace.galleryPlaceholderTitle") : t("workspace.posterPlaceholderTitle"),
);
const description = computed(() =>
  isGallery.value ? t("workspace.galleryPlaceholderDesc") : t("workspace.posterPlaceholderDesc"),
);
</script>

<template>
  <section class="col-span-full flex min-h-0 flex-1 items-center justify-center overflow-y-auto p-6">
    <div class="w-full max-w-xl rounded-2xl border border-slate-200/80 bg-white/85 p-7 text-center shadow-sm backdrop-blur-xl dark:border-slate-700/80 dark:bg-slate-900/80">
      <span class="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-300">
        <AppIcon :name="isGallery ? 'layout-grid' : 'image'" :size="22" />
      </span>
      <h1 class="mt-4 text-lg font-extrabold tracking-tight dark:text-slate-100">{{ title }}</h1>
      <p class="mx-auto mt-2 max-w-md text-sm leading-6 text-slate-500 dark:text-slate-400">
        {{ description }}
      </p>
      <button
        type="button"
        class="mt-5 inline-flex h-9 items-center gap-2 rounded-lg bg-blue-600 px-4 text-xs font-bold text-white shadow-sm transition hover:bg-blue-700 cursor-pointer"
        @click="$emit('switch-write')"
      >
        <AppIcon name="file-text" :size="15" />
        <span>{{ t("workspace.backToWrite") }}</span>
      </button>
    </div>
  </section>
</template>
