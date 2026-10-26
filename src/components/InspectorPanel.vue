<script setup>
import { computed, ref } from "vue";
import { useAttrs } from "vue";
import { useI18n } from "vue-i18n";
import AppIcon from "./AppIcon.vue";
import GalleryInspector from "./gallery/GalleryInspector.vue";
import GalleryOverlayPanel from "./gallery/GalleryOverlayPanel.vue";
import SettingsPanel from "./SettingsPanel.vue";
import { createDefaultGalleryLayout } from "../composables/useWork.js";
import { isInspectorSegmentVisible } from "../config/uiFlags.js";

defineOptions({ inheritAttrs: false });

const props = defineProps({
  pagesLength: {
    type: Number,
    default: 0,
  },
  activePageIndex: {
    type: Number,
    default: 0,
  },
  creationMode: {
    type: String,
    default: "write",
  },
  galleryLayout: {
    type: Object,
    default: () => createDefaultGalleryLayout(),
  },
  galleryCount: {
    type: Number,
    default: 0,
  },
  galleryTitle: {
    type: String,
    default: "",
  },
  galleryImage: {
    type: Object,
    default: null,
  },
  galleryImageIndex: {
    type: Number,
    default: -1,
  },
  publish: {
    type: Object,
    default: null,
  },
  hasCoverDesign: {
    type: Boolean,
    default: false,
  },
  gallerySceneStatus: {
    type: String,
    default: "idle",
  },
  gallerySceneProgress: {
    type: Object,
    default: () => ({ done: 0, total: 0 }),
  },
  gallerySceneFailedCount: {
    type: Number,
    default: 0,
  },
});

const emit = defineEmits([
  "update-gallery-layout",
  "update-gallery-title",
  "update-gallery-overlay",
  "add-gallery-images",
  "open-asset-library",
  "open-cover-studio",
  "open-publish-center",
  "select-gallery-font",
  "open-gallery-scene",
  "retry-gallery-scene",
  "calibrate-gallery-image",
]);

const attrs = useAttrs();
const { t } = useI18n();
const segment = ref("design");

const publishPlan = computed(() => props.publish?.plan.value || null);
const publishReadiness = computed(() => props.publish?.readiness.value || null);
const publishChannel = computed(() => props.publish?.channel.value || null);

const rootAttrs = computed(() => ({
  class: attrs.class,
  style: attrs.style,
}));

const settingsAttrs = computed(() => {
  const { class: _class, style: _style, ...rest } = attrs;
  return rest;
});

const segments = [
  { id: "design", labelKey: "inspector.design", icon: "sliders" },
  { id: "generate", labelKey: "inspector.generate", icon: "sparkles" },
  { id: "publish", labelKey: "inspector.publish", icon: "upload" },
].filter((item) => isInspectorSegmentVisible(item.id));

const segmentGridStyle = computed(() => ({
  gridTemplateColumns: `repeat(${segments.length}, minmax(0, 1fr))`,
}));

function selectSegment(id) {
  segment.value = id;
}
</script>

<template>
  <aside
    v-bind="rootAttrs"
    class="panel-surface flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl"
  >
    <section class="shrink-0 border-b border-slate-200/70 px-4 py-3 dark:border-slate-800">
      <div class="flex items-center justify-between gap-2">
        <h2 class="text-[15px] font-semibold dark:text-slate-100">{{ t("inspector.title") }}</h2>
      </div>

      <div
        class="mt-3 grid gap-1 rounded-lg border border-slate-200/80 bg-white p-1 dark:border-slate-700/80 dark:bg-slate-800/80"
        :style="segmentGridStyle"
        role="tablist"
        :aria-label="t('inspector.title')"
      >
        <button
          v-for="item in segments"
          :key="item.id"
          type="button"
          role="tab"
          class="inline-flex h-7 items-center justify-center gap-1 rounded-md text-[11px] font-semibold transition-colors duration-150 cursor-pointer"
          :class="
            segment === item.id
              ? 'bg-blue-600 text-white shadow-sm dark:bg-blue-500 dark:text-white'
              : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
          "
          :aria-selected="segment === item.id"
          @click="selectSegment(item.id)"
        >
          <AppIcon :name="item.icon" :size="12" />
          <span>{{ t(item.labelKey) }}</span>
        </button>
      </div>
    </section>

    <div v-if="segment === 'design'" class="flex min-h-0 flex-1 flex-col overflow-y-auto">
      <GalleryInspector
        v-if="props.creationMode === 'gallery'"
        :layout="props.galleryLayout"
        :image-count="props.galleryCount"
        :title="props.galleryTitle"
        :custom-fonts="attrs.customFonts || []"
        :selected-font-id="attrs.selectedFontId || 'theme-default'"
        :has-cover-design="props.hasCoverDesign"
        :scene-status="props.gallerySceneStatus"
        :scene-progress="props.gallerySceneProgress"
        :scene-failed-count="props.gallerySceneFailedCount"
        @update-layout="emit('update-gallery-layout', $event)"
        @update-title="emit('update-gallery-title', $event)"
        @add-images="emit('add-gallery-images')"
        @open-cover-studio="emit('open-cover-studio')"
        @open-library="emit('open-asset-library')"
        @select-gallery-font="emit('select-gallery-font', $event)"
        @open-scene-picker="emit('open-gallery-scene')"
        @retry-scene="emit('retry-gallery-scene')"
        @calibrate-image="emit('calibrate-gallery-image')"
      />
      <GalleryOverlayPanel
        v-if="props.creationMode === 'gallery'"
        :image="props.galleryImage"
        :index="props.galleryImageIndex"
        :total="props.galleryCount"
        @update-overlay="emit('update-gallery-overlay', $event)"
      />
      <SettingsPanel
        v-bind="settingsAttrs"
        :pages-length="props.pagesLength"
        :active-page-index="props.activePageIndex"
        embedded
      />
    </div>

    <div v-else class="flex min-h-0 flex-1 flex-col overflow-y-auto px-5 py-6">
      <template v-if="segment === 'publish' && props.publish && publishPlan">
        <div
          class="rounded-xl border p-4"
          :class="{
            'border-emerald-200/90 bg-emerald-50/60 dark:border-emerald-900/70 dark:bg-emerald-950/30': publishReadiness?.tone === 'ready',
            'border-amber-200/90 bg-amber-50/60 dark:border-amber-900/70 dark:bg-amber-950/30': publishReadiness?.tone === 'warning',
            'border-rose-200/90 bg-rose-50/60 dark:border-rose-900/70 dark:bg-rose-950/30': publishReadiness?.tone === 'blocker',
          }"
        >
          <div class="flex items-center gap-2">
            <AppIcon
              :name="publishReadiness?.tone === 'ready' ? 'check-circle' : publishReadiness?.tone === 'warning' ? 'alert-circle' : 'circle-alert'"
              :size="17"
              :class="{
                'text-emerald-600 dark:text-emerald-300': publishReadiness?.tone === 'ready',
                'text-amber-600 dark:text-amber-300': publishReadiness?.tone === 'warning',
                'text-rose-600 dark:text-rose-300': publishReadiness?.tone === 'blocker',
              }"
            />
            <h3 class="text-sm font-bold dark:text-slate-100">
              {{ publishReadiness ? t(publishReadiness.labelKey) : "" }}
            </h3>
          </div>
          <p class="mt-2 text-xs leading-5 text-slate-600 dark:text-slate-300">
            {{ t("inspector.publishSummary", {
              channel: publishChannel ? t(publishChannel.labelKey) : "",
              count: publishPlan.images.length,
            }) }}
          </p>
          <button
            type="button"
            class="mt-3 h-8 w-full rounded-lg bg-blue-600 text-[12px] font-bold text-white transition hover:bg-blue-700"
            @click="emit('open-publish-center')"
          >
            {{ t("inspector.openPublishCenter") }}
          </button>
        </div>
      </template>

      <div v-else class="rounded-xl border border-dashed border-slate-200/90 bg-slate-50/70 p-5 dark:border-slate-700/80 dark:bg-slate-900/50">
        <span class="inline-grid h-9 w-9 place-items-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-300">
          <AppIcon :name="segment === 'generate' ? 'sparkles' : 'upload'" :size="18" />
        </span>
        <h3 class="mt-3 text-sm font-bold dark:text-slate-100">
          {{ segment === "generate" ? t("inspector.generateTitle") : t("inspector.publishTitle") }}
        </h3>
        <p class="mt-2 text-xs leading-5 text-slate-500 dark:text-slate-400">
          {{ segment === "generate" ? t("inspector.generateDesc") : t("inspector.publishDesc", { count: props.pagesLength }) }}
        </p>
      </div>
    </div>
  </aside>
</template>
