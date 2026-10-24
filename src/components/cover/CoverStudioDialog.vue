<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import AppIcon from "../AppIcon.vue";
import CoverPreview from "./CoverPreview.vue";
import {
  COVER_ALIGNMENTS,
  COVER_BACKGROUND_STYLES,
  COVER_FONTS,
  COVER_RATIOS,
  COVER_TEMPLATES,
} from "../../config/coverTemplates.js";
import { useCoverStudio, createCoverDesignFromWork } from "../../composables/useCoverStudio.js";
import { coverBackgroundSwatch } from "../../utils/coverBackgrounds.js";

const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
  work: {
    type: Object,
    default: null,
  },
  themeColor: {
    type: String,
    default: "#6354f4",
  },
  accentColor: {
    type: String,
    default: "#f59e0b",
  },
  defaultSubtitle: {
    type: String,
    default: "",
  },
  date: {
    type: String,
    default: "",
  },
});

const emit = defineEmits(["close", "save"]);
const { t, locale } = useI18n();
const studio = useCoverStudio();
const { design } = studio;
const activeTab = ref("templates");
const showSafeArea = ref(false);
let baseDesign = null;

const isChinese = computed(() => String(locale.value || "").startsWith("zh"));
const templateList = computed(() =>
  COVER_TEMPLATES.map((template) => ({
    ...template,
    label: isChinese.value ? template.nameZh : template.nameEn,
  })),
);

function templateLabel(template) {
  return isChinese.value ? template.nameZh : template.nameEn;
}

function backgroundSwatch(style) {
  return {
    background: coverBackgroundSwatch(
      style,
      design.background.baseColor,
      design.background.accentColor,
    ),
  };
}

function initialize() {
  baseDesign = createCoverDesignFromWork({
    work: props.work,
    title: props.work?.title || "",
    subtitle: props.defaultSubtitle || "",
    baseColor: props.themeColor,
    accentColor: props.accentColor,
    date: props.date,
  });
  studio.replace(baseDesign);
  showSafeArea.value = false;
  activeTab.value = "templates";
}

watch(
  () => props.open,
  (open) => {
    if (open) initialize();
  },
  { immediate: true },
);

function close() {
  emit("close");
}

function save() {
  if (!design.title.trim()) return;
  const serialized = studio.serialize();
  serialized.title = serialized.title.trim();
  serialized.subtitle = serialized.subtitle.trim();
  emit("save", serialized);
}

function reset() {
  if (baseDesign) studio.replace(baseDesign);
}

function handleKeydown(event) {
  if (!props.open) return;
  if (event.key === "Escape") {
    event.preventDefault();
    close();
  }
}

onMounted(() => window.addEventListener("keydown", handleKeydown));
onBeforeUnmount(() => window.removeEventListener("keydown", handleKeydown));
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-dialog flex items-center justify-center bg-slate-950/55 p-3 backdrop-blur-sm sm:p-5"
      role="dialog"
      aria-modal="true"
      :aria-label="t('cover.title')"
      @click.self="close"
    >
      <div class="flex h-[min(94vh,960px)] w-[min(97vw,1460px)] min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-2xl dark:border-slate-700/80 dark:bg-slate-900">
        <header class="flex shrink-0 flex-wrap items-center gap-3 border-b border-slate-200/80 px-4 py-3 dark:border-slate-800 sm:px-5">
          <div class="flex min-w-0 items-center gap-2.5">
            <span class="grid h-9 w-9 place-items-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-300">
              <AppIcon name="layout-grid" :size="17" />
            </span>
            <div class="min-w-0">
              <h2 class="truncate text-sm font-bold dark:text-slate-100">{{ t("cover.title") }}</h2>
              <p class="truncate text-[11px] text-slate-500 dark:text-slate-400">{{ t("cover.subtitle") }}</p>
            </div>
          </div>

          <div class="order-3 flex w-full items-center gap-1 rounded-lg border border-slate-200/80 bg-slate-100/80 p-1 dark:border-slate-700/80 dark:bg-slate-800/80 sm:order-none sm:ml-4 sm:w-auto">
            <button
              v-for="ratio in COVER_RATIOS"
              :key="ratio.id"
              type="button"
              class="h-7 rounded-md px-2 text-[11px] font-semibold transition"
              :class="design.ratio === ratio.id ? 'bg-white text-blue-600 shadow-sm dark:bg-slate-700 dark:text-blue-300' : 'text-slate-500 dark:text-slate-400'"
              @click="studio.setRatio(ratio.id)"
            >
              {{ ratio.id }}
            </button>
          </div>

          <div class="ml-auto flex shrink-0 items-center gap-1.5">
            <label class="hidden h-8 items-center gap-1.5 rounded-lg border border-slate-200 px-2 text-[11px] font-semibold text-slate-600 dark:border-slate-700 dark:text-slate-300 sm:inline-flex">
              <input v-model="showSafeArea" type="checkbox" class="h-3.5 w-3.5 accent-blue-600" />
              {{ t("cover.safeArea") }}
            </label>
            <button
              type="button"
              class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              @click="reset"
            >
              <AppIcon name="refresh" :size="13" />
              <span class="hidden md:inline">{{ t("cover.reset") }}</span>
            </button>
            <button
              type="button"
              class="inline-flex h-8 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-xs font-bold text-white hover:bg-blue-700"
              @click="save"
            >
              <AppIcon name="check" :size="14" />
              {{ t("cover.save") }}
            </button>
            <button
              type="button"
              class="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
              :aria-label="t('cover.close')"
              :title="t('cover.close')"
              @click="close"
            >
              <AppIcon name="x" :size="16" />
            </button>
          </div>
        </header>

        <div class="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
          <aside class="w-full shrink-0 border-b border-slate-200/80 p-3 dark:border-slate-800 lg:w-[228px] lg:border-b-0 lg:border-r">
            <div class="grid grid-cols-2 gap-1 rounded-lg bg-slate-100/80 p-1 dark:bg-slate-800/80">
              <button
                type="button"
                class="h-7 rounded-md text-[11px] font-semibold"
                :class="activeTab === 'templates' ? 'bg-white text-blue-600 shadow-sm dark:bg-slate-700 dark:text-blue-300' : 'text-slate-500 dark:text-slate-400'"
                @click="activeTab = 'templates'"
              >
                {{ t("cover.templates") }}
              </button>
              <button
                type="button"
                class="h-7 rounded-md text-[11px] font-semibold"
                :class="activeTab === 'backgrounds' ? 'bg-white text-blue-600 shadow-sm dark:bg-slate-700 dark:text-blue-300' : 'text-slate-500 dark:text-slate-400'"
                @click="activeTab = 'backgrounds'"
              >
                {{ t("cover.background") }}
              </button>
            </div>

            <div v-if="activeTab === 'templates'" class="mt-2 grid grid-cols-2 gap-1.5 overflow-y-auto lg:grid-cols-1">
              <button
                v-for="template in templateList"
                :key="template.id"
                type="button"
                class="flex w-full items-center gap-2 rounded-lg border p-1.5 text-left transition"
                :class="design.templateId === template.id ? 'border-blue-400 bg-blue-50/60 dark:border-blue-500/70 dark:bg-blue-950/20' : 'border-slate-200/80 hover:bg-slate-50 dark:border-slate-700/80 dark:hover:bg-slate-800/60'"
                @click="studio.applyTemplate(template.id)"
              >
                <span class="h-10 w-8 shrink-0 overflow-hidden rounded-md">
                  <span
                    class="block h-full w-full"
                    :style="backgroundSwatch(design.background.style)"
                  ></span>
                </span>
                <span class="min-w-0">
                  <span class="block truncate text-[11px] font-bold text-slate-700 dark:text-slate-200">{{ templateLabel(template) }}</span>
                  <span class="block truncate text-[10px] text-slate-500 dark:text-slate-400">{{ t(`cover.categories.${template.category}`) }}</span>
                </span>
              </button>
            </div>

            <div v-else class="mt-2 grid grid-cols-4 gap-1.5 lg:grid-cols-2">
              <button
                v-for="style in COVER_BACKGROUND_STYLES"
                :key="style.id"
                type="button"
                class="overflow-hidden rounded-lg border text-left transition"
                :class="design.background.style === style.id ? 'border-blue-400 ring-2 ring-blue-500/20' : 'border-slate-200/80 dark:border-slate-700/80'"
                @click="studio.updateBackground({ style: style.id })"
              >
                <span class="block h-16 w-full" :style="backgroundSwatch(style.id)"></span>
                <span class="block px-1.5 py-1 text-[10px] font-semibold text-slate-600 dark:text-slate-300">{{ t(style.labelKey) }}</span>
              </button>
            </div>
          </aside>

          <section class="flex min-h-[340px] min-w-0 flex-1 flex-col bg-[radial-gradient(circle_at_50%_35%,rgba(99,84,244,0.09),transparent_42%),linear-gradient(180deg,#f8fafc,#eef2f7)] dark:bg-[radial-gradient(circle_at_50%_35%,rgba(99,84,244,0.18),transparent_42%),linear-gradient(180deg,#0f172a,#111827)] lg:min-h-0">
            <CoverPreview :design="design" :show-safe-area="showSafeArea" />
          </section>

          <aside class="w-full shrink-0 overflow-y-auto border-t border-slate-200/80 p-4 dark:border-slate-800 lg:w-[280px] lg:border-l lg:border-t-0">
            <div class="space-y-3.5">
              <label class="block">
                <span class="text-[11px] font-semibold text-slate-500 dark:text-slate-400">{{ t("cover.kicker") }}</span>
                <input
                  :value="design.kicker"
                  type="text"
                  class="mt-1 h-8 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-800 outline-none focus:border-blue-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  @input="studio.updateContent({ kicker: $event.target.value })"
                />
              </label>

              <label class="block">
                <span class="text-[11px] font-semibold text-slate-500 dark:text-slate-400">{{ t("cover.titleLabel") }}</span>
                <textarea
                  :value="design.title"
                  rows="3"
                  class="mt-1 w-full resize-none rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-sm font-bold leading-5 text-slate-900 outline-none focus:border-blue-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  @input="studio.updateContent({ title: $event.target.value })"
                ></textarea>
              </label>

              <label class="block">
                <span class="text-[11px] font-semibold text-slate-500 dark:text-slate-400">{{ t("cover.subtitleLabel") }}</span>
                <textarea
                  :value="design.subtitle"
                  rows="2"
                  class="mt-1 w-full resize-none rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs leading-5 text-slate-700 outline-none focus:border-blue-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                  @input="studio.updateContent({ subtitle: $event.target.value })"
                ></textarea>
              </label>

              <div class="grid grid-cols-2 gap-2">
                <label class="block">
                  <span class="text-[11px] font-semibold text-slate-500 dark:text-slate-400">{{ t("cover.meta") }}</span>
                  <input
                    :value="design.meta"
                    type="text"
                    class="mt-1 h-8 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-800 outline-none focus:border-blue-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    @input="studio.updateContent({ meta: $event.target.value })"
                  />
                </label>
                <label class="block">
                  <span class="text-[11px] font-semibold text-slate-500 dark:text-slate-400">{{ t("cover.brand") }}</span>
                  <input
                    :value="design.brand"
                    type="text"
                    class="mt-1 h-8 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-800 outline-none focus:border-blue-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                    @input="studio.updateContent({ brand: $event.target.value })"
                  />
                </label>
              </div>

              <div>
                <span class="text-[11px] font-semibold text-slate-500 dark:text-slate-400">{{ t("cover.align") }}</span>
                <div class="mt-1 grid grid-cols-2 gap-1 rounded-lg border border-slate-200/80 bg-slate-100/80 p-1 dark:border-slate-700/80 dark:bg-slate-800/80">
                  <button
                    v-for="align in COVER_ALIGNMENTS"
                    :key="align"
                    type="button"
                    class="h-7 rounded-md text-[11px] font-semibold"
                    :class="design.layout.align === align ? 'bg-white text-blue-600 shadow-sm dark:bg-slate-700 dark:text-blue-300' : 'text-slate-500 dark:text-slate-400'"
                    @click="studio.updateLayout({ align })"
                  >
                    {{ t(`cover.aligns.${align}`) }}
                  </button>
                </div>
              </div>

              <label class="block">
                <span class="text-[11px] font-semibold text-slate-500 dark:text-slate-400">{{ t("cover.font") }}</span>
                <select
                  :value="design.layout.font"
                  class="mt-1 h-8 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-800 outline-none focus:border-blue-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                  @change="studio.updateLayout({ font: $event.target.value })"
                >
                  <option v-for="font in COVER_FONTS" :key="font" :value="font">{{ t(`cover.fonts.${font}`) }}</option>
                </select>
              </label>

              <label class="block">
                <span class="flex items-center justify-between text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                  <span>{{ t("cover.titleSize") }}</span>
                  <span>{{ Math.round(design.layout.titleScale * 100) }}%</span>
                </span>
                <input
                  :value="design.layout.titleScale"
                  type="range"
                  min="0.08"
                  max="0.2"
                  step="0.005"
                  class="mt-1 w-full accent-blue-600"
                  @input="studio.updateLayout({ titleScale: Number($event.target.value) })"
                />
              </label>

              <div class="grid grid-cols-2 gap-2">
                <label class="block">
                  <span class="text-[11px] font-semibold text-slate-500 dark:text-slate-400">{{ t("cover.baseColor") }}</span>
                  <input
                    :value="design.background.baseColor"
                    type="color"
                    class="mt-1 h-8 w-full cursor-pointer rounded-lg border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-800"
                    @input="studio.updateBackground({ baseColor: $event.target.value })"
                  />
                </label>
                <label class="block">
                  <span class="text-[11px] font-semibold text-slate-500 dark:text-slate-400">{{ t("cover.accentColor") }}</span>
                  <input
                    :value="design.background.accentColor"
                    type="color"
                    class="mt-1 h-8 w-full cursor-pointer rounded-lg border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-800"
                    @input="studio.updateBackground({ accentColor: $event.target.value })"
                  />
                </label>
              </div>

              <label class="block">
                <span class="flex items-center justify-between text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                  <span>{{ t("cover.overlay") }}</span>
                  <span>{{ Math.round(design.layout.overlay * 100) }}%</span>
                </span>
                <input
                  :value="design.layout.overlay"
                  type="range"
                  min="0"
                  max="0.8"
                  step="0.02"
                  class="mt-1 w-full accent-blue-600"
                  @input="studio.updateLayout({ overlay: Number($event.target.value) })"
                />
              </label>

              <button
                type="button"
                class="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-slate-200 text-[11px] font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                @click="studio.shuffleBackground()"
              >
                <AppIcon name="sparkles" :size="13" />
                {{ t("cover.shuffle") }}
              </button>
            </div>
          </aside>
        </div>

        <footer class="flex shrink-0 items-center justify-between gap-2 border-t border-slate-200/80 px-4 py-2.5 text-[10px] text-slate-400 dark:border-slate-800 dark:text-slate-500 sm:px-5">
          <span>{{ t("cover.footerHint") }}</span>
          <span>{{ t("cover.seed") }}: {{ design.background.seed }}</span>
        </footer>
      </div>
    </div>
  </Teleport>
</template>
