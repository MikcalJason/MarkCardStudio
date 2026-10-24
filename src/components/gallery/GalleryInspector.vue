<script setup>
import { ref, watch, computed } from "vue";
import { useI18n } from "vue-i18n";
import AppIcon from "../AppIcon.vue";
import { createDefaultGalleryLayout } from "../../composables/useWork.js";
import {
  GALLERY_FONT_PRESETS,
  GALLERY_TITLE_WEIGHTS,
  CAPTION_RATIO_RANGE,
  TITLE_RATIO_RANGE,
} from "../../config/galleryTypography.js";

const props = defineProps({
  layout: {
    type: Object,
    default: () => createDefaultGalleryLayout(),
  },
  imageCount: {
    type: Number,
    default: 0,
  },
  title: {
    type: String,
    default: "",
  },
  customFonts: {
    type: Array,
    default: () => [],
  },
  selectedFontId: {
    type: String,
    default: "theme-default",
  },
  hasCoverDesign: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(["update-layout", "add-images", "open-library", "update-title", "open-cover-studio", "open-overlay-editor", "select-gallery-font"]);
const { t } = useI18n();
const titleDraft = ref(props.title || "");
const isRaw = computed(() => props.layout.mode === "raw");

// One choice instead of two axes: "模式 + 背景" produced five combinations the
// user had to reason about, and most of them made no visual sense together.
const LOOKS = [
  { id: "photo", mode: "raw", background: "theme" },
  { id: "theme", mode: "template", background: "theme" },
  { id: "blurred", mode: "template", background: "blurred" },
  { id: "tint", mode: "template", background: "tint" },
];
const activeLook = computed(() => {
  if (props.layout.mode === "raw") return "photo";
  const background = props.layout.background || "theme";
  return background === "theme" ? "theme" : background;
});

function applyLook(id) {
  const look = LOOKS.find((item) => item.id === id);
  if (!look) return;
  emit("update-layout", { mode: look.mode, background: look.background });
}

watch(
  () => props.title,
  (title) => {
    titleDraft.value = title || "";
  },
);

function update(key, value) {
  emit("update-layout", { [key]: value });
}

const galleryType = computed(() => props.layout.type || {});
const presetFonts = computed(() =>
  GALLERY_FONT_PRESETS.filter((preset) => preset.id !== "custom"),
);
const activeImportedFontId = computed(() =>
  props.selectedFontId && props.selectedFontId !== "theme-default" ? props.selectedFontId : "",
);
// The app loads one imported font face at a time, so picking an imported font
// here selects it globally rather than pretending each gallery card loads its own.
const fontValue = computed({
  get() {
    const type = galleryType.value.fontId || "theme";
    if (type !== "custom") return `preset:${type}`;
    return activeImportedFontId.value ? `custom:${activeImportedFontId.value}` : "custom:none";
  },
  set(value) {
    if (value.startsWith("custom:")) {
      const id = value.slice(7);
      if (id === "none") return;
      emit("select-gallery-font", id);
      updateType("fontId", "custom");
      return;
    }
    updateType("fontId", value.slice(7));
  },
});

function updateType(key, value) {
  emit("update-layout", {
    type: { ...createDefaultGalleryLayout().type, ...galleryType.value, [key]: value },
  });
}

function ratioLabel(value) {
  return `${(Number(value) * 100).toFixed(1)}%`;
}

function commitTitle() {
  const nextTitle = titleDraft.value.trim();
  if (!nextTitle || nextTitle === props.title) {
    titleDraft.value = props.title || "";
    return;
  }
  emit("update-title", nextTitle);
}
</script>

<template>
  <section class="shrink-0 border-b border-slate-200/80 px-4 py-3 dark:border-slate-800">
    <div class="flex items-center justify-between gap-2">
      <h3 class="inline-flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-200">
        <AppIcon name="layout-grid" :size="13" class="text-blue-600 dark:text-blue-400" />
        {{ t("gallery.layoutTitle") }}
      </h3>
      <span class="text-[10px] font-semibold text-slate-500 dark:text-slate-400">
        {{ t("gallery.count", { count: imageCount }) }}
      </span>
    </div>

    <div class="mt-2.5 space-y-2.5">
      <label class="block">
        <span class="text-[11px] font-semibold text-slate-500 dark:text-slate-400">{{ t("gallery.coverTitle") }}</span>
        <input
          v-model="titleDraft"
          type="text"
          class="mt-1 h-8 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-800 outline-none focus:border-blue-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
          :placeholder="t('gallery.coverTitlePlaceholder')"
          @change="commitTitle"
          @blur="commitTitle"
          @keydown.enter.prevent="commitTitle"
        />
      </label>

      <div>
        <span class="text-[11px] font-semibold text-slate-500 dark:text-slate-400">{{ t("gallery.look") }}</span>
        <div class="mt-1 grid grid-cols-2 gap-1 rounded-lg border border-slate-200/80 bg-white p-1 dark:border-slate-700/80 dark:bg-slate-800/80">
          <button
            v-for="look in LOOKS"
            :key="look.id"
            type="button"
            class="h-7 truncate rounded-md px-1 text-[11px] font-semibold transition"
            :class="activeLook === look.id ? 'bg-blue-600 text-white shadow-sm dark:bg-blue-500 dark:text-white' : 'text-slate-500 dark:text-slate-400'"
            :aria-pressed="activeLook === look.id"
            @click="applyLook(look.id)"
          >
            {{ t(`gallery.looks.${look.id}`) }}
          </button>
        </div>
        <p class="mt-1.5 text-[10px] leading-4 text-slate-500 dark:text-slate-400">
          {{ t(activeLook === "photo" ? "gallery.rawHint" : activeLook === "theme" ? "gallery.cardHint" : "gallery.backgroundHint") }}
        </p>
      </div>

      <div>
        <span class="text-[11px] font-semibold text-slate-500 dark:text-slate-400">{{ t("gallery.fit") }}</span>
        <div class="mt-1 grid grid-cols-2 gap-1 rounded-lg border border-slate-200/80 bg-white p-1 dark:border-slate-700/80 dark:bg-slate-800/80">
          <button
            v-for="fit in ['cover', 'contain']"
            :key="fit"
            type="button"
            class="h-7 rounded-md text-[11px] font-semibold transition"
            :class="layout.fit === fit ? 'bg-blue-600 text-white shadow-sm dark:bg-blue-500 dark:text-white' : 'text-slate-500 dark:text-slate-400'"
            @click="update('fit', fit)"
          >
            {{ t(`gallery.fits.${fit}`) }}
          </button>
        </div>
      </div>

      <label v-if="!isRaw" class="flex items-center justify-between gap-2 rounded-lg border border-slate-200/80 px-2.5 py-2 dark:border-slate-700/80">
        <span class="text-[11px] font-semibold text-slate-600 dark:text-slate-300">{{ t("gallery.showNumbers") }}</span>
        <input
          type="checkbox"
          class="h-3.5 w-3.5 accent-blue-600"
          :checked="layout.showNumbers"
          @change="update('showNumbers', $event.target.checked)"
        />
      </label>

      <details v-if="!isRaw" class="rounded-lg border border-slate-200/80 dark:border-slate-700/80">
        <summary class="cursor-pointer px-2.5 py-2 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
          {{ t("gallery.advanced") }}
        </summary>
        <div class="space-y-2 px-2.5 pb-2">
          <div>
            <span class="text-[10px] font-semibold text-slate-500 dark:text-slate-400">{{ t("gallery.frame") }}</span>
            <div class="mt-1 grid grid-cols-2 gap-1 rounded-lg border border-slate-200/80 bg-white p-1 dark:border-slate-700/80 dark:bg-slate-800/80">
              <button
                v-for="frame in ['bleed', 'framed']"
                :key="frame"
                type="button"
                class="h-7 rounded-md text-[11px] font-semibold transition"
                :class="layout.frame === frame ? 'bg-blue-600 text-white shadow-sm dark:bg-blue-500 dark:text-white' : 'text-slate-500 dark:text-slate-400'"
                @click="update('frame', frame)"
              >
                {{ t(`gallery.frames.${frame}`) }}
              </button>
            </div>
          </div>

        <label class="block">
          <span class="text-[10px] font-semibold text-slate-500 dark:text-slate-400">{{ t("gallery.font") }}</span>
          <select
            v-model="fontValue"
            class="mt-1 h-8 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none focus:border-blue-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
          >
            <option
              v-for="preset in presetFonts"
              :key="preset.id"
              :value="`preset:${preset.id}`"
              :style="preset.stack ? { fontFamily: preset.stack } : {}"
            >
              {{ t(preset.labelKey) }}
            </option>
            <option
              v-for="font in customFonts"
              :key="font.id"
              :value="`custom:${font.id}`"
              :style="{ fontFamily: `'${font.family}', sans-serif` }"
            >
              {{ font.displayName }}
            </option>
            <option v-if="!customFonts.length" value="custom:none" disabled>
              {{ t("gallery.fonts.customEmpty") }}
            </option>
          </select>
          <span v-if="fontValue.startsWith('custom:')" class="mt-1 block text-[10px] leading-4 text-slate-500 dark:text-slate-400">
            {{ t("gallery.fonts.customHint") }}
          </span>
        </label>

        <label class="block">
          <span class="flex items-center justify-between text-[10px] font-semibold text-slate-500 dark:text-slate-400">
            {{ t("gallery.titleSize") }}
            <span class="tabular-nums">{{ ratioLabel(galleryType.titleRatio) }}</span>
          </span>
          <input
            type="range"
            class="mt-1 w-full accent-blue-600"
            :min="TITLE_RATIO_RANGE.min"
            :max="TITLE_RATIO_RANGE.max"
            step="0.001"
            :value="galleryType.titleRatio"
            @input="updateType('titleRatio', Number($event.target.value))"
          />
        </label>

        <div>
          <span class="text-[10px] font-semibold text-slate-500 dark:text-slate-400">{{ t("gallery.titleWeight") }}</span>
          <div class="mt-1 grid grid-cols-4 gap-1 rounded-lg border border-slate-200/80 bg-white p-1 dark:border-slate-700/80 dark:bg-slate-800/80">
            <button
              v-for="weight in GALLERY_TITLE_WEIGHTS"
              :key="weight"
              type="button"
              class="h-7 rounded-md text-[11px] font-semibold tabular-nums transition"
              :class="String(galleryType.titleWeight) === String(weight)
                ? 'bg-blue-600 text-white shadow-sm dark:bg-blue-500 dark:text-white'
                : 'text-slate-500 dark:text-slate-400'"
              @click="updateType('titleWeight', weight)"
            >
              {{ weight }}
            </button>
          </div>
        </div>

        <label class="block">
          <span class="flex items-center justify-between text-[10px] font-semibold text-slate-500 dark:text-slate-400">
            {{ t("gallery.captionSize") }}
            <span class="tabular-nums">{{ ratioLabel(galleryType.captionRatio) }}</span>
          </span>
          <input
            type="range"
            class="mt-1 w-full accent-blue-600"
            :min="CAPTION_RATIO_RANGE.min"
            :max="CAPTION_RATIO_RANGE.max"
            step="0.001"
            :value="galleryType.captionRatio"
            @input="updateType('captionRatio', Number($event.target.value))"
          />
        </label>
        </div>
      </details>

      <div class="grid grid-cols-2 gap-1.5">
        <button
          type="button"
          class="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-slate-200 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          @click="$emit('add-images')"
        >
          <AppIcon name="image-plus" :size="13" />
          {{ t("gallery.add") }}
        </button>
        <button
          type="button"
          class="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-slate-200 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          @click="$emit('open-library')"
        >
          <AppIcon name="image" :size="13" />
          {{ t("assets.title") }}
        </button>
      </div>
      <button
        v-if="hasCoverDesign"
        type="button"
        class="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-slate-900 text-[11px] font-bold text-white hover:bg-slate-800 dark:bg-slate-100 dark:text-slate-900 dark:hover:bg-white"
        @click="$emit('open-cover-studio')"
      >
        <AppIcon name="layout-grid" :size="13" />
        {{ t("gallery.openCoverStudio") }}
      </button>
    </div>
  </section>
</template>
