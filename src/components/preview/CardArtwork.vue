<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import {
  getCardLayoutClass,
  parseBlocks,
  renderBlocksToHtml,
  renderMermaidDiagrams,
  renderEChartsDiagrams,
  disposeEChartsDiagrams,
} from "../../composables/useContentParser.js";
import { getCoverStickers } from "../../config/coverStickers.js";
import { galleryFontStack, normalizeGalleryType } from "../../config/galleryTypography.js";
import { tintGradient } from "../../utils/imageTint.js";
import CoverDesignArtwork from "../cover/CoverDesignArtwork.vue";

const props = defineProps({
  page: { type: Object, required: true },
  pageIndex: { type: Number, default: 0 },
  pagesLength: { type: Number, default: 1 },
  selectedPlatform: {
    type: Object,
    default: () => ({ width: 1080, height: 1440, name: "小红书", ratio: "3:4" }),
  },
  selectedThemeClass: { type: String, required: true },
  transparentBackground: { type: Boolean, default: false },
  backgroundColor: { type: String, default: "#69eacb" },
  backgroundType: { type: String, default: "gradient" },
  backgroundValue: {
    type: String,
    default: "linear-gradient(135deg, #69eacb 0%, #eaccf8 48%, #6654f1 100%)",
  },
  showPageNumber: { type: Boolean, default: true },
  showTopLeft: { type: Boolean, default: true },
  showTopRight: { type: Boolean, default: true },
  showBottomLeft: { type: Boolean, default: true },
  showBottomRight: { type: Boolean, default: true },
  customFontFamily: { type: String, default: "" },
  autoPrepare: { type: Boolean, default: true },
});

const emit = defineEmits(["move-overlay-item"]);

const { t } = useI18n();
const canvasElement = ref(null);
const scrollAreaElement = ref(null);
const detectedOverflow = ref(false);
let prepareVersion = 0;

const geometry = computed(() => {
  const width = Number(props.selectedPlatform?.width) || 1080;
  const height = Number(props.selectedPlatform?.height) || 1440;
  const designWidth = width > height ? 640 : 450;
  return {
    width: designWidth,
    height: Math.max(1, Math.round(designWidth * (height / width))),
  };
});

const cardLayoutClass = computed(() => getCardLayoutClass(
  props.selectedPlatform?.width,
  props.selectedPlatform?.height,
));

// Raw mode means "the image is the card", so an empty page keeps the themed
// chrome and its add-image prompt instead of rendering a bare dark rectangle.
const isRawGallery = computed(
  () => props.page?.gallery?.mode === "raw" && !props.page?.gallery?.empty,
);

// Gallery cards and designed covers carry their own palette, so the theme
// tokens would only fight them: no theme class, no themed header/footer, and no
// themed wallpaper around them.
const isGallerySurface = computed(() => Boolean(props.page?.gallery || props.page?.coverDesign));

const overlayItems = computed(() =>
  Array.isArray(props.page?.gallery?.overlay) ? props.page.gallery.overlay : [],
);

// The backdrop comes from the card's own picture so a photo never sits on an
// unrelated wallpaper. Blur is baked into a tiny raster at import time rather
// than done with CSS, which the export clone handles unreliably.
const galleryTint = computed(() => {
  const gallery = props.page?.gallery;
  if (!gallery || gallery.empty || isRawGallery.value) return null;
  if (gallery.background !== "blurred" && gallery.background !== "tint") return null;
  return gallery.tint?.average || gallery.tint?.backdrop ? gallery.tint : null;
});

const galleryBackdropSrc = computed(() =>
  props.page?.gallery?.background === "blurred" && !props.transparentBackground
    ? galleryTint.value?.backdrop || ""
    : "",
);

// Title and caption sizes resolve to px from the card design width and reach the
// stylesheet as custom properties, so preview and the export clone agree.
const galleryTypeStyle = computed(() => {
  const type = normalizeGalleryType(props.page?.gallery?.type);
  const style = {
    "--gallery-title-size": `${Math.max(10, Math.round(type.titleRatio * geometry.value.width))}px`,
    "--gallery-title-weight": String(type.titleWeight),
    "--gallery-caption-size": `${Math.max(9, Math.round(type.captionRatio * geometry.value.width))}px`,
  };
  const stack = galleryFontStack(type.fontId, props.customFontFamily);
  if (stack) style["--gallery-font"] = stack;
  return style;
});

// Decoration sizes are resolved to px from the card design width instead of
// container-query units: the export clone is rendered inside a foreignObject,
// where `cqw` is unreliable, while px survives both preview and capture.
function overlaySizePx(item) {
  return Math.max(6, Math.round(item.size * geometry.value.width));
}

function overlayPositionStyle(item) {
  const isSticker = item.kind === "sticker";
  return {
    left: `${item.x * 100}%`,
    top: `${item.y * 100}%`,
    width: isSticker ? `${overlaySizePx(item)}px` : undefined,
    height: isSticker ? `${overlaySizePx(item)}px` : undefined,
    fontSize: isSticker ? undefined : `${overlaySizePx(item)}px`,
    transform: `translate(-50%, -50%) rotate(${item.rotate}deg)`,
  };
}

// Previews may drag decorations directly; the export clone (autoPrepare: false)
// must stay static. The position is only written back on pointerup so an
// in-flight drag does not rebuild the page on every pointermove.
const overlaysDraggable = computed(
  () => Boolean(props.page?.gallery) && !props.page?.gallery?.empty && props.autoPrepare !== false,
);
const dragPositions = ref({});
let overlayDragSession = null;

function overlayItemStyle(item) {
  const dragged = dragPositions.value[item.id];
  return overlayPositionStyle(dragged ? { ...item, ...dragged } : item);
}

function beginOverlayDrag(event) {
  if (!overlaysDraggable.value) return;
  const target = event.currentTarget;
  const id = target?.dataset?.overlayId;
  const container = target?.closest?.(".gallery-overlay");
  if (!id || !container) return;
  event.preventDefault();
  event.stopPropagation();
  overlayDragSession = { id, rect: container.getBoundingClientRect() };
  window.addEventListener("pointermove", moveOverlayDrag);
  window.addEventListener("pointerup", endOverlayDrag, { once: true });
  window.addEventListener("pointercancel", endOverlayDrag, { once: true });
}

function moveOverlayDrag(event) {
  if (!overlayDragSession) return;
  const { rect, id } = overlayDragSession;
  const x = Math.min(1, Math.max(0, (event.clientX - rect.left) / Math.max(1, rect.width)));
  const y = Math.min(1, Math.max(0, (event.clientY - rect.top) / Math.max(1, rect.height)));
  dragPositions.value = { ...dragPositions.value, [id]: { x, y } };
}

function endOverlayDrag() {
  if (!overlayDragSession) return;
  const { id } = overlayDragSession;
  const position = dragPositions.value[id];
  overlayDragSession = null;
  window.removeEventListener("pointermove", moveOverlayDrag);
  window.removeEventListener("pointercancel", endOverlayDrag);
  if (position) emit("move-overlay-item", { id, ...position });
}

const posterCanvasStyle = computed(() => {
  const dimensions = {
    width: `${geometry.value.width}px`,
    height: `${geometry.value.height}px`,
  };
  const typography = props.customFontFamily
    ? { "--markcard-custom-font": `"${props.customFontFamily}", sans-serif` }
    : {};

  // Raw gallery pages show the source image alone, so theme chrome and the
  // document wallpaper must not leak behind or around it.
  if (isRawGallery.value) {
    return {
      ...dimensions,
      ...typography,
      background: props.transparentBackground ? "transparent" : "#0b1220",
      backgroundColor: props.transparentBackground ? "transparent" : "#0b1220",
      backgroundImage: "none",
    };
  }

  // Transparency wins over every sampled backdrop; exporting a transparent PNG
  // must never bake an opaque tint into the frame.
  if (props.transparentBackground) {
    return {
      ...dimensions,
      ...typography,
      background: "transparent",
      backgroundColor: "transparent",
      backgroundImage: "none",
    };
  }

  // A theme-free surface for gallery cards and designed covers: sampled tint
  // when one is chosen, otherwise a neutral matte instead of the theme wallpaper.
  if (isGallerySurface.value) {
    if (galleryTint.value) {
      return {
        ...dimensions,
        ...typography,
        background: galleryTint.value.average,
        backgroundImage:
          props.page.gallery?.background === "tint" && !galleryBackdropSrc.value
            ? tintGradient(galleryTint.value)
            : "none",
      };
    }
    return {
      ...dimensions,
      ...typography,
      background: "#0b1220",
      backgroundColor: "#0b1220",
      backgroundImage: "none",
    };
  }

  if (props.backgroundType === "solid") {
    const background = props.backgroundValue || props.backgroundColor || "#fff7e9";
    return {
      ...dimensions,
      ...typography,
      background,
      backgroundColor: background,
      backgroundImage: "none",
    };
  }

  if (props.backgroundType === "gradient" || props.backgroundType === "pattern") {
    return {
      ...dimensions,
      ...typography,
      background: props.backgroundValue,
      backgroundImage: props.backgroundValue,
    };
  }

  if (props.backgroundType === "image" || props.backgroundType === "wallpaper") {
    if (/^(data:|https?:|blob:|\/)/i.test(props.backgroundValue || "")) {
      return {
        ...dimensions,
        ...typography,
        backgroundImage: `url('${props.backgroundValue}')`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
      };
    }
    return {
      ...dimensions,
      ...typography,
      background: props.backgroundValue,
      backgroundImage: props.backgroundValue,
    };
  }

  return {
    ...dimensions,
    ...typography,
    backgroundColor: props.backgroundColor || "#fff7e9",
  };
});

const renderedBody = computed(() => {
  const blocks = props.page?.blocks
    ?? parseBlocks(props.page?.bodyMarkdown ?? props.page?.body ?? "");
  return renderBlocksToHtml(blocks);
});

const coverStickers = computed(() => {
  if (!props.page?.cover || props.page?.coverDesign) return [];
  if (Array.isArray(props.page.stickers) && props.page.stickers.length) {
    return props.page.stickers;
  }
  return getCoverStickers(props.selectedThemeClass);
});
const hasOversizeBlock = computed(() => (
  props.page?.blocks?.some((block) => block?.oversize) || false
));

const defaultDateString = computed(() => {
  const now = new Date();
  return `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, "0")}.${String(now.getDate()).padStart(2, "0")}`;
});

function waitForImage(image) {
  if (image.complete) return image.decode?.().catch(() => undefined) ?? Promise.resolve();
  return new Promise((resolve) => {
    image.addEventListener("load", resolve, { once: true });
    image.addEventListener("error", resolve, { once: true });
  }).then(() => image.decode?.().catch(() => undefined));
}

async function prepareContent() {
  const version = ++prepareVersion;
  await nextTick();
  if (!canvasElement.value || version !== prepareVersion) return;
  await renderMermaidDiagrams(canvasElement.value);
  await renderEChartsDiagrams(canvasElement.value);
  if (document.fonts?.ready) await document.fonts.ready;
  await Promise.all(Array.from(canvasElement.value.querySelectorAll("img")).map(waitForImage));
  if (version !== prepareVersion) return;
  replaceBrokenContentImages();
  await nextTick();
  detectedOverflow.value = hasOverflow();
}

function replaceBrokenContentImages() {
  for (const image of canvasElement.value?.querySelectorAll("img.card-image, img.card-inline-image") || []) {
    if (image.complete && image.naturalWidth > 0) continue;
    const isInline = image.classList.contains("card-inline-image");
    const fallback = document.createElement(isInline ? "span" : "p");
    if (!isInline) fallback.className = "card-paragraph";
    fallback.textContent = image.getAttribute("data-original-markdown")
      || `![${image.alt || ""}](${image.getAttribute("src") || ""})`;
    const wrapper = image.closest(".card-image-wrap, .card-inline-image-wrap");
    (wrapper || image).replaceWith(fallback);
  }
}

function hasOverflow() {
  if (props.page?.gallery || props.page?.coverDesign) return false;
  const area = scrollAreaElement.value;
  return Boolean(area && area.scrollHeight > area.clientHeight + 1);
}

watch(
  () => [props.page, props.selectedThemeClass, props.selectedPlatform?.width, props.selectedPlatform?.height, props.customFontFamily],
  () => {
    detectedOverflow.value = false;
    if (props.autoPrepare) prepareContent();
  },
  { immediate: true, deep: true },
);

onBeforeUnmount(() => {
  disposeEChartsDiagrams(canvasElement.value);
  window.removeEventListener("pointermove", moveOverlayDrag);
  window.removeEventListener("pointercancel", endOverlayDrag);
});

defineExpose({
  getCanvasElement: () => canvasElement.value,
  getScrollAreaElement: () => scrollAreaElement.value,
  hasOverflow,
  prepareContent,
});
</script>

<template>
  <div
    ref="canvasElement"
    class="poster-canvas-frame relative flex flex-col justify-between overflow-hidden p-5 select-none"
    :class="{ 'has-custom-font': customFontFamily, 'poster-canvas-frame--raw': isRawGallery, 'poster-canvas-frame--gallery': isGallerySurface }"
    :style="posterCanvasStyle"
  >
    <img
      v-if="galleryBackdropSrc"
      class="poster-backdrop"
      :src="galleryBackdropSrc"
      alt=""
      aria-hidden="true"
    />
    <div
      v-if="(showTopLeft || showTopRight) && !isRawGallery && !isGallerySurface"
      class="poster-header z-10 flex min-h-[24px] items-center justify-between px-1 pb-2 text-xs font-semibold text-slate-800 drop-shadow-xs dark:text-slate-100"
    >
      <div class="flex items-center gap-1.5">
        <span
          v-if="showTopLeft"
          class="inline-flex items-center rounded-md bg-black/10 px-2 py-0.5 text-[11px] font-bold tracking-wide backdrop-blur-xs dark:bg-white/15"
        >
          {{ page.kicker || "@MarkCard" }}
        </span>
      </div>
      <div v-if="showTopRight && showPageNumber" class="font-mono text-[11px] font-bold opacity-80">
        {{ String(pageIndex + 1).padStart(2, "0") }} / {{ String(pagesLength || 1).padStart(2, "0") }}
      </div>
    </div>

    <article
      class="card-canvas group/card relative flex h-full w-full flex-1 flex-col overflow-hidden rounded-xl border border-black/5 shadow-md dark:border-white/10"
      :class="[isGallerySurface ? null : selectedThemeClass, cardLayoutClass, { 'is-cover': page.cover, 'card-canvas--raw': isRawGallery, 'card-canvas--gallery': isGallerySurface }]"
    >
      <div class="leaf-shadow top"></div>
      <div class="leaf-shadow side"></div>

      <div v-if="coverStickers.length" class="cover-sticker-layer" aria-hidden="true">
        <img
          v-for="sticker in coverStickers"
          :key="sticker.id || `${sticker.src}-${sticker.position}`"
          :src="sticker.src"
          alt=""
          class="cover-sticker"
          :class="`cover-sticker--${sticker.position}`"
          loading="eager"
          draggable="false"
        />
      </div>

      <div
        ref="scrollAreaElement"
        class="card-scroll-area"
        :class="{
          'card-scroll-area--gallery': page.gallery,
          'card-scroll-area--cover-design': page.coverDesign,
        }"
      >
        <div v-if="page.coverDesign" class="card-cover-layer">
          <CoverDesignArtwork :design="page.coverDesign" />
        </div>

        <template v-else-if="page.gallery">
          <figure
            v-if="!page.gallery.empty"
            class="card-gallery"
            :class="[
              `card-gallery--${page.gallery.fit || 'cover'}`,
              {
                'card-gallery--framed': page.gallery.frame === 'framed' && !isRawGallery,
                'card-gallery--raw': isRawGallery,
              },
            ]"
            :style="galleryTypeStyle"
          >
            <img
              v-if="page.gallery.src"
              :src="page.gallery.src"
              :alt="page.gallery.alt || page.gallery.caption || ''"
              class="card-gallery__image"
              loading="eager"
              draggable="false"
            />
            <div v-else class="card-gallery__empty">
              <span class="card-gallery__empty-mark">+</span>
              <span class="card-gallery__empty-title">{{ t("gallery.missingImage") }}</span>
              <span class="card-gallery__empty-desc">{{ t("gallery.missingImageDesc") }}</span>
            </div>

            <template v-if="!isRawGallery">
              <div class="card-gallery__shade"></div>
              <h2
                v-if="page.cover && page.title"
                class="card-gallery__title"
              >
                {{ page.title }}
              </h2>
              <figcaption
                v-if="page.gallery.showCaptions !== false && page.gallery.caption"
                class="card-gallery__caption"
              >
                {{ page.gallery.caption }}
              </figcaption>
              <span v-if="page.gallery.showNumbers === true" class="card-gallery__count">
                {{ String(page.gallery.index + 1).padStart(2, "0") }} / {{ String(page.gallery.total).padStart(2, "0") }}
              </span>
            </template>

            <div
              v-if="overlayItems.length"
              class="gallery-overlay"
              :class="{ 'gallery-overlay--interactive': overlaysDraggable }"
              aria-hidden="true"
            >
              <template v-for="item in overlayItems" :key="item.id">
                <img
                  v-if="item.kind === 'sticker'"
                  :src="item.src"
                  :alt="item.alt || ''"
                  class="gallery-sticker"
                  :style="overlayItemStyle(item)"
                  :data-overlay-id="item.id"
                  loading="eager"
                  draggable="false"
                  @pointerdown="beginOverlayDrag"
                />
                <span
                  v-else
                  class="gallery-overlay__text"
                  :style="{ ...overlayItemStyle(item), color: item.color, fontWeight: item.weight }"
                  :data-overlay-id="item.id"
                  @pointerdown="beginOverlayDrag"
                >{{ item.text }}</span>
              </template>
            </div>
          </figure>

          <div v-else class="card-gallery card-gallery--empty">
            <div class="card-gallery__empty">
              <span class="card-gallery__empty-mark">+</span>
              <span class="card-gallery__empty-title">{{ page.gallery.title }}</span>
              <span class="card-gallery__empty-desc">{{ page.gallery.description }}</span>
            </div>
          </div>
        </template>

        <template v-else>
          <h1 v-if="!page.isOverflow && page.title">{{ page.title }}</h1>
          <div class="card-body" v-html="renderedBody"></div>
        </template>
      </div>

      <div
        v-if="hasOversizeBlock || detectedOverflow"
        class="absolute inset-x-3 bottom-3 z-30 rounded-md bg-red-600 px-2 py-1 text-center text-[10px] font-semibold text-white shadow-md"
      >
        {{ t("content.overflowWarning") }}
      </div>
    </article>

    <div
      v-if="(showBottomLeft || showBottomRight) && !isRawGallery && !isGallerySurface"
      class="poster-footer z-10 flex min-h-[24px] items-center justify-between px-1 pt-2.5 text-xs text-slate-800 drop-shadow-xs dark:text-slate-100"
    >
      <div v-if="showBottomLeft" class="shrink-0 font-mono text-[11px] opacity-85">
        <span>{{ page.date || defaultDateString }}</span>
      </div>
      <div v-else></div>
      <strong v-if="showBottomRight" class="max-w-[70%] truncate text-right text-[11px] font-medium opacity-90">
        {{ page.quote || t("runtime.defaultQuote") }}
      </strong>
    </div>
  </div>
</template>
