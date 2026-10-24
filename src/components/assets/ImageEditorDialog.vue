<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import AppIcon from "../AppIcon.vue";
import { loadImage } from "../../utils/imageFiles.js";
import {
  IMAGE_EDIT_RATIOS,
  IMAGE_FILTERS,
  getImageFilterCss,
  imageEditedDataUrl,
  renderEditedImage,
} from "../../utils/imageEditor.js";

const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
  asset: {
    type: Object,
    default: null,
  },
  getSource: {
    type: Function,
    required: true,
  },
});

const emit = defineEmits(["close", "save"]);
const { t } = useI18n();

const previewCanvas = ref(null);
const source = ref("");
const imageElement = ref(null);
const loading = ref(false);
const saving = ref(false);
const error = ref("");
const rotate = ref(0);
const flipX = ref(false);
const flipY = ref(false);
const ratio = ref("original");
const focal = ref({ x: 0.5, y: 0.5 });
const filter = ref("none");
let loadVersion = 0;

const filterCss = computed(() => getImageFilterCss(filter.value));
const sourceDimensions = computed(() => {
  const image = imageElement.value;
  return image ? `${image.naturalWidth} × ${image.naturalHeight}` : "";
});

function resetControls() {
  rotate.value = 0;
  flipX.value = false;
  flipY.value = false;
  ratio.value = "original";
  focal.value = { x: 0.5, y: 0.5 };
  filter.value = "none";
  error.value = "";
}

async function loadAsset() {
  if (!props.open || !props.asset?.assetId) return;
  const version = ++loadVersion;
  loading.value = true;
  error.value = "";
  source.value = "";
  imageElement.value = null;
  resetControls();
  try {
    const dataUrl = await props.getSource(props.asset.assetId);
    if (version !== loadVersion) return;
    if (!dataUrl) throw new Error(t("imageEditor.loadFailed"));
    source.value = dataUrl;
    const image = await loadImage(dataUrl);
    if (version !== loadVersion) return;
    imageElement.value = image;
    await nextTick();
    await renderPreview();
  } catch (err) {
    if (version === loadVersion) {
      error.value = err?.message || t("imageEditor.loadFailed");
    }
  } finally {
    if (version === loadVersion) loading.value = false;
  }
}

async function renderPreview() {
  if (!imageElement.value || !previewCanvas.value) return;
  const canvas = renderEditedImage(imageElement.value, {
    rotate: rotate.value,
    flipX: flipX.value,
    flipY: flipY.value,
    ratio: ratio.value,
    focal: focal.value,
    filter: filter.value,
    maxSize: 900,
  });
  if (!canvas) return;
  previewCanvas.value.width = canvas.width;
  previewCanvas.value.height = canvas.height;
  const context = previewCanvas.value.getContext("2d");
  if (!context) return;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(canvas, 0, 0);
}

function setRatio(value) {
  ratio.value = value;
}

function setFocal(x, y) {
  focal.value = { x, y };
}

function isFocal(x, y) {
  return Math.abs(focal.value.x - x) < 0.02 && Math.abs(focal.value.y - y) < 0.02;
}

function rotateBy(degrees) {
  rotate.value = ((rotate.value + degrees) % 360 + 360) % 360;
}

function reset() {
  resetControls();
}

function close() {
  if (saving.value) return;
  emit("close");
}

function save() {
  if (!imageElement.value || saving.value) return;
  saving.value = true;
  try {
    const dataUrl = imageEditedDataUrl(imageElement.value, {
      rotate: rotate.value,
      flipX: flipX.value,
      flipY: flipY.value,
      ratio: ratio.value,
      focal: focal.value,
      filter: filter.value,
      maxSize: 2400,
    });
    if (!dataUrl) throw new Error(t("imageEditor.saveFailed"));
    emit("save", {
      dataUrl,
      fileName: `${props.asset?.name || "image"}-edited.png`,
      mediaType: "image/png",
      derivedFrom: props.asset?.assetId || "",
    });
  } catch (err) {
    error.value = err?.message || t("imageEditor.saveFailed");
  } finally {
    saving.value = false;
  }
}

watch(
  () => [props.open, props.asset?.assetId],
  () => {
    if (props.open) loadAsset();
    else source.value = "";
  },
  { immediate: true },
);

watch(
  [rotate, flipX, flipY, ratio, focal, filter],
  () => {
    renderPreview();
  },
  { deep: true },
);

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
      class="fixed inset-0 z-dialog-raised flex items-center justify-center bg-slate-950/60 p-3 backdrop-blur-sm sm:p-5"
      role="dialog"
      aria-modal="true"
      :aria-label="t('imageEditor.title')"
      @click.self="close"
    >
      <div class="flex h-[min(92vh,860px)] w-[min(96vw,1180px)] min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-2xl dark:border-slate-700/80 dark:bg-slate-900">
        <header class="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200/80 px-4 py-3 dark:border-slate-800">
          <div class="flex min-w-0 items-center gap-2.5">
            <span class="grid h-8 w-8 place-items-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-300">
              <AppIcon name="sliders" :size="16" />
            </span>
            <div class="min-w-0">
              <h2 class="truncate text-sm font-bold dark:text-slate-100">{{ t("imageEditor.title") }}</h2>
              <p class="truncate text-[11px] text-slate-500 dark:text-slate-400">
                {{ asset?.name || asset?.fileName }} · {{ sourceDimensions }}
              </p>
            </div>
          </div>
          <button
            type="button"
            class="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            :aria-label="t('imageEditor.close')"
            @click="close"
          >
            <AppIcon name="x" :size="16" />
          </button>
        </header>

        <div class="flex min-h-0 flex-1 flex-col lg:flex-row">
          <section class="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-[linear-gradient(45deg,#e2e8f0_25%,transparent_25%,transparent_75%,#e2e8f0_75%,#e2e8f0),linear-gradient(45deg,#e2e8f0_25%,#f8fafc_25%,#f8fafc_75%,#e2e8f0_75%,#e2e8f0)] bg-[length:18px_18px] bg-[position:0_0,9px_9px] p-5 dark:bg-[linear-gradient(45deg,#1e293b_25%,transparent_25%,transparent_75%,#1e293b_75%,#1e293b),linear-gradient(45deg,#1e293b_25%,#0f172a_25%,#0f172a_75%,#1e293b_75%,#1e293b)]">
            <div v-if="loading" class="flex flex-col items-center gap-2 text-slate-500">
              <AppIcon name="loader" :size="24" class="animate-spin" />
              <span class="text-xs">{{ t("imageEditor.loading") }}</span>
            </div>
            <canvas
              v-show="!loading && source"
              ref="previewCanvas"
              class="max-h-[58vh] max-w-full rounded-lg shadow-2xl"
              :aria-label="t('imageEditor.preview')"
            ></canvas>
            <p v-if="error" class="max-w-xs text-center text-xs text-rose-500">{{ error }}</p>
          </section>

          <aside class="w-full shrink-0 overflow-y-auto border-t border-slate-200/80 p-4 dark:border-slate-800 lg:w-[300px] lg:border-l lg:border-t-0">
            <div class="space-y-4">
              <div>
                <span class="text-[11px] font-semibold text-slate-500 dark:text-slate-400">{{ t("imageEditor.aspect") }}</span>
                <div class="mt-1 grid grid-cols-2 gap-1">
                  <button
                    v-for="item in IMAGE_EDIT_RATIOS"
                    :key="item.id"
                    type="button"
                    class="h-8 rounded-lg border text-[11px] font-semibold"
                    :class="ratio === item.id ? 'border-blue-400 bg-blue-50 text-blue-600 dark:border-blue-500/70 dark:bg-blue-950/30 dark:text-blue-300' : 'border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300'"
                    @click="setRatio(item.id)"
                  >
                    {{ t(item.labelKey) }}
                  </button>
                </div>
              </div>

              <div>
                <span class="text-[11px] font-semibold text-slate-500 dark:text-slate-400">{{ t("imageEditor.focal") }}</span>
                <div class="mt-1 grid w-32 grid-cols-3 gap-1 rounded-lg border border-slate-200 p-1 dark:border-slate-700">
                  <button
                    v-for="cell in 9"
                    :key="cell"
                    type="button"
                    class="grid h-8 place-items-center rounded-md text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800"
                    :style="
                      isFocal(
                        [0, 0.5, 1][(cell - 1) % 3],
                        [0, 0.5, 1][Math.floor((cell - 1) / 3)],
                      )
                        ? { backgroundColor: '#2563eb', color: '#ffffff' }
                        : undefined
                    "
                    :aria-label="t('imageEditor.focalPoint', { index: cell })"
                    @click="setFocal([0, 0.5, 1][(cell - 1) % 3], [0, 0.5, 1][Math.floor((cell - 1) / 3)])"
                  >
                    <span class="h-1.5 w-1.5 rounded-full bg-current"></span>
                  </button>
                </div>
              </div>

              <div>
                <span class="text-[11px] font-semibold text-slate-500 dark:text-slate-400">{{ t("imageEditor.transform") }}</span>
                <div class="mt-1 grid grid-cols-4 gap-1">
                  <button type="button" class="inline-flex h-8 items-center justify-center rounded-lg border border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300" :title="t('imageEditor.rotateLeft')" @click="rotateBy(-90)">
                    <AppIcon name="rotate-ccw" :size="14" />
                  </button>
                  <button type="button" class="inline-flex h-8 items-center justify-center rounded-lg border border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300" :title="t('imageEditor.rotateRight')" @click="rotateBy(90)">
                    <AppIcon name="rotate-cw" :size="14" />
                  </button>
                  <button type="button" class="inline-flex h-8 items-center justify-center rounded-lg border text-slate-600 dark:text-slate-300" :class="flipX ? 'border-blue-400 bg-blue-50 dark:border-blue-500/70 dark:bg-blue-950/30' : 'border-slate-200 dark:border-slate-700'" :title="t('imageEditor.flipHorizontal')" @click="flipX = !flipX">
                    <AppIcon name="flip-horizontal" :size="14" />
                  </button>
                  <button type="button" class="inline-flex h-8 items-center justify-center rounded-lg border text-slate-600 dark:text-slate-300" :class="flipY ? 'border-blue-400 bg-blue-50 dark:border-blue-500/70 dark:bg-blue-950/30' : 'border-slate-200 dark:border-slate-700'" :title="t('imageEditor.flipVertical')" @click="flipY = !flipY">
                    <AppIcon name="flip-vertical" :size="14" />
                  </button>
                </div>
              </div>

              <div>
                <span class="text-[11px] font-semibold text-slate-500 dark:text-slate-400">{{ t("imageEditor.filter") }}</span>
                <div class="mt-1 grid grid-cols-2 gap-1">
                  <button
                    v-for="item in IMAGE_FILTERS"
                    :key="item.id"
                    type="button"
                    class="h-8 rounded-lg border text-[11px] font-semibold"
                    :class="filter === item.id ? 'border-blue-400 bg-blue-50 text-blue-600 dark:border-blue-500/70 dark:bg-blue-950/30 dark:text-blue-300' : 'border-slate-200 text-slate-600 dark:border-slate-700 dark:text-slate-300'"
                    @click="filter = item.id"
                  >
                    {{ t(item.labelKey) }}
                  </button>
                </div>
              </div>

              <p class="rounded-lg bg-slate-50 px-2.5 py-2 text-[10px] leading-5 text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
                {{ t("imageEditor.hint") }}
              </p>
            </div>
          </aside>
        </div>

        <footer class="flex shrink-0 items-center justify-between gap-3 border-t border-slate-200/80 px-4 py-2.5 dark:border-slate-800">
          <button type="button" class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800" @click="reset">
            <AppIcon name="refresh" :size="13" />
            {{ t("imageEditor.reset") }}
          </button>
          <div class="flex items-center gap-2">
            <button type="button" class="h-8 rounded-lg px-3 text-xs font-semibold text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800" @click="close">
              {{ t("imageEditor.cancel") }}
            </button>
            <button type="button" class="inline-flex h-8 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-xs font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50" :disabled="!source || saving" @click="save">
              <AppIcon :name="saving ? 'loader' : 'check'" :size="14" :class="{ 'animate-spin': saving }" />
              {{ saving ? t("imageEditor.saving") : t("imageEditor.saveAsNew") }}
            </button>
          </div>
        </footer>
      </div>
    </div>
  </Teleport>
</template>
