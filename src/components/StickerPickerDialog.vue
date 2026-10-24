<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import AppIcon from "./AppIcon.vue";
import {
  OPENMOJI_CATEGORIES,
  getOpenMojiSrc,
  getOpenMojiSticker,
  searchOpenMoji,
} from "../config/openmoji.js";

const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
  modelValue: {
    type: Array,
    default: () => [],
  },
});

const emit = defineEmits(["close", "update:modelValue"]);
const { t, locale } = useI18n();

const MAX_STICKERS = 4;
const positions = ["top-right", "bottom-left", "top-left", "bottom-right"];

const query = ref("");
const category = ref("all");
const draft = ref([]);

const filteredStickers = computed(() => searchOpenMoji(query.value, category.value));
const selectedIds = computed(() => new Set(draft.value.map((item) => item.id)));
const isZh = computed(() => String(locale.value).startsWith("zh"));

function stickerName(sticker) {
  if (!sticker) return "";
  return isZh.value ? sticker.nameZh : sticker.nameEn;
}

function categoryName(item) {
  return isZh.value ? item.nameZh : item.nameEn;
}

function nextPosition() {
  const used = new Set(draft.value.map((item) => item.position));
  return positions.find((position) => !used.has(position)) || "top-right";
}

function toggleSticker(sticker) {
  const existingIndex = draft.value.findIndex((item) => item.id === sticker.id);
  if (existingIndex >= 0) {
    draft.value.splice(existingIndex, 1);
    return;
  }
  if (draft.value.length >= MAX_STICKERS) return;
  draft.value.push({ id: sticker.id, position: nextPosition() });
}

function updatePosition(id, position) {
  const item = draft.value.find((entry) => entry.id === id);
  if (item) item.position = position;
}

function removeSticker(id) {
  draft.value = draft.value.filter((item) => item.id !== id);
}

function apply() {
  emit("update:modelValue", draft.value.map((item) => ({ ...item })));
  emit("close");
}

function resetToTheme() {
  emit("update:modelValue", []);
  emit("close");
}

function close() {
  emit("close");
}

function handleKeydown(event) {
  if (event.key === "Escape" && props.open) close();
}

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    draft.value = (props.modelValue || [])
      .filter((item) => Boolean(getOpenMojiSticker(item.id)))
      .map((item) => ({ ...item }));
    query.value = "";
    category.value = "all";
  },
);

onMounted(() => window.addEventListener("keydown", handleKeydown));
onBeforeUnmount(() => window.removeEventListener("keydown", handleKeydown));
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-dialog flex items-center justify-center bg-slate-900/35 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      :aria-label="t('openmoji.title')"
      @click.self="close"
    >
      <div class="flex h-[min(760px,88vh)] w-full max-w-[1040px] flex-col overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-2xl dark:border-slate-700/80 dark:bg-slate-900">
        <header class="flex shrink-0 items-center gap-3 border-b border-slate-200/80 px-5 py-4 dark:border-slate-700/80">
          <span class="inline-grid h-9 w-9 place-items-center rounded-xl bg-amber-50 text-amber-600 dark:bg-amber-950/50 dark:text-amber-300">
            <AppIcon name="smile" :size="18" />
          </span>
          <div class="min-w-0">
            <h2 class="text-sm font-bold dark:text-slate-100">{{ t("openmoji.title") }}</h2>
            <p class="mt-0.5 text-[12px] text-slate-500 dark:text-slate-400">{{ t("openmoji.subtitle") }}</p>
          </div>
          <span class="ml-2 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-bold text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            {{ draft.length }} / {{ MAX_STICKERS }}
          </span>
          <button
            type="button"
            class="ml-auto inline-grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            :aria-label="t('openmoji.close')"
            :title="t('openmoji.close')"
            @click="close"
          >
            <AppIcon name="x" :size="16" />
          </button>
        </header>

        <div class="flex min-h-0 flex-1">
          <div class="flex min-w-0 flex-1 flex-col border-r border-slate-200/80 dark:border-slate-700/80">
            <div class="flex shrink-0 flex-wrap items-center gap-2 border-b border-slate-200/80 px-4 py-3 dark:border-slate-700/80">
              <input
                v-model="query"
                type="search"
                class="h-8 w-full max-w-[260px] rounded-lg border border-slate-200 bg-slate-50/80 px-3 text-xs text-slate-700 outline-none transition focus:border-blue-400 focus:bg-white dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-200 dark:focus:bg-slate-800"
                :placeholder="t('openmoji.searchPlaceholder')"
              />
              <button
                v-for="item in OPENMOJI_CATEGORIES"
                :key="item.id"
                type="button"
                class="rounded-full border px-2.5 py-1 text-[11px] font-semibold transition cursor-pointer"
                :class="
                  category === item.id
                    ? 'border-blue-200 bg-blue-50 text-blue-600 dark:border-blue-900/60 dark:bg-blue-950/50 dark:text-blue-300'
                    : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400'
                "
                @click="category = item.id"
              >
                {{ categoryName(item) }}
              </button>
            </div>

            <div class="min-h-0 flex-1 overflow-y-auto p-3">
              <div v-if="filteredStickers.length" class="grid grid-cols-4 gap-2 sm:grid-cols-5 md:grid-cols-6">
                <button
                  v-for="sticker in filteredStickers"
                  :key="sticker.id"
                  type="button"
                  class="group relative flex flex-col items-center gap-1.5 rounded-xl border p-2 text-center transition cursor-pointer"
                  :class="
                    selectedIds.has(sticker.id)
                      ? 'border-blue-400 bg-blue-50/80 ring-1 ring-blue-400/40 dark:border-blue-500 dark:bg-blue-950/40'
                      : 'border-slate-200/80 bg-white hover:border-slate-300 hover:bg-slate-50 dark:border-slate-700/80 dark:bg-slate-800/60 dark:hover:bg-slate-800'
                  "
                  :aria-pressed="selectedIds.has(sticker.id)"
                  @click="toggleSticker(sticker)"
                >
                  <img :src="getOpenMojiSrc(sticker)" :alt="stickerName(sticker)" class="h-10 w-10" loading="lazy" draggable="false" />
                  <span class="line-clamp-2 text-[11px] font-medium leading-tight text-slate-600 dark:text-slate-300">
                    {{ stickerName(sticker) }}
                  </span>
                  <span
                    v-if="selectedIds.has(sticker.id)"
                    class="absolute right-1 top-1 grid h-4 w-4 place-items-center rounded-full bg-blue-600 text-[10px] font-bold text-white"
                  >
                    ✓
                  </span>
                </button>
              </div>
              <div v-else class="flex h-full min-h-40 flex-col items-center justify-center text-center">
                <AppIcon name="smile" :size="28" class="text-slate-300 dark:text-slate-600" />
                <p class="mt-2 text-xs text-slate-500 dark:text-slate-400">{{ t("openmoji.noResults") }}</p>
              </div>
            </div>
          </div>

          <aside class="flex w-[280px] shrink-0 flex-col bg-slate-50/60 dark:bg-slate-950/20">
            <div class="flex items-center justify-between border-b border-slate-200/80 px-4 py-3 dark:border-slate-700/80">
              <span class="text-xs font-bold dark:text-slate-100">{{ t("openmoji.selected") }}</span>
              <span class="text-[11px] text-slate-500 dark:text-slate-400">{{ draft.length }} / {{ MAX_STICKERS }}</span>
            </div>
            <div class="min-h-0 flex-1 overflow-y-auto p-3">
              <div v-if="!draft.length" class="rounded-xl border border-dashed border-slate-200/90 bg-white/60 p-4 text-center dark:border-slate-700/80 dark:bg-slate-900/40">
                <p class="text-[12px] leading-5 text-slate-500 dark:text-slate-400">{{ t("openmoji.empty") }}</p>
                <button type="button" class="mt-3 text-[11px] font-bold text-blue-600 dark:text-blue-300" @click="resetToTheme">
                  {{ t("openmoji.useTheme") }}
                </button>
              </div>
              <div v-else class="space-y-2">
                <div
                  v-for="item in draft"
                  :key="item.id"
                  class="flex items-center gap-2 rounded-lg border border-slate-200/80 bg-white p-2 dark:border-slate-700/80 dark:bg-slate-800/70"
                >
                  <img
                    :src="getOpenMojiSrc(getOpenMojiSticker(item.id))"
                    :alt="stickerName(getOpenMojiSticker(item.id))"
                    class="h-8 w-8 shrink-0"
                    draggable="false"
                  />
                  <div class="min-w-0 flex-1">
                    <div class="truncate text-[11px] font-bold text-slate-700 dark:text-slate-200">
                      {{ stickerName(getOpenMojiSticker(item.id)) }}
                    </div>
                    <select
                      class="mt-1 h-7 w-full rounded border border-slate-200 bg-slate-50 px-1 text-[11px] text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                      :value="item.position"
                      @change="updatePosition(item.id, $event.target.value)"
                    >
                      <option v-for="position in positions" :key="position" :value="position">
                        {{ t(`openmoji.positions.${position}`) }}
                      </option>
                    </select>
                  </div>
                  <button
                    type="button"
                    class="grid h-7 w-7 place-items-center rounded-md text-slate-400 hover:bg-rose-50 hover:text-rose-500 dark:hover:bg-rose-950/40"
                    :aria-label="t('openmoji.remove')"
                    @click="removeSticker(item.id)"
                  >
                    <AppIcon name="x" :size="13" />
                  </button>
                </div>
              </div>
            </div>
            <div class="border-t border-slate-200/80 p-3 dark:border-slate-700/80">
              <p class="mb-2 text-[11px] leading-4 text-slate-500 dark:text-slate-400">{{ t("openmoji.hint") }}</p>
              <div class="flex gap-2">
                <button type="button" class="h-9 flex-1 rounded-lg border border-slate-200 bg-white text-[12px] font-bold text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300" @click="resetToTheme">
                  {{ t("openmoji.useTheme") }}
                </button>
                <button type="button" class="h-9 flex-1 rounded-lg bg-blue-600 text-[12px] font-bold text-white hover:bg-blue-700" @click="apply">
                  {{ t("openmoji.apply") }}
                </button>
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  </Teleport>
</template>
