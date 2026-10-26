<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { invoke } from "@tauri-apps/api/core";
import AppIcon from "../AppIcon.vue";
import AppIconButton from "../AppIconButton.vue";
import {
  SCENE_CATEGORIES,
  SCENE_MOCKUP_OUTPUT,
  SCENE_MOCKUP_TEMPLATES,
  SCENE_QUAD_POINTS,
} from "../../config/sceneMockups.js";
import {
  canvasToBlob,
  composeSceneMockup,
  loadSceneImage,
  normalizeQuad,
  outputPointToScenePoint,
  sceneQuadToOutput,
} from "../../utils/sceneMockup.js";
import {
  blobToBase64,
  createOutputFolderName,
  downloadBlob,
  renderPageToImage,
} from "../../composables/useCardExport.js";
import {
  clearSceneQuadOverride,
  readSceneQuadOverrides,
  writeSceneQuadOverride,
} from "../../storage/sceneMockupTemplates.js";

const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
  pages: {
    type: Array,
    default: () => [],
  },
  pageIndex: {
    type: Number,
    default: 0,
  },
  renderOptions: {
    type: Object,
    default: () => ({}),
  },
  exportPath: {
    type: String,
    default: "",
  },
  sourcePath: {
    type: String,
    default: "",
  },
  isTauri: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(["close", "folder-picked", "exported"]);

const { t } = useI18n();
const templates = SCENE_MOCKUP_TEMPLATES;
const PREVIEW_WIDTH = 768;
const PREVIEW_HEIGHT = 1024;

const selectedIds = ref(templates[0] ? [templates[0].id] : []);
const activeId = ref(templates[0]?.id || "");
const categoryFilter = ref("all");
const searchQuery = ref("");
const quadOverrides = ref(readSceneQuadOverrides());
const sceneImages = ref({});
const sceneLoads = new Map();
const cardImage = ref(null);
const previewCanvas = ref(null);
const previewBusy = ref(false);
const cardBusy = ref(false);
const exporting = ref(false);
const status = ref("");
const error = ref("");
const dragIndex = ref(-1);
const dragQuad = ref(null);

let cardToken = 0;
let previewToken = 0;

const activeTemplate = computed(
  () => templates.find((template) => template.id === activeId.value) || templates[0],
);

const activeQuad = computed(() => {
  const template = activeTemplate.value;
  if (!template) return null;
  if (dragIndex.value >= 0 && dragQuad.value) {
    return normalizeQuad(dragQuad.value, template.quad);
  }
  return quadOverrides.value[template.id] || template.quad;
});

const selectedTemplates = computed(() =>
  templates.filter((template) => selectedIds.value.includes(template.id)),
);

const filteredTemplates = computed(() => {
  const needle = searchQuery.value.trim().toLowerCase();
  return templates.filter((template) => {
    if (categoryFilter.value !== "all" && template.category !== categoryFilter.value) return false;
    if (!needle) return true;
    return (
      t(template.labelKey).toLowerCase().includes(needle) ||
      t(`sceneMockup.categories.${template.category}`).toLowerCase().includes(needle) ||
      template.id.includes(needle)
    );
  });
});

const currentPage = computed(
  () => props.pages[props.pageIndex] || props.pages[0] || null,
);

const overlayPoints = computed(() => {
  const template = activeTemplate.value;
  const scene = sceneImages.value[template?.id];
  const quad = activeQuad.value;
  if (!scene || !quad) return [];
  return sceneQuadToOutput(quad, scene, PREVIEW_WIDTH, PREVIEW_HEIGHT);
});

const polygonPoints = computed(() =>
  overlayPoints.value.map((point) => `${point[0]},${point[1]}`).join(" "),
);

// Load only the scene being previewed. Export loads each selected scene on
// demand through the shared cache, so opening the dialog with 29 templates no
// longer decodes every photo up front.
async function ensureScene(id) {
  const template = templates.find((item) => item.id === id);
  if (!template) return null;
  if (sceneImages.value[id]) return sceneImages.value[id];
  if (!sceneLoads.has(id)) {
    const load = loadSceneImage(template.image)
      .then((image) => {
        sceneImages.value = { ...sceneImages.value, [id]: image };
        return image;
      })
      .finally(() => sceneLoads.delete(id));
    sceneLoads.set(id, load);
  }
  return sceneLoads.get(id);
}

async function renderCardImage() {
  if (!currentPage.value) {
    cardImage.value = null;
    return;
  }
  const token = (cardToken += 1);
  cardBusy.value = true;
  error.value = "";
  try {
    // Reuse the canonical page renderer so a scene export can never differ from
    // the card the user already saw in preview.
    // The scene frame is 1536x2048 and the screen inside it is smaller again, so
    // the card is rendered at the frame's own resolution. html-to-image keeps the
    // 450px design layout and only raises the pixel ratio, which is what stops a
    // warped-down screen from turning the card's type into mush.
    const platformWidth = Number(props.renderOptions?.width) || 1080;
    const platformHeight = Number(props.renderOptions?.height) || 1440;
    const frameLongSide = Math.max(SCENE_MOCKUP_OUTPUT.width, SCENE_MOCKUP_OUTPUT.height);
    const renderScale = Math.max(
      1,
      Math.min(2, frameLongSide / Math.max(platformWidth, platformHeight)),
    );
    const { blob } = await renderPageToImage(currentPage.value, {
      ...props.renderOptions,
      width: Math.round(platformWidth * renderScale),
      height: Math.round(platformHeight * renderScale),
      format: "PNG",
      pageNumber: props.pageIndex + 1,
      totalPages: props.pages.length,
    });
    const url = URL.createObjectURL(blob);
    const image = new Image();
    await new Promise((resolve, reject) => {
      image.onload = resolve;
      image.onerror = reject;
      image.src = url;
    });
    URL.revokeObjectURL(url);
    if (token !== cardToken) return;
    cardImage.value = image;
  } catch (err) {
    if (token === cardToken) {
      error.value = t("sceneMockup.renderFailed", { error: err?.message || err });
    }
  } finally {
    if (token === cardToken) cardBusy.value = false;
  }
}

async function refreshPreview() {
  const template = activeTemplate.value;
  const quad = activeQuad.value;
  if (!template || !quad || !cardImage.value) return;
  const token = (previewToken += 1);
  previewBusy.value = true;
  try {
    const scene = await ensureScene(template.id);
    if (!scene || token !== previewToken) return;
    const canvas = composeSceneMockup({
      sceneImage: scene,
      cardImage: cardImage.value,
      quad,
      fit: template.fit || "cover",
      lighting: template.lighting,
      cornerRadius: template.cornerRadius,
      width: PREVIEW_WIDTH,
      height: PREVIEW_HEIGHT,
    });
    if (!canvas || token !== previewToken) return;
    const target = previewCanvas.value;
    if (!target) return;
    target.width = canvas.width;
    target.height = canvas.height;
    target.getContext("2d").drawImage(canvas, 0, 0);
  } catch (err) {
    if (token === previewToken) {
      error.value = t("sceneMockup.composeFailed");
    }
  } finally {
    if (token === previewToken) previewBusy.value = false;
  }
}

async function initialize() {
  status.value = "";
  error.value = "";
  if (!selectedIds.value.length && activeId.value) {
    selectedIds.value = [activeId.value];
  }
  if (!templates.some((template) => template.id === activeId.value)) {
    activeId.value = templates[0]?.id || "";
  }
  quadOverrides.value = readSceneQuadOverrides();
  await nextTick();
  await Promise.all([
    ensureScene(activeId.value).catch(() => null),
    renderCardImage(),
  ]);
  await refreshPreview();
}

function selectTemplate(id) {
  activeId.value = id;
  if (!selectedIds.value.includes(id)) {
    selectedIds.value = [...selectedIds.value, id];
  }
  dragIndex.value = -1;
  dragQuad.value = null;
  refreshPreview();
}

function toggleTemplate(id) {
  if (selectedIds.value.includes(id)) {
    selectedIds.value = selectedIds.value.filter((item) => item !== id);
    if (activeId.value === id && selectedIds.value.length) {
      activeId.value = selectedIds.value[0];
    }
  } else {
    selectedIds.value = [...selectedIds.value, id];
    activeId.value = id;
  }
  dragIndex.value = -1;
  dragQuad.value = null;
  refreshPreview();
}

// Capture keeps the pointer's events flowing while the cursor is off the dot;
// the window listeners cover engines or pointers where capture is refused.
function handlePointerDown(event, index) {
  if (!activeQuad.value) return;
  event.preventDefault();
  event.stopPropagation();
  dragIndex.value = index;
  try {
    event.currentTarget.setPointerCapture?.(event.pointerId);
  } catch {
    // Nothing else to undo: the window listeners below already carry the drag.
  }
  dragQuad.value = { ...activeQuad.value };
  window.addEventListener("pointermove", handlePointerMove);
  window.addEventListener("pointerup", handlePointerUp, { once: true });
  window.addEventListener("pointercancel", handlePointerUp, { once: true });
}

function handlePointerMove(event) {
  if (dragIndex.value < 0 || !previewCanvas.value) return;
  const scene = sceneImages.value[activeId.value];
  if (!scene) return;
  const rect = previewCanvas.value.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const point = [
    ((event.clientX - rect.left) / rect.width) * PREVIEW_WIDTH,
    ((event.clientY - rect.top) / rect.height) * PREVIEW_HEIGHT,
  ];
  const key = SCENE_QUAD_POINTS[dragIndex.value];
  if (!key) return;
  dragQuad.value = {
    ...dragQuad.value,
    [key]: outputPointToScenePoint(point, scene, PREVIEW_WIDTH, PREVIEW_HEIGHT),
  };
}

function handlePointerUp() {
  window.removeEventListener("pointermove", handlePointerMove);
  if (dragIndex.value < 0) return;
  const quad = dragQuad.value;
  dragIndex.value = -1;
  dragQuad.value = null;
  if (quad) {
    writeSceneQuadOverride(activeId.value, quad);
    quadOverrides.value = readSceneQuadOverrides();
  }
  refreshPreview();
}

function resetCalibration() {
  dragIndex.value = -1;
  dragQuad.value = null;
  clearSceneQuadOverride(activeId.value);
  quadOverrides.value = readSceneQuadOverrides();
  refreshPreview();
}

async function handleExport() {
  if (exporting.value || cardBusy.value || !cardImage.value) return;
  if (!selectedTemplates.value.length) {
    status.value = t("sceneMockup.selectAtLeastOne");
    return;
  }
  exporting.value = true;
  status.value = "";
  error.value = "";
  try {
    let folder = (props.exportPath || "").trim();
    if (!folder && props.isTauri) {
      status.value = t("sceneMockup.chooseFolder");
      folder = await invoke("pick_export_folder");
      if (!folder) {
        status.value = t("sceneMockup.exportCancelled");
        return;
      }
      emit("folder-picked", folder);
    }

    const baseName = createOutputFolderName(props.sourcePath);
    const total = selectedTemplates.value.length;
    let saved = 0;
    for (let index = 0; index < total; index += 1) {
      const template = selectedTemplates.value[index];
      status.value = t("sceneMockup.exportingProgress", {
        current: index + 1,
        total,
      });
      const scene = await ensureScene(template.id);
      if (!scene) throw new Error(t("sceneMockup.composeFailed"));
      const canvas = composeSceneMockup({
        sceneImage: scene,
        cardImage: cardImage.value,
        quad: quadOverrides.value[template.id] || template.quad,
        fit: template.fit || "cover",
        lighting: template.lighting,
        cornerRadius: template.cornerRadius,
        width: SCENE_MOCKUP_OUTPUT.width,
        height: SCENE_MOCKUP_OUTPUT.height,
      });
      if (!canvas) throw new Error(t("sceneMockup.composeFailed"));
      const blob = await canvasToBlob(canvas, "image/png");
      if (!blob) throw new Error(t("sceneMockup.composeFailed"));
      const fileName = `${baseName}-scene-${template.id}.png`;
      if (props.isTauri) {
        const base64Data = await blobToBase64(blob);
        await invoke("save_export_file", {
          folderPath: folder,
          subfolderName: baseName,
          fileName,
          base64Data,
        });
      } else {
        downloadBlob(blob, fileName);
      }
      saved += 1;
    }
    status.value = t("sceneMockup.exportDone", { count: saved });
    emit("exported", status.value);
  } catch (err) {
    error.value = t("sceneMockup.exportFailed", { error: err?.message || err });
  } finally {
    exporting.value = false;
  }
}

function handleClose() {
  if (exporting.value) return;
  emit("close");
}

watch(
  () => props.open,
  (open) => {
    if (!open) {
      cardToken += 1;
      cardImage.value = null;
      return;
    }
    initialize();
  },
);

watch(
  () => [props.pageIndex, props.pages.length],
  () => {
    if (!props.open) return;
    renderCardImage().then(refreshPreview);
  },
);

onBeforeUnmount(() => {
  window.removeEventListener("pointermove", handlePointerMove);
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-dialog flex items-center justify-center bg-slate-950/55 p-3 backdrop-blur-sm sm:p-5"
      role="dialog"
      aria-modal="true"
      :aria-label="t('sceneMockup.title')"
      @click.self="handleClose"
    >
      <div
        class="flex h-[min(92vh,900px)] w-[min(96vw,1120px)] min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-2xl dark:border-slate-700/80 dark:bg-slate-900"
      >
        <header
          class="flex items-start justify-between gap-4 border-b border-slate-200/80 px-5 py-3.5 dark:border-slate-700/70"
        >
          <div class="min-w-0">
            <h2 class="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-50">
              <AppIcon name="tablet" :size="16" class="text-blue-600 dark:text-blue-400" />
              {{ t("sceneMockup.title") }}
            </h2>
            <p class="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {{ t("sceneMockup.subtitle") }}
            </p>
          </div>
          <AppIconButton small :aria-label="t('common.close')" :title="t('common.close')" @click="handleClose">
            <AppIcon name="x" :size="16" />
          </AppIconButton>
        </header>

        <div class="grid min-h-0 flex-1 gap-4 overflow-hidden p-4 lg:grid-cols-[280px_minmax(0,1fr)]">
          <aside class="flex min-h-0 flex-col gap-2.5 overflow-hidden pr-1">
            <div class="relative shrink-0">
              <AppIcon
                name="search"
                :size="13"
                class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400"
              />
              <input
                v-model="searchQuery"
                type="search"
                class="h-8 w-full rounded-lg border border-slate-200 bg-white pl-8 pr-2 text-xs text-slate-700 outline-none transition focus:border-blue-400 focus:ring-2 focus:ring-blue-500/20 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                :placeholder="t('sceneMockup.searchPlaceholder')"
              />
            </div>
            <div class="flex shrink-0 flex-wrap gap-1">
              <button
                type="button"
                class="rounded-full px-2 py-0.5 text-[11px] font-semibold transition"
                :class="
                  categoryFilter === 'all'
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
                "
                @click="categoryFilter = 'all'"
              >
                {{ t("sceneMockup.categories.all") }}
              </button>
              <button
                v-for="category in SCENE_CATEGORIES"
                :key="category.id"
                type="button"
                class="rounded-full px-2 py-0.5 text-[11px] font-semibold transition"
                :class="
                  categoryFilter === category.id
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
                "
                @click="categoryFilter = category.id"
              >
                {{ t(category.labelKey) }}
              </button>
            </div>

            <div class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto pr-1">
              <div
                v-for="template in filteredTemplates"
                :key="template.id"
                role="button"
                tabindex="0"
                class="flex cursor-pointer items-center gap-3 rounded-xl border p-2 text-left transition"
                :class="
                  activeId === template.id
                    ? 'border-blue-500 bg-blue-50/60 ring-1 ring-blue-500/30 dark:bg-blue-950/30'
                    : 'border-slate-200 hover:border-slate-300 dark:border-slate-700 dark:hover:border-slate-600'
                "
                @click="selectTemplate(template.id)"
                @keydown.enter.prevent="selectTemplate(template.id)"
              >
                <img
                  :src="template.image"
                  :alt="t(template.labelKey)"
                  class="h-16 w-16 shrink-0 rounded-lg object-cover"
                  loading="lazy"
                />
                <div class="min-w-0 flex-1">
                  <p class="truncate text-xs font-semibold text-slate-800 dark:text-slate-100">
                    {{ t(template.labelKey) }}
                  </p>
                  <p class="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                    {{
                      selectedIds.includes(template.id)
                        ? t("sceneMockup.selected")
                        : t("sceneMockup.unselected")
                    }}
                  </p>
                </div>
                <button
                  type="button"
                  class="grid h-5 w-5 shrink-0 place-items-center rounded-md border transition"
                  :class="
                    selectedIds.includes(template.id)
                      ? 'border-blue-500 bg-blue-500 text-white'
                      : 'border-slate-300 bg-white text-transparent dark:border-slate-600 dark:bg-slate-800'
                  "
                  :aria-label="t(template.labelKey)"
                  :aria-pressed="selectedIds.includes(template.id)"
                  @click.stop="toggleTemplate(template.id)"
                >
                  <AppIcon name="check" :size="12" />
                </button>
              </div>

              <p
                v-if="!filteredTemplates.length"
                class="rounded-lg border border-dashed border-slate-200 px-3 py-6 text-center text-[11px] text-slate-500 dark:border-slate-700 dark:text-slate-400"
              >
                {{ t("sceneMockup.noResults") }}
              </p>
            </div>

            <div class="shrink-0 space-y-1.5 border-t border-slate-200/80 pt-2 dark:border-slate-700/70">
              <p class="text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                {{ t("sceneMockup.calibrateHint") }}
              </p>
              <button
                type="button"
                class="inline-flex items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700/70"
                @click="resetCalibration"
              >
                <AppIcon name="rotate-ccw" :size="13" />
                {{ t("sceneMockup.resetCalibration") }}
              </button>
            </div>
          </aside>

          <section class="flex min-h-0 flex-col">
            <div
              class="relative flex min-h-0 flex-1 items-center justify-center overflow-hidden rounded-xl bg-slate-100/70 p-2 dark:bg-slate-950/40"
            >
              <div class="relative inline-flex max-h-full">
                <canvas
                  ref="previewCanvas"
                  class="block h-auto max-h-full w-auto max-w-full rounded-lg shadow-lg"
                />
                <svg
                  v-if="overlayPoints.length"
                  class="pointer-events-none absolute inset-0 h-full w-full touch-none"
                  :viewBox="`0 0 ${PREVIEW_WIDTH} ${PREVIEW_HEIGHT}`"
                  preserveAspectRatio="none"
                >
                  <polygon
                    :points="polygonPoints"
                    fill="none"
                    stroke="#38bdf8"
                    stroke-width="2"
                    stroke-dasharray="8 7"
                    vector-effect="non-scaling-stroke"
                  />
                  <!-- A small visible dot over an invisible, finger-sized hit
                       target: the corners must not hide the edge they align to. -->
                  <g v-for="(point, index) in overlayPoints" :key="index">
                    <circle
                      :cx="point[0]"
                      :cy="point[1]"
                      r="18"
                      fill="transparent"
                      class="pointer-events-auto cursor-grab touch-none"
                      @pointerdown="handlePointerDown($event, index)"
                      @dragstart.prevent
                    />
                    <circle
                      :cx="point[0]"
                      :cy="point[1]"
                      r="8"
                      fill="rgba(56,189,248,0.35)"
                      stroke="#ffffff"
                      stroke-width="2.5"
                      class="pointer-events-none"
                    />
                  </g>
                </svg>
                <div
                  v-if="previewBusy || cardBusy"
                  class="absolute inset-0 grid place-items-center rounded-lg bg-white/50 dark:bg-slate-900/50"
                >
                  <AppIcon name="loader" :size="22" class="animate-spin text-blue-600 dark:text-blue-400" />
                </div>
              </div>
            </div>

            <p v-if="error" class="mt-2 text-xs font-medium text-rose-600 dark:text-rose-400">
              {{ error }}
            </p>
            <p v-else-if="status" class="mt-2 text-xs text-slate-500 dark:text-slate-400">
              {{ status }}
            </p>
          </section>
        </div>

        <footer
          class="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200/80 px-5 py-3 dark:border-slate-700/70"
        >
          <span class="text-xs text-slate-500 dark:text-slate-400">
            {{ t("sceneMockup.selectedCount", { count: selectedTemplates.length }) }}
          </span>
          <button
            type="button"
            class="inline-flex h-9 items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 text-xs font-bold text-white shadow-sm transition hover:bg-blue-700 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
            :disabled="exporting || cardBusy || !selectedTemplates.length"
            @click="handleExport"
          >
            <AppIcon
              :name="exporting ? 'loader' : 'download'"
              :size="15"
              :class="{ 'animate-spin': exporting }"
            />
            {{ exporting ? t("sceneMockup.exporting") : t("sceneMockup.export") }}
          </button>
        </footer>
      </div>
    </div>
  </Teleport>
</template>
