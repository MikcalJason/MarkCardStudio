<script setup>
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import AppIcon from "../AppIcon.vue";
import AppIconButton from "../AppIconButton.vue";
import SceneCalibrationDialog from "./SceneCalibrationDialog.vue";
import {
  SCENE_CATEGORIES,
  SCENE_MOCKUP_TEMPLATES,
  findSceneTemplate,
} from "../../config/sceneMockups.js";

const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
  selectedId: {
    type: String,
    default: "",
  },
  previews: {
    type: Object,
    default: () => ({}),
  },
  previewPending: {
    type: Boolean,
    default: false,
  },
  cardSrc: {
    type: String,
    default: "",
  },
});

const emit = defineEmits(["close", "select", "clear", "calibrated"]);
const { t } = useI18n();
const category = ref("all");
const query = ref("");
// The scene default is what this dialog calibrates; a single gallery image is
// corrected from the gallery itself (`SceneCalibrationDialog` with an imageId).
const calibrating = ref(false);

const selectedTemplate = computed(() => findSceneTemplate(props.selectedId));
const filtered = computed(() => {
  const needle = query.value.trim().toLowerCase();
  return SCENE_MOCKUP_TEMPLATES.filter((scene) => {
    if (category.value !== "all" && scene.category !== category.value) return false;
    if (!needle) return true;
    const label = t(scene.labelKey).toLowerCase();
    const group = t(`sceneMockup.categories.${scene.category}`).toLowerCase();
    return label.includes(needle) || group.includes(needle) || scene.id.includes(needle);
  });
});

watch(
  () => props.open,
  (open) => {
    if (!open) {
      calibrating.value = false;
      return;
    }
    query.value = "";
    category.value = "all";
  },
);
</script>

<template>
  <Teleport to="body">
    <!-- Main picker dialog -->
    <div
      v-if="open && !calibrating"
      class="fixed inset-0 z-dialog flex items-center justify-center bg-slate-950/55 p-3 backdrop-blur-sm sm:p-5"
      role="dialog"
      aria-modal="true"
      :aria-label="t('sceneMockup.pickerTitle')"
      @click.self="emit('close')"
    >
      <div
        class="flex max-h-[min(92vh,900px)] w-[min(96vw,1080px)] min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-2xl dark:border-slate-700/80 dark:bg-slate-900"
      >
        <header
          class="flex items-start justify-between gap-4 border-b border-slate-200/80 px-5 py-3.5 dark:border-slate-700/70"
        >
          <div class="min-w-0">
            <h2 class="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-50">
              <AppIcon name="tablet" :size="16" class="text-blue-600 dark:text-blue-400" />
              {{ t("sceneMockup.pickerTitle") }}
            </h2>
            <p class="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {{ t("sceneMockup.pickerSubtitle") }}
            </p>
          </div>
          <AppIconButton small :aria-label="t('common.close')" :title="t('common.close')" @click="emit('close')">
            <AppIcon name="x" :size="16" />
          </AppIconButton>
        </header>

        <div class="flex flex-col gap-2.5 border-b border-slate-200/80 px-4 py-3 dark:border-slate-700/70 sm:flex-row sm:items-center">
          <div class="flex flex-wrap gap-1">
            <button
              v-for="item in [{ id: 'all', labelKey: 'sceneMockup.categories.all' }, ...SCENE_CATEGORIES]"
              :key="item.id"
              type="button"
              class="h-7 rounded-full px-2.5 text-[11px] font-semibold transition"
              :class="category === item.id
                ? 'bg-blue-600 text-white shadow-sm dark:bg-blue-500'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'"
              :aria-pressed="category === item.id"
              @click="category = item.id"
            >
              {{ t(item.labelKey) }}
            </button>
          </div>
          <label class="relative sm:ml-auto sm:w-56">
            <AppIcon
              name="search"
              :size="13"
              class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              v-model="query"
              type="search"
              class="h-8 w-full rounded-lg border border-slate-200 bg-white pl-7 pr-2.5 text-xs text-slate-700 outline-none focus:border-blue-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              :placeholder="t('sceneMockup.searchPlaceholder')"
            />
          </label>
        </div>

        <div class="min-h-0 flex-1 overflow-y-auto p-4">
          <div v-if="filtered.length" class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            <button
              v-for="scene in filtered"
              :key="scene.id"
              type="button"
              class="group overflow-hidden rounded-xl border text-left transition"
              :class="selectedId === scene.id
                ? 'border-blue-500 ring-2 ring-blue-500/30'
                : 'border-slate-200 hover:-translate-y-0.5 hover:border-blue-300 hover:shadow-md dark:border-slate-700 dark:hover:border-blue-500/70'"
              :aria-pressed="selectedId === scene.id"
              @click="emit('select', scene.id)"
            >
              <div class="relative aspect-[3/4] overflow-hidden bg-slate-100 dark:bg-slate-800">
                <img
                  :src="previews[scene.id] || scene.image"
                  :alt="t(scene.labelKey)"
                  class="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
                  loading="lazy"
                />
                <span
                  v-if="selectedId === scene.id"
                  class="absolute right-2 top-2 grid h-6 w-6 place-items-center rounded-full bg-blue-600 text-white shadow-sm"
                >
                  <AppIcon name="check" :size="13" />
                </span>
              </div>
              <div class="px-2.5 py-2">
                <p class="truncate text-[11px] font-semibold text-slate-800 dark:text-slate-100">
                  {{ t(scene.labelKey) }}
                </p>
                <p class="mt-0.5 text-[10px] text-slate-400 dark:text-slate-500">
                  {{ t(`sceneMockup.categories.${scene.category}`) }}
                </p>
              </div>
            </button>
          </div>
          <p v-else class="py-14 text-center text-xs text-slate-500 dark:text-slate-400">
            {{ t("sceneMockup.noResults") }}
          </p>
        </div>

        <footer
          class="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200/80 px-5 py-3 dark:border-slate-700/70"
        >
          <div class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <span
              v-if="previewPending"
              class="inline-flex shrink-0 items-center gap-1.5 text-[11px] font-semibold text-blue-600 dark:text-blue-400"
            >
              <AppIcon name="spinner" :size="12" class="animate-spin" />
              {{ t("sceneMockup.previewGenerating") }}
            </span>
            <span class="min-w-0 truncate text-xs text-slate-500 dark:text-slate-400">
              {{ selectedTemplate ? `${t("sceneMockup.current")} · ${t(selectedTemplate.labelKey)}` : t("gallery.sceneNone") }}
            </span>
          </div>
          <div class="flex items-center gap-2">
            <button
              v-if="selectedId"
              type="button"
              class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700/70"
              :title="t('sceneMockup.calibrateDefaultHint')"
              @click="calibrating = true"
            >
              <AppIcon name="maximize" :size="13" />
              {{ t("sceneMockup.calibrate") }}
            </button>
            <button
              v-if="selectedId"
              type="button"
              class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700/70"
              @click="emit('clear')"
            >
              <AppIcon name="x" :size="13" />
              {{ t("sceneMockup.clear") }}
            </button>
          </div>
        </footer>
      </div>
    </div>

    <!-- Scene-level calibration: the default for every image. Per-image corner
         nudging happens from the gallery, where the offending card is selected. -->
    <SceneCalibrationDialog
      :open="open && calibrating"
      :scene-id="selectedId"
      :card-src="cardSrc"
      @saved="emit('calibrated')"
      @close="calibrating = false"
    />
  </Teleport>
</template>
