<script setup>
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import AppIcon from "../AppIcon.vue";
import { SCENE_QUAD_POINTS, findSceneTemplate } from "../../config/sceneMockups.js";
import {
  composeSceneMockup,
  loadImageSource,
  loadSceneImage,
  releaseCardPixels,
} from "../../utils/sceneMockup.js";
import {
  clearImageQuadOverride,
  clearSceneQuadOverride,
  resolveSceneQuad,
  writeImageQuadOverride,
  writeSceneQuadOverride,
} from "../../storage/sceneMockupTemplates.js";

// One calibration surface for both targets: the scene default (the panel inside
// the photo) and a single image's own correction. The gallery opens the second
// kind, because a card can sit badly in one particular photo and moving every
// other image to fix it is the wrong trade.
const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
  sceneId: {
    type: String,
    default: "",
  },
  cardSrc: {
    type: String,
    default: "",
  },
  // Non-empty means the correction belongs to this gallery image only.
  imageId: {
    type: String,
    default: "",
  },
});

const emit = defineEmits(["close", "saved"]);
const { t } = useI18n();

const template = computed(() => findSceneTemplate(props.sceneId));
const sceneImage = ref(null);
const cardImage = ref(null);
const quad = ref(null);
const canvasRef = ref(null);
const containerRef = ref(null);
const dragIndex = ref(-1);
const loading = ref(false);

const CALIBRATE_LONG_SIDE = 620;
// A drag recomposites on every frame, so it renders a smaller frame; the full
// one is drawn once the pointer is released.
const CALIBRATE_DRAG_LONG_SIDE = 380;

let compositeQueued = false;
let cardSrcCache = "";

function scheduleComposite() {
  if (compositeQueued) return;
  compositeQueued = true;
  // A timeout rather than rAF: one composite already costs a frame or two, and
  // rAF never fires at all while the page is hidden.
  setTimeout(() => {
    compositeQueued = false;
    renderComposite();
  }, 16);
}

function renderComposite() {
  const canvas = canvasRef.value;
  const scene = sceneImage.value;
  const scene0 = template.value;
  if (!canvas || !scene || !scene0) return;
  const sceneWidth = scene.naturalWidth || scene.width;
  const sceneHeight = scene.naturalHeight || scene.height;
  if (!sceneWidth || !sceneHeight) return;
  const longSide = dragIndex.value >= 0 ? CALIBRATE_DRAG_LONG_SIDE : CALIBRATE_LONG_SIDE;
  const scale = Math.min(1, longSide / Math.max(sceneWidth, sceneHeight));
  const width = Math.max(2, Math.round(sceneWidth * scale));
  const height = Math.max(2, Math.round(sceneHeight * scale));
  // Assigning a size reallocates and clears the backing store: only do it when
  // the frame actually changed size.
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const context = canvas.getContext("2d");
  context.imageSmoothingQuality = "high";
  const card = cardImage.value;
  const composite =
    card && quad.value
      ? composeSceneMockup({
          sceneImage: scene,
          cardImage: card,
          quad: quad.value,
          lighting: scene0.lighting,
          cornerRadius: scene0.cornerRadius,
          fit: scene0.fit,
          width: canvas.width,
          height: canvas.height,
        })
      : null;
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(composite || scene, 0, 0, canvas.width, canvas.height);
}

function start() {
  const scene0 = template.value;
  if (!scene0) return;
  loading.value = true;
  sceneImage.value = null;
  quad.value = { ...(resolveSceneQuad(scene0.id, props.imageId) || scene0.quad) };
  if (cardSrcCache !== props.cardSrc) {
    cardSrcCache = props.cardSrc || "";
    cardImage.value = null;
  }
  loadSceneImage(scene0.image)
    .then((image) => {
      if (!props.open || template.value?.id !== scene0.id) return;
      sceneImage.value = image;
      loading.value = false;
      scheduleComposite();
    })
    .catch(() => {
      loading.value = false;
    });
  if (props.cardSrc && !cardImage.value) {
    const requested = props.cardSrc;
    loadImageSource(requested)
      .then((image) => {
        if (cardSrcCache !== requested) return;
        cardImage.value = image;
        scheduleComposite();
      })
      .catch(() => {});
  }
}

function commit() {
  const scene0 = template.value;
  if (!scene0 || !quad.value) return;
  if (props.imageId) writeImageQuadOverride(props.imageId, scene0.id, quad.value);
  else writeSceneQuadOverride(scene0.id, quad.value);
}

function stop() {
  commit();
  emit("saved");
  emit("close");
}

function reset() {
  const scene0 = template.value;
  if (!scene0) return;
  if (props.imageId) clearImageQuadOverride(props.imageId, scene0.id);
  else clearSceneQuadOverride(scene0.id);
  quad.value = { ...(resolveSceneQuad(scene0.id, props.imageId) || scene0.quad) };
  scheduleComposite();
  emit("saved");
}

watch(
  () => [props.open, props.sceneId, props.imageId],
  () => {
    if (props.open) start();
  },
  { immediate: true },
);

function onPointerDown(event, index) {
  event.preventDefault();
  event.stopPropagation();
  dragIndex.value = index;
  try {
    event.currentTarget.setPointerCapture?.(event.pointerId);
  } catch {
    // Nothing else to undo: the window listeners below already carry the drag.
  }
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp, { once: true });
  window.addEventListener("pointercancel", onPointerUp, { once: true });
}

function onPointerMove(event) {
  if (dragIndex.value < 0 || !containerRef.value || !quad.value) return;
  const rect = containerRef.value.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const x = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
  const y = Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height));
  const key = SCENE_QUAD_POINTS[dragIndex.value];
  if (!key) return;
  quad.value = { ...quad.value, [key]: [x, y] };
  scheduleComposite();
}

function onPointerUp() {
  window.removeEventListener("pointermove", onPointerMove);
  if (dragIndex.value < 0) return;
  dragIndex.value = -1;
  // Live-commit on each drag end so previews regenerate immediately, then redraw
  // the frame at full size instead of the reduced drag resolution.
  commit();
  scheduleComposite();
  emit("saved");
}

onBeforeUnmount(() => {
  window.removeEventListener("pointermove", onPointerMove);
  // The dialog is the main consumer of the cached card pixels.
  releaseCardPixels();
});

const quadClipPath = computed(() => {
  if (!quad.value) return "none";
  return `polygon(${SCENE_QUAD_POINTS.map(
    (k) =>
      `${((quad.value[k]?.[0] ?? 0) * 100).toFixed(2)}% ${((quad.value[k]?.[1] ?? 0) * 100).toFixed(2)}%`,
  ).join(", ")})`;
});

const title = computed(() => {
  const scene0 = template.value;
  if (!scene0) return t("sceneMockup.calibrate");
  const label = t(scene0.labelKey);
  return props.imageId ? `${label} · ${t("sceneMockup.calibrateForImage")}` : label;
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open && template"
      class="fixed inset-0 z-dialog flex flex-col items-center justify-center gap-3 bg-slate-950/80 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      :aria-label="t('sceneMockup.calibrate')"
    >
      <div class="flex w-full max-w-2xl items-center justify-between gap-3">
        <p class="min-w-0 truncate text-sm font-semibold text-white">{{ title }}</p>
        <div class="flex shrink-0 items-center gap-2">
          <button
            type="button"
            class="inline-flex h-7 items-center gap-1 rounded-lg border border-white/20 bg-white/10 px-2.5 text-[11px] font-semibold text-white/80 transition hover:bg-white/20"
            @click="reset"
          >
            <AppIcon name="rotate-ccw" :size="12" />
            {{ imageId ? t("sceneMockup.resetImageCalibration") : t("sceneMockup.resetCalibration") }}
          </button>
          <button
            type="button"
            class="inline-flex h-7 items-center rounded-lg bg-blue-600 px-3 text-[11px] font-semibold text-white transition hover:bg-blue-500"
            @click="stop"
          >
            {{ t("sceneMockup.calibrateDone") }}
          </button>
        </div>
      </div>

      <!-- The composited scene is the calibration surface: one canvas, so the
           handles and the picture can never disagree about the box. -->
      <div
        ref="containerRef"
        class="relative inline-flex max-h-[min(72vh,680px)] max-w-full select-none touch-none"
      >
        <canvas
          ref="canvasRef"
          :aria-label="t('sceneMockup.calibrate')"
          class="h-auto max-h-[min(72vh,680px)] w-auto max-w-full"
          :class="sceneImage ? 'block' : 'hidden'"
        />
        <div v-if="!sceneImage || loading" class="grid min-h-40 min-w-40 place-items-center text-white/60">
          <AppIcon name="spinner" :size="24" class="animate-spin" />
        </div>

        <div
          v-if="quad && !cardImage"
          class="pointer-events-none absolute inset-0"
          :style="{ background: 'rgba(59,130,246,0.18)', clipPath: quadClipPath }"
        />

        <template v-if="quad && sceneImage">
          <button
            v-for="(key, index) in SCENE_QUAD_POINTS"
            :key="key"
            type="button"
            class="absolute z-10 -ml-1.5 -mt-1.5 h-3 w-3 touch-none rounded-full border border-white/95 bg-blue-600/85 shadow-sm outline-none ring-offset-1 transition after:absolute after:-inset-2 after:content-[''] hover:scale-125 hover:bg-blue-600 focus-visible:ring-2 focus-visible:ring-blue-300"
            :style="{
              left: `${(quad[key]?.[0] ?? 0) * 100}%`,
              top: `${(quad[key]?.[1] ?? 0) * 100}%`,
              cursor: dragIndex === index ? 'grabbing' : 'grab',
            }"
            :aria-label="key"
            @pointerdown="onPointerDown($event, index)"
            @dragstart.prevent
            @contextmenu.prevent
          />
        </template>
      </div>

      <p class="max-w-2xl text-center text-xs text-white/70">
        {{ imageId ? t("sceneMockup.calibrateImageHint") : t("sceneMockup.calibrateHint") }}
      </p>
    </div>
  </Teleport>
</template>
