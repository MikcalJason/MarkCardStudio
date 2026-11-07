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
import { autoFitQuad } from "../../utils/sceneAutoFit.js";

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

// The canvas backing store (canvas.width/height) is reallocated between the
// full and reduced drag resolutions, but the on-screen size must stay put or
// the picture visibly shrinks mid-drag and the handles jump. So the CSS size is
// computed once from the scene's aspect ratio and the viewport, and the backing
// store is never allowed to resize the element.
const canvasStyle = ref({});

function computeDisplaySize() {
  const scene = sceneImage.value;
  const sw = scene?.naturalWidth || scene?.width || 0;
  const sh = scene?.naturalHeight || scene?.height || 0;
  if (!sw || !sh) return;
  const maxH = Math.min(window.innerHeight * 0.72, 680);
  const maxW = Math.max(160, window.innerWidth - 32);
  const ratio = sw / sh;
  let w = maxW;
  let h = w / ratio;
  if (h > maxH) {
    h = maxH;
    w = h * ratio;
  }
  if (w < 160) {
    w = 160;
    h = w / ratio;
  }
  canvasStyle.value = { width: `${Math.round(w)}px`, height: `${Math.round(h)}px` };
}

function onWindowResize() {
  computeDisplaySize();
}
window.addEventListener("resize", onWindowResize);

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
          fast: dragIndex.value >= 0,
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
  initialQuad.value = { ...quad.value };
  if (cardSrcCache !== props.cardSrc) {
    cardSrcCache = props.cardSrc || "";
    cardImage.value = null;
  }
  loadSceneImage(scene0.image)
    .then((image) => {
      if (!props.open || template.value?.id !== scene0.id) return;
      sceneImage.value = image;
      loading.value = false;
      computeDisplaySize();
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

// Only a real drag is worth storing: writing an unchanged quad still forces a
// full scene re-composite (and an override the user never made).
const initialQuad = ref(null);

function sameQuad(a, b) {
  if (!a || !b) return false;
  return SCENE_QUAD_POINTS.every((key) => {
    const first = a[key];
    const second = b[key];
    if (!first || !second) return false;
    return Math.abs(first[0] - second[0]) < 0.0005 && Math.abs(first[1] - second[1]) < 0.0005;
  });
}

function commit() {
  const scene0 = template.value;
  if (!scene0 || !quad.value) return false;
  if (sameQuad(quad.value, initialQuad.value)) return false;
  if (props.imageId) writeImageQuadOverride(props.imageId, scene0.id, quad.value);
  else writeSceneQuadOverride(scene0.id, quad.value);
  initialQuad.value = { ...quad.value };
  return true;
}

function stop() {
  if (commit()) emit("saved");
  emit("close");
}

function reset() {
  const scene0 = template.value;
  if (!scene0) return;
  if (props.imageId) clearImageQuadOverride(props.imageId, scene0.id);
  else clearSceneQuadOverride(scene0.id);
  quad.value = { ...(resolveSceneQuad(scene0.id, props.imageId) || scene0.quad) };
  initialQuad.value = { ...quad.value };
  scheduleComposite();
  emit("saved");
}

// One-click alignment: snap the four edges onto the photo's real boundaries.
// The detector only moves an edge when it finds a confident line inside a
// narrow band around it, and rejects the whole fit when a corner would have to
// travel implausibly far — so a busy photo leaves the quad untouched instead of
// scattering it.
const autoFitNotice = ref("");
let autoFitNoticeTimer = 0;

function showAutoFitNotice(text) {
  autoFitNotice.value = text;
  clearTimeout(autoFitNoticeTimer);
  autoFitNoticeTimer = setTimeout(() => {
    autoFitNotice.value = "";
  }, 2600);
}

function autoFit() {
  const scene0 = template.value;
  if (!scene0 || !sceneImage.value || !quad.value) return;
  const fitted = autoFitQuad(sceneImage.value, quad.value);
  // No confident edge anywhere leaves the quad untouched, which would otherwise
  // read as a dead button rather than as "nothing found in this photo".
  if (!fitted || sameQuad(fitted, quad.value)) {
    showAutoFitNotice(t("sceneMockup.autoFitFailed"));
    return;
  }
  quad.value = fitted;
  const changed = commit();
  scheduleComposite();
  if (changed) emit("saved");
}

watch(
  () => [props.open, props.sceneId, props.imageId],
  () => {
    if (props.open) start();
  },
  { immediate: true },
);

let dragPointerId = -1;

function onPointerDown(event, index) {
  event.preventDefault();
  event.stopPropagation();
  dragIndex.value = index;
  dragPointerId = event.pointerId;
  // The window-level move/up listeners already carry the drag across the whole
  // dialog, so pointer capture is unnecessary — and its residual capture state
  // is what made the second press ignore pointerdown on some WebKit builds.
  window.addEventListener("pointermove", onPointerMove);
  window.addEventListener("pointerup", onPointerUp);
  window.addEventListener("pointercancel", onPointerCancel);
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

function endDrag(event) {
  if (event && dragPointerId >= 0 && event.pointerId !== dragPointerId) return;
  window.removeEventListener("pointermove", onPointerMove);
  window.removeEventListener("pointerup", onPointerUp);
  window.removeEventListener("pointercancel", onPointerCancel);
  if (dragIndex.value < 0) return;
  dragIndex.value = -1;
  dragPointerId = -1;
  // Live-commit on each drag end so previews regenerate immediately, then redraw
  // the frame at full size instead of the reduced drag resolution.
  const changed = commit();
  scheduleComposite();
  // A bare click (no actual corner move) must not trigger a gallery-wide
  // re-composite: that work steals the very next drag's frame budget.
  if (changed) emit("saved");
}

function onPointerUp(event) {
  endDrag(event);
}

function onPointerCancel(event) {
  endDrag(event);
}

onBeforeUnmount(() => {
  clearTimeout(autoFitNoticeTimer);
  window.removeEventListener("pointermove", onPointerMove);
  window.removeEventListener("pointerup", onPointerUp);
  window.removeEventListener("pointercancel", onPointerCancel);
  window.removeEventListener("resize", onWindowResize);
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
        <p
          class="min-w-0 truncate text-sm font-semibold"
          :class="autoFitNotice ? 'text-amber-300' : 'text-white'"
        >{{ autoFitNotice || title }}</p>
        <div class="flex shrink-0 items-center gap-2">
          <button
            type="button"
            class="inline-flex h-7 items-center gap-1 rounded-lg border border-white/20 bg-white/10 px-2.5 text-[11px] font-semibold text-white/80 transition hover:bg-white/20 disabled:opacity-60"
            :disabled="!sceneImage"
            @click="autoFit"
          >
            <AppIcon name="sparkles" :size="12" />
            {{ t("sceneMockup.autoFit") }}
          </button>
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
          :class="sceneImage ? 'block' : 'hidden'"
          :style="canvasStyle"
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
            class="absolute z-10 -ml-1.5 -mt-1.5 h-3 w-3 touch-none rounded-full border border-white/95 bg-blue-600/85 shadow-sm outline-none ring-offset-1 transition-colors after:absolute after:-inset-2 after:content-[''] hover:bg-blue-600 focus-visible:ring-2 focus-visible:ring-blue-300"
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
