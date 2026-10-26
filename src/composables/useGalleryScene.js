import { computed, onBeforeUnmount, ref, watch } from "vue";
import { SCENE_MOCKUP_TEMPLATES, SCENE_QUAD_POINTS } from "../config/sceneMockups.js";
import {
  canvasToBlob,
  composeSceneMockup,
  loadImageSource,
  loadSceneImage,
  releaseCardPixels,
  releaseSceneImage,
} from "../utils/sceneMockup.js";
import {
  readImageQuadOverrides,
  readSceneQuadOverrides,
} from "../storage/sceneMockupTemplates.js";

// Scene backdrops are derived at runtime and never persisted as image bytes:
// only `gallery.sceneId` lives in the work. Regenerating on load also keeps the
// composite in sync with the current platform canvas and card calibration.
const MAX_BACKDROP_SIDE = 2048;
const THUMB_SIDE = 360;
const PREVIEW_SIDE = 480;

function makeThumbnail(canvas) {
  const scale = Math.min(1, THUMB_SIDE / Math.max(canvas.width, canvas.height));
  const thumb = document.createElement("canvas");
  thumb.width = Math.max(2, Math.round(canvas.width * scale));
  thumb.height = Math.max(2, Math.round(canvas.height * scale));
  const context = thumb.getContext("2d");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(canvas, 0, 0, thumb.width, thumb.height);
  return thumb;
}

function revokeEntry(entry) {
  if (!entry) return;
  if (entry.backdrop) URL.revokeObjectURL(entry.backdrop);
  if (entry.thumb) URL.revokeObjectURL(entry.thumb);
}

export function useGalleryScene({ workRef, platformRef, activeImageRef = null }) {
  const backdrops = ref({});
  const thumbs = ref({});
  const previews = ref({});
  const previewPending = ref(false);
  const status = ref("idle");
  const progress = ref({ done: 0, total: 0 });
  const failedCount = ref(0);

  let cache = new Map();
  const previewCache = new Map();
  let sceneSignature = "";
  let runToken = 0;
  let activeRun = null;
  let previewSignature = "";
  let previewToken = 0;

  const template = computed(() => {
    const id = workRef.value?.gallery?.sceneId;
    return SCENE_MOCKUP_TEMPLATES.find((scene) => scene.id === id) || null;
  });
  const isActive = computed(
    () => workRef.value?.gallery?.background === "scene" && Boolean(template.value),
  );
  const size = computed(() => {
    const width = Number(platformRef.value?.width) || 1080;
    const height = Number(platformRef.value?.height) || 1440;
    const scale = Math.min(1, MAX_BACKDROP_SIDE / Math.max(width, height));
    return {
      width: Math.max(2, Math.round(width * scale)),
      height: Math.max(2, Math.round(height * scale)),
    };
  });
  // The tail of a data URL changes with the asset bytes while keeping this
  // watcher cheap; asset ids are content-addressed, so the id alone is usually
  // enough and the tail only catches re-hydration.
  const imageKey = computed(() =>
    (workRef.value?.images || [])
      .map((image) => [
        image.id,
        image.assetId,
        image.src ? image.src.length : 0,
        image.src ? image.src.slice(-24) : "",
      ].join(":"))
      .join("|"),
  );

  // One card drives every picker tile and the calibration overlay, so the
  // composable owns the choice instead of each surface guessing.
  const previewImage = computed(
    () =>
      activeImageRef?.value ||
      (workRef.value?.images || []).find((item) => item?.src) ||
      null,
  );

  function clearCache() {
    for (const entry of cache.values()) revokeEntry(entry);
    cache = new Map();
    backdrops.value = {};
    thumbs.value = {};
    progress.value = { done: 0, total: 0 };
    failedCount.value = 0;
  }

  function pruneCache() {
    const used = new Set([...Object.values(backdrops.value), ...Object.values(thumbs.value)]);
    for (const [key, entry] of cache) {
      if (used.has(entry.backdrop)) continue;
      revokeEntry(entry);
      cache.delete(key);
    }
  }

  function clearPreviews() {
    for (const url of previewCache.values()) URL.revokeObjectURL(url);
    previewCache.clear();
    previews.value = {};
  }

  function previewSize() {
    const base = size.value;
    const scale = Math.min(1, PREVIEW_SIDE / Math.max(base.width, base.height));
    return {
      width: Math.max(2, Math.round(base.width * scale)),
      height: Math.max(2, Math.round(base.height * scale)),
    };
  }

  // The picker shows the user's own card inside every scene. All previews share
  // one decoded card, and each scene photo is released right after compositing
  // so the full photo set never sits in memory at once.
  //
  // Tiles are cached one by one: correcting the corners of a single scene used to
  // throw away all 29 previews and composite them again, while only one of them
  // had actually changed.
  const quadKey = (quad) =>
    SCENE_QUAD_POINTS.map((key) => `${quad[key][0].toFixed(4)},${quad[key][1].toFixed(4)}`).join(";");

  async function ensurePreviews() {
    const image = previewImage.value;
    if (!image?.src) {
      previewSignature = "";
      previewPending.value = false;
      clearPreviews();
      return;
    }

    const canvasSize = previewSize();
    const overrides = readSceneQuadOverrides();
    const imageQuads = readImageQuadOverrides()[image.id] || {};
    const runKey = `${image.id}|${canvasSize.width}x${canvasSize.height}`;
    // The active image may have its own correction, so previews follow that
    // image's corners and rebuild when they move.
    const resolved = SCENE_MOCKUP_TEMPLATES.map((scene) => {
      const quad = imageQuads[scene.id] || overrides[scene.id] || scene.quad;
      return { scene, quad, key: `${runKey}|${scene.id}|${quadKey(quad)}` };
    });
    const signature = resolved.map((item) => item.key).join("|");
    if (signature === previewSignature) return;
    previewSignature = signature;
    const token = (previewToken += 1);
    previewPending.value = true;

    // Anything that is no longer part of this run (another image, another size,
    // another calibration) releases its blob URL right away.
    const keep = new Set(resolved.map((item) => item.key));
    for (const [key, url] of [...previewCache]) {
      if (keep.has(key)) continue;
      URL.revokeObjectURL(url);
      previewCache.delete(key);
    }
    const ready = {};
    const pending = [];
    for (const item of resolved) {
      const cached = previewCache.get(item.key);
      if (cached) ready[item.scene.id] = cached;
      else pending.push(item);
    }
    previews.value = ready;
    if (!pending.length) {
      previewPending.value = false;
      return;
    }

    let cardSource;
    try {
      cardSource = await loadImageSource(image.src);
    } catch {
      if (token === previewToken) previewPending.value = false;
      return;
    }
    if (token !== previewToken) return;

    for (const { scene, quad, key } of pending) {
      if (token !== previewToken) return;
      try {
        const sceneImage = await loadSceneImage(scene.image);
        if (token !== previewToken) return;
        const canvas = composeSceneMockup({
          sceneImage,
          cardImage: cardSource,
          quad,
          lighting: scene.lighting,
          cornerRadius: scene.cornerRadius,
          fit: scene.fit,
          width: canvasSize.width,
          height: canvasSize.height,
        });
        if (!canvas) continue;
        const blob = await canvasToBlob(canvas, "image/jpeg", 0.9);
        if (!blob || token !== previewToken) continue;
        const url = URL.createObjectURL(blob);
        previewCache.set(key, url);
        previews.value = { ...previews.value, [scene.id]: url };
      } catch {
        // A failed tile simply keeps the un-composited scene photo underneath.
      } finally {
        // One decoded photo at a time: the tile cache is what saves the work,
        // not a resident set of 29 full-resolution photos.
        releaseSceneImage(scene.image);
      }
    }
    if (token === previewToken) previewPending.value = false;
  }

  async function generate() {
    const token = (runToken += 1);
    const scene = template.value;
    if (!isActive.value || !scene) {
      status.value = "idle";
      return;
    }

    const canvasSize = size.value;
    const signature = `${scene.id}|${canvasSize.width}x${canvasSize.height}`;
    if (signature !== sceneSignature) {
      sceneSignature = signature;
      clearCache();
    }

    const allImages = workRef.value?.images || [];
    const images = allImages.filter((image) => image?.id && image.assetId && image.src);
    if (!images.length) {
      backdrops.value = {};
      thumbs.value = {};
      progress.value = { done: 0, total: 0 };
      failedCount.value = 0;
      status.value = allImages.length ? "waiting" : "empty";
      return;
    }

    const currentIds = new Set(images.map((image) => image.id));
    backdrops.value = Object.fromEntries(
      Object.entries(backdrops.value).filter(([id]) => currentIds.has(id)),
    );
    thumbs.value = Object.fromEntries(
      Object.entries(thumbs.value).filter(([id]) => currentIds.has(id)),
    );
    progress.value = { done: 0, total: images.length };
    failedCount.value = 0;
    status.value = "generating";

    const run = (async () => {
      let sceneImage;
      try {
        sceneImage = await loadSceneImage(scene.image);
      } catch {
        if (token === runToken) {
          status.value = "error";
          failedCount.value = images.length;
        }
        return;
      }
      if (token !== runToken) return;

      const overrides = readSceneQuadOverrides();
      const imageOverrides = readImageQuadOverrides();
      // A per-image correction wins over the scene default: one card that sits
      // badly in a photo is fixed on that card, not on every card.
      const quadFor = (image) => imageOverrides[image.id]?.[scene.id] || overrides[scene.id] || scene.quad;
      // The image the preview is showing is the one the user is judging, so
      // composite it before the rest of the gallery.
      const activeId = activeImageRef?.value?.id || "";
      const ordered = activeId
        ? [...images].sort((a, b) => (a.id === activeId ? -1 : b.id === activeId ? 1 : 0))
        : images;
      let done = 0;
      let failed = 0;

      for (const image of ordered) {
        if (token !== runToken) return;
        const quad = quadFor(image);
        // Two entries can share one asset (the same picture twice) while needing
        // different corners, so the calibration is part of the cache key.
        const key = `${signature}|${image.assetId}|${JSON.stringify(quad)}`;
        let entry = cache.get(key);
        if (!entry) {
          try {
            const cardSource = await loadImageSource(image.src);
            if (token !== runToken) return;
            const canvas = composeSceneMockup({
              sceneImage,
              cardImage: cardSource,
              quad,
              lighting: scene.lighting,
              cornerRadius: scene.cornerRadius,
              fit: scene.fit,
              width: canvasSize.width,
              height: canvasSize.height,
            });
            if (!canvas) throw new Error("compose-failed");
            // Near-lossless: the exporter re-encodes the backdrop once more, and
            // two ordinary JPEG generations is what turns warped card type into
            // mush. PNG would be exact but costs ~10x the bytes per image, and
            // every gallery image keeps one resident.
            const backdropBlob = await canvasToBlob(canvas, "image/jpeg", 0.97);
            if (!backdropBlob) throw new Error("encode-failed");
            const thumbBlob = await canvasToBlob(makeThumbnail(canvas), "image/jpeg", 0.9);
            if (!thumbBlob) throw new Error("thumb-failed");
            entry = {
              backdrop: URL.createObjectURL(backdropBlob),
              thumb: URL.createObjectURL(thumbBlob),
            };
            cache.set(key, entry);
          } catch (error) {
            console.warn("Gallery scene compositing failed", error);
            failed += 1;
            entry = null;
          }
        }
        if (token !== runToken) return;
        if (entry) {
          backdrops.value = { ...backdrops.value, [image.id]: entry.backdrop };
          thumbs.value = { ...thumbs.value, [image.id]: entry.thumb };
        }
        done += 1;
        progress.value = { done, total: images.length };
      }

      if (token !== runToken) return;
      failedCount.value = failed;
      status.value = failed ? "error" : "ready";
      pruneCache();
      // Every image composites its own card, so the decoded-pixel cache only
      // holds a few megabytes of a card that is already done.
      releaseCardPixels();
    })();

    activeRun = run;
    try {
      await run;
    } finally {
      if (activeRun === run) activeRun = null;
    }
  }

  async function ensureReady() {
    if (!isActive.value || !template.value) return;
    if (activeRun) {
      await activeRun;
      return;
    }
    if (status.value !== "ready") await generate();
  }

  function refresh({ keepPreviewTiles = false } = {}) {
    if (!isActive.value) return;
    clearCache();
    previewToken += 1;
    previewSignature = "";
    previewPending.value = false;
    // A corner correction only moves the tiles whose key changed, so the rest of
    // the picker keeps its cached previews instead of being recomposited.
    if (!keepPreviewTiles) clearPreviews();
    generate();
  }

  watch(
    [
      isActive,
      () => template.value?.id || "",
      () => size.value.width,
      () => size.value.height,
      imageKey,
    ],
    () => generate(),
    { immediate: true },
  );

  onBeforeUnmount(() => {
    runToken += 1;
    previewToken += 1;
    clearPreviews();
    clearCache();
  });

  return {
    backdrops,
    thumbs,
    previews,
    previewPending,
    status,
    progress,
    failedCount,
    template,
    isActive,
    previewImage,
    ensureReady,
    ensurePreviews,
    retry: () => refresh(),
    refreshCalibration: () => refresh({ keepPreviewTiles: true }),
  };
}
