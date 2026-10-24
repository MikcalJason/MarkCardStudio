<script setup>
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import AppIcon from "../AppIcon.vue";
import { OPENMOJI_CATEGORIES, getOpenMojiSrc, getOpenMojiSticker, searchOpenMoji } from "../../config/openmoji.js";
import {
  MAX_OVERLAY_ITEMS,
  OVERLAY_TEXT_COLORS,
  addOverlayItem,
  createStickerItem,
  createTextItem,
  overlayItems,
  removeOverlayItem,
  updateOverlayItem,
} from "../../utils/imageOverlay.js";

const props = defineProps({
  image: {
    type: Object,
    default: null,
  },
  index: {
    type: Number,
    default: -1,
  },
  total: {
    type: Number,
    default: 0,
  },
});

const emit = defineEmits(["update-overlay"]);
const { t, locale } = useI18n();
const isChinese = computed(() => String(locale.value || "").startsWith("zh"));

const collapsed = ref(false);
const pickerOpen = ref(false);
const stickerQuery = ref("");
const stickerCategory = ref("all");
const textDraft = ref("");
const selectedId = ref("");

const items = computed(() => overlayItems(props.image?.overlay));
const selectedItem = computed(() => items.value.find((item) => item.id === selectedId.value) || null);
const stickerResults = computed(() =>
  searchOpenMoji(stickerQuery.value, stickerCategory.value)
    .slice(0, 30)
    .map((sticker) => ({
      id: sticker.id,
      src: getOpenMojiSrc(sticker),
      label: isChinese.value ? sticker.nameZh : sticker.nameEn,
    })),
);
const atLimit = computed(() => items.value.length >= MAX_OVERLAY_ITEMS);

function categoryLabel(category) {
  return isChinese.value ? category.nameZh : category.nameEn;
}

function itemName(item) {
  const sticker = getOpenMojiSticker(item.stickerId);
  if (!sticker) return item.stickerId;
  return isChinese.value ? sticker.nameZh : sticker.nameEn;
}

watch(
  () => props.image?.id,
  () => {
    selectedId.value = "";
    pickerOpen.value = false;
    textDraft.value = "";
  },
);

function nextOverlay(overlay) {
  if (!props.image) return;
  emit("update-overlay", { imageId: props.image.id, overlay });
}

function addSticker(stickerId) {
  const item = createStickerItem(stickerId);
  if (!item || atLimit.value) return;
  nextOverlay(addOverlayItem(props.image?.overlay, item));
  selectedId.value = item.id;
}

function addText() {
  const item = createTextItem(textDraft.value);
  if (!item || atLimit.value) return;
  nextOverlay(addOverlayItem(props.image?.overlay, item));
  selectedId.value = item.id;
  textDraft.value = "";
}

function patch(patchValues) {
  if (!selectedItem.value) return;
  nextOverlay(updateOverlayItem(props.image?.overlay, selectedItem.value.id, patchValues));
}

function commitText(value) {
  if (!selectedItem.value) return;
  if (!String(value).trim()) {
    remove(selectedItem.value.id);
    return;
  }
  patch({ text: String(value).slice(0, 120) });
}

function remove(id) {
  nextOverlay(removeOverlayItem(props.image?.overlay, id));
  if (selectedId.value === id) selectedId.value = "";
}

function select(id) {
  selectedId.value = selectedId.value === id ? "" : id;
}

function slider(key, event) {
  patch({ [key]: Number(event.target.value) });
}
</script>

<template>
  <section class="shrink-0 border-b border-slate-200/80 px-4 py-3 dark:border-slate-800">
    <button
      type="button"
      class="flex w-full items-center justify-between gap-2 text-left"
      :aria-expanded="!collapsed"
      @click="collapsed = !collapsed"
    >
      <h3 class="inline-flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-200">
        <AppIcon name="sparkles" :size="13" class="text-blue-600 dark:text-blue-400" />
        {{ t("overlay.title") }}
      </h3>
      <span class="inline-flex items-center gap-1.5 text-[10px] font-semibold text-slate-500 dark:text-slate-400">
        <span v-if="index >= 0">{{ t("overlay.target", { index: index + 1, total: total }) }}</span>
        <AppIcon :name="collapsed ? 'chevron-down' : 'chevron-up'" :size="13" />
      </span>
    </button>

    <div v-if="!collapsed" class="mt-2.5 space-y-2.5">
      <p v-if="!image" class="rounded-lg bg-slate-50 px-2.5 py-2 text-[11px] leading-5 text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
        {{ t("overlay.noImage") }}
      </p>

      <template v-else>
        <p class="text-[10px] leading-4 text-slate-500 dark:text-slate-400">{{ t("overlay.hint") }}</p>

        <div class="flex items-center gap-1.5">
          <input
            v-model="textDraft"
            type="text"
            maxlength="120"
            class="h-8 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-800 outline-none focus:border-blue-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            :placeholder="t('overlay.textPlaceholder')"
            @keydown.enter.prevent="addText"
          />
          <button
            type="button"
            class="h-8 shrink-0 rounded-lg border border-slate-200 px-2.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            :disabled="atLimit || !textDraft.trim()"
            @click="addText"
          >
            {{ t("overlay.addText") }}
          </button>
        </div>

        <button
          type="button"
          class="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-slate-200 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          :disabled="atLimit"
          :aria-expanded="pickerOpen"
          @click="pickerOpen = !pickerOpen"
        >
          <AppIcon name="smile" :size="13" />
          {{ pickerOpen ? t("overlay.hideStickers") : t("overlay.addSticker") }}
        </button>

        <div v-if="pickerOpen" class="rounded-lg border border-slate-200/80 p-2 dark:border-slate-700/80">
          <input
            v-model="stickerQuery"
            type="search"
            class="h-7 w-full rounded-md border border-slate-200 bg-white px-2 text-[11px] outline-none focus:border-blue-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            :placeholder="t('overlay.searchStickers')"
          />
          <div class="mt-1.5 flex flex-wrap gap-1">
            <button
              v-for="category in OPENMOJI_CATEGORIES"
              :key="category.id"
              type="button"
              class="rounded-full px-2 py-0.5 text-[10px] font-semibold transition"
              :class="stickerCategory === category.id
                ? 'bg-blue-600 text-white'
                : 'bg-slate-100 text-slate-500 hover:text-slate-800 dark:bg-slate-800 dark:text-slate-400'"
              @click="stickerCategory = category.id"
            >
              {{ categoryLabel(category) }}
            </button>
          </div>
          <div class="mt-1.5 grid max-h-28 grid-cols-6 gap-1 overflow-y-auto">
            <button
              v-for="sticker in stickerResults"
              :key="sticker.id"
              type="button"
              class="grid h-9 place-items-center rounded-md border border-transparent hover:border-blue-300 hover:bg-blue-50/60 dark:hover:border-blue-500/60 dark:hover:bg-blue-950/30"
              :title="sticker.label"
              :aria-label="sticker.label"
              @click="addSticker(sticker.id)"
            >
              <img :src="sticker.src" alt="" class="h-6 w-6" loading="lazy" />
            </button>
          </div>
          <p v-if="!stickerResults.length" class="mt-1.5 text-[10px] text-slate-400">
            {{ t("overlay.noStickers") }}
          </p>
        </div>

        <ul v-if="items.length" class="space-y-1">
          <li v-for="item in items" :key="item.id">
            <div
              class="flex items-center gap-1.5 rounded-lg border px-2 py-1.5 transition"
              :class="selectedId === item.id
                ? 'border-blue-300 bg-blue-50/50 dark:border-blue-500/60 dark:bg-blue-950/30'
                : 'border-slate-200/80 dark:border-slate-700/80'"
            >
              <button
                type="button"
                class="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                :aria-expanded="selectedId === item.id"
                @click="select(item.id)"
              >
                <AppIcon :name="item.kind === 'text' ? 'type' : 'smile'" :size="12" class="shrink-0 text-slate-400" />
                <span class="truncate text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                  {{ item.kind === "text" ? item.text : itemName(item) }}
                </span>
              </button>
              <button
                type="button"
                class="grid h-6 w-6 shrink-0 place-items-center rounded text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40 dark:hover:text-rose-300"
                :aria-label="t('overlay.remove')"
                :title="t('overlay.remove')"
                @click="remove(item.id)"
              >
                <AppIcon name="trash-2" :size="12" />
              </button>
            </div>

            <div v-if="selectedId === item.id" class="mt-1 space-y-1.5 rounded-lg bg-slate-50 p-2 dark:bg-slate-800/60">
              <input
                v-if="item.kind === 'text'"
                type="text"
                maxlength="120"
                :value="item.text"
                class="h-7 w-full rounded-md border border-slate-200 bg-white px-2 text-[11px] outline-none focus:border-blue-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                :placeholder="t('overlay.textPlaceholder')"
                @change="commitText($event.target.value)"
                @blur="commitText($event.target.value)"
              />

              <label v-for="control in ['x', 'y', 'size', 'rotate']" :key="control" class="flex items-center gap-2">
                <span class="w-8 shrink-0 text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                  {{ t(`overlay.controls.${control}`) }}
                </span>
                <input
                  type="range"
                  class="h-1 min-w-0 flex-1 accent-blue-600"
                  :min="control === 'rotate' ? -180 : control === 'size' ? 0.02 : 0"
                  :max="control === 'rotate' ? 180 : control === 'size' ? 0.6 : 1"
                  :step="control === 'rotate' ? 1 : control === 'size' ? 0.01 : 0.01"
                  :value="item[control]"
                  @input="slider(control, $event)"
                />
              </label>

              <template v-if="item.kind === 'text'">
                <div class="flex items-center gap-1.5">
                  <button
                    v-for="color in OVERLAY_TEXT_COLORS"
                    :key="color"
                    type="button"
                    class="h-5 w-5 rounded-full border transition"
                    :class="item.color === color ? 'border-blue-500 ring-2 ring-blue-500/30' : 'border-slate-300 dark:border-slate-600'"
                    :style="{ background: color }"
                    :aria-label="t('overlay.color')"
                    :title="t('overlay.color')"
                    @click="patch({ color })"
                  ></button>
                  <input
                    type="color"
                    :value="item.color"
                    class="h-5 w-6 cursor-pointer rounded border border-slate-200 bg-white p-0 dark:border-slate-700 dark:bg-slate-800"
                    :aria-label="t('overlay.colorCustom')"
                    :title="t('overlay.colorCustom')"
                    @input="patch({ color: $event.target.value })"
                  />
                </div>
                <div class="flex items-center gap-1">
                  <button
                    v-for="weight in [400, 700, 800]"
                    :key="weight"
                    type="button"
                    class="h-6 flex-1 rounded-md border text-[10px] transition"
                    :class="item.weight === weight
                      ? 'border-blue-400 bg-blue-600 text-white'
                      : 'border-slate-200 text-slate-500 dark:border-slate-700 dark:text-slate-400'"
                    :style="{ fontWeight: weight }"
                    @click="patch({ weight })"
                  >
                    {{ t(`overlay.weights.${weight}`) }}
                  </button>
                </div>
              </template>
            </div>
          </li>
        </ul>

        <p v-else class="text-[10px] leading-4 text-slate-400 dark:text-slate-500">{{ t("overlay.empty") }}</p>
      </template>
    </div>
  </section>
</template>
