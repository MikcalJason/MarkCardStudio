import { computed, ref, watch } from "vue";
import { normalizeOverlay } from "../utils/imageOverlay.js";
import { DEFAULT_GALLERY_TYPE, GALLERY_BACKGROUNDS, normalizeGalleryType } from "../config/galleryTypography.js";
import { normalizeSceneId } from "../config/sceneMockups.js";
import { normalizeTint } from "../utils/imageTint.js";

const WORKS_KEY = "markcard_works_v1";
const CURRENT_WORK_KEY = "markcard_current_work_v1";
const MAX_WORKS = 50;

// A gallery card is the image itself; 模板 stays available for works that want
// the theme chrome. Works stored before this default was introduced keep their
// own stored mode, so only new gallery works start in raw.
export function createDefaultGalleryLayout() {
  return {
    mode: "raw",
    fit: "cover",
    showCaptions: true,
    showNumbers: false,
    frame: "bleed",
    background: "theme",
    sceneId: "",
    type: { ...DEFAULT_GALLERY_TYPE },
  };
}

function createId(prefix) {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeImage(image) {
  if (!image || typeof image.assetId !== "string") return null;
  return {
    id: typeof image.id === "string" ? image.id : createId("image"),
    assetId: image.assetId,
    caption: typeof image.caption === "string" ? image.caption : "",
    alt: typeof image.alt === "string" ? image.alt : "",
    focal: image.focal && typeof image.focal === "object" ? image.focal : { x: 0.5, y: 0.5 },
    overlay: normalizeOverlay(image.overlay),
    tint: normalizeTint(image.tint),
    src: typeof image.src === "string" ? image.src : "",
  };
}

const VARIANT_STATUSES = ["draft", "ready", "published"];

function normalizeTags(tags) {
  const normalized = [];
  for (const tag of Array.isArray(tags) ? tags : []) {
    if (typeof tag !== "string") continue;
    const value = tag.trim();
    if (value && !normalized.includes(value)) normalized.push(value);
  }
  return normalized;
}

function normalizeVariant(raw) {
  if (!raw || typeof raw !== "object" || typeof raw.id !== "string") return null;
  if (typeof raw.channelId !== "string" || !raw.channelId) return null;
  const override = raw.overrides && typeof raw.overrides === "object" ? raw.overrides : {};
  return {
    schemaVersion: 1,
    id: raw.id,
    workId: typeof raw.workId === "string" ? raw.workId : "",
    channelId: raw.channelId,
    status: VARIANT_STATUSES.includes(raw.status) ? raw.status : "draft",
    overrides: {
      title: typeof override.title === "string" ? override.title : "",
      body: typeof override.body === "string" ? override.body.slice(0, 20000) : "",
      tags: normalizeTags(override.tags),
      digest: typeof override.digest === "string" ? override.digest : "",
      coverIndex: Number.isInteger(override.coverIndex) && override.coverIndex >= 0
        ? override.coverIndex
        : null,
      pageIndexes: Array.isArray(override.pageIndexes)
        ? override.pageIndexes.filter((index) => Number.isInteger(index) && index >= 0)
        : null,
      mode: override.mode === "publish" ? "publish" : "draft",
    },
    publishRecordId: typeof raw.publishRecordId === "string" ? raw.publishRecordId : null,
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : nowIso(),
  };
}

function normalizeWork(raw) {
  if (!raw || typeof raw !== "object" || typeof raw.id !== "string") return null;
  return {
    schemaVersion: 1,
    id: raw.id,
    type: raw.type === "gallery" ? "gallery" : "markdown",
    title: typeof raw.title === "string" ? raw.title : "",
    source: {
      kind: "markdown",
      path: typeof raw.source?.path === "string" ? raw.source.path : "",
      contentHash: typeof raw.source?.contentHash === "string" ? raw.source.contentHash : "",
    },
    theme: typeof raw.theme === "string" ? raw.theme : "",
    canvas: {
      width: Number.isFinite(raw.canvas?.width) ? raw.canvas.width : 1080,
      height: Number.isFinite(raw.canvas?.height) ? raw.canvas.height : 1440,
    },
    cover: raw.cover?.assetId ? { assetId: raw.cover.assetId } : null,
    coverDesign: raw.coverDesign && typeof raw.coverDesign === "object"
      ? JSON.parse(JSON.stringify(raw.coverDesign))
      : null,
    images: Array.isArray(raw.images) ? raw.images.map(normalizeImage).filter(Boolean) : [],
    copy: {
      title: typeof raw.copy?.title === "string" ? raw.copy.title : "",
      body: typeof raw.copy?.body === "string" ? raw.copy.body.slice(0, 20000) : "",
      tags: Array.isArray(raw.copy?.tags) ? raw.copy.tags.filter((tag) => typeof tag === "string") : [],
      cta: typeof raw.copy?.cta === "string" ? raw.copy.cta : "",
    },
    gallery: {
      mode: raw.gallery?.mode === "raw" ? "raw" : "template",
      fit: raw.gallery?.fit === "contain" ? "contain" : "cover",
      showCaptions: raw.gallery?.showCaptions !== false,
      showNumbers: raw.gallery?.showNumbers === true,
      frame: raw.gallery?.frame === "framed" ? "framed" : "bleed",
      background: GALLERY_BACKGROUNDS.includes(raw.gallery?.background)
        ? raw.gallery.background
        : "theme",
      sceneId: normalizeSceneId(raw.gallery?.sceneId),
      type: normalizeGalleryType(raw.gallery?.type),
    },
    variants: Array.isArray(raw.variants)
      ? raw.variants.map(normalizeVariant).filter(Boolean)
      : [],
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : nowIso(),
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : nowIso(),
  };
}

function loadWorks() {
  try {
    const raw = localStorage.getItem(WORKS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeWork).filter(Boolean).slice(0, MAX_WORKS);
  } catch {
    return [];
  }
}

function serializableWork(work) {
  if (!work) return null;
  return {
    ...work,
    cover: work.cover?.assetId ? { assetId: work.cover.assetId } : null,
    coverDesign: work.coverDesign ? JSON.parse(JSON.stringify(work.coverDesign)) : null,
    images: work.images.map(({ src: _src, ...image }) => ({
      ...image,
      overlay: normalizeOverlay(image.overlay),
    })),
  };
}

function workSignature(work) {
  if (!work) return "";
  const serialized = serializableWork(work);
  return JSON.stringify({ ...serialized, updatedAt: "" });
}

/**
 * Work / Variant domain for the current document. Gallery items keep their
 * asset ids; the transient `src` field is hydrated from useAssetLibrary and is
 * never written to localStorage.
 */
export function useWork() {
  const works = ref(loadWorks());
  const currentWork = ref(null);
  let persistTimer = null;
  let syncing = false;

  function persistNow() {
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    if (!currentWork.value) return;
    try {
      const serialized = serializableWork(currentWork.value);
      const nextWorks = [
        serialized,
        ...works.value.filter((work) => work && work.id !== serialized.id),
      ].slice(0, MAX_WORKS);
      works.value = nextWorks;
      localStorage.setItem(WORKS_KEY, JSON.stringify(nextWorks));
      localStorage.setItem(CURRENT_WORK_KEY, serialized.id);
    } catch {
      // Work metadata is small, but keep the in-memory copy if storage is full.
    }
  }

  function persistSoon() {
    if (syncing) return;
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(persistNow, 450);
  }

  function setCurrent(work) {
    currentWork.value = work;
    try {
      localStorage.setItem(CURRENT_WORK_KEY, work.id);
    } catch {
      // Ignore unavailable localStorage.
    }
  }

  function createWork({
    title = "",
    sourceKind = "markdown",
    sourcePath = "",
    contentHash = "",
    type = "markdown",
  } = {}) {
    const work = normalizeWork({
      id: createId("work"),
      type,
      title,
      source: { kind: sourceKind, path: sourcePath, contentHash },
      images: [],
      copy: { title, body: "", tags: [], cta: "" },
      coverDesign: null,
      gallery: { ...createDefaultGalleryLayout() },
      variants: [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
    });
    works.value = [serializableWork(work), ...works.value].slice(0, MAX_WORKS);
    setCurrent(work);
    persistNow();
    return work;
  }

  function ensureWork(options = {}) {
    const sourcePath = typeof options.sourcePath === "string" ? options.sourcePath : "";
    if (sourcePath) {
      const matched = works.value.find((work) => work.source?.path === sourcePath);
      if (matched) {
        if (currentWork.value?.id !== matched.id) setCurrent(matched);
        return matched;
      }
      if (currentWork.value && !currentWork.value.source?.path) {
        currentWork.value = normalizeWork({
          ...currentWork.value,
          source: { ...currentWork.value.source, path: sourcePath },
          updatedAt: nowIso(),
        });
        persistSoon();
        return currentWork.value;
      }
    }

    if (currentWork.value) {
      if (!sourcePath) return currentWork.value;
      return createWork(options);
    }

    try {
      const lastId = localStorage.getItem(CURRENT_WORK_KEY);
      const restored = works.value.find((work) => work.id === lastId);
      if (restored) {
        if (!sourcePath || !restored.source?.path || restored.source.path === sourcePath) {
          setCurrent(restored);
          return restored;
        }
      }
    } catch {
      // Ignore unavailable localStorage.
    }

    return createWork(options);
  }

  function updateWork(patch = {}) {
    if (!currentWork.value) return null;
    const current = currentWork.value;
    currentWork.value = {
      ...current,
      ...patch,
      source: patch.source ? { ...current.source, ...patch.source } : current.source,
      canvas: patch.canvas ? { ...current.canvas, ...patch.canvas } : current.canvas,
      copy: patch.copy ? { ...current.copy, ...patch.copy } : current.copy,
      gallery: patch.gallery ? { ...current.gallery, ...patch.gallery } : current.gallery,
      updatedAt: nowIso(),
    };
    persistSoon();
    return currentWork.value;
  }

  function syncFromDocument({
    title,
    sourcePath,
    theme,
    canvas,
    mode,
    markdown = "",
    contentHash = "",
  } = {}) {
    const work = ensureWork({ title, sourcePath });
    if (!work) return null;
    const nextType = mode === "gallery" ? "gallery" : "markdown";
    const nextSource = {
      path: srcPath(sourcePath),
      contentHash,
    };
    const nextCopy = {
      title: title || work.copy.title,
      body: String(markdown || "").slice(0, 20000),
    };
    const nextTitle = title || work.title;
    const candidate = {
      ...work,
      type: nextType,
      title: nextTitle,
      source: { ...work.source, ...nextSource },
      theme: theme || work.theme,
      canvas: {
        width: canvas?.width || work.canvas.width,
        height: canvas?.height || work.canvas.height,
      },
      coverDesign: work.coverDesign
        ? { ...work.coverDesign, title: nextTitle }
        : null,
      copy: { ...work.copy, ...nextCopy },
    };
    if (workSignature(candidate) === workSignature(work)) return work;
    currentWork.value = normalizeWork({ ...candidate, updatedAt: nowIso() });
    persistSoon();
    return currentWork.value;
  }

  function srcPath(sourcePath) {
    return typeof sourcePath === "string" ? sourcePath : "";
  }

  function addImage(image) {
    if (!currentWork.value || !image?.assetId) return null;
    const normalized = normalizeImage(image);
    currentWork.value.images.push(normalized);
    currentWork.value.cover = currentWork.value.cover || { assetId: normalized.assetId };
    currentWork.value.updatedAt = nowIso();
    persistSoon();
    return normalized;
  }

  function removeImage(imageId) {
    if (!currentWork.value) return false;
    const nextImages = currentWork.value.images.filter((image) => image.id !== imageId);
    if (nextImages.length === currentWork.value.images.length) return false;
    currentWork.value.images = nextImages;
    if (
      currentWork.value.cover?.assetId &&
      !nextImages.some((image) => image.assetId === currentWork.value.cover.assetId)
    ) {
      currentWork.value.cover = nextImages[0] ? { assetId: nextImages[0].assetId } : null;
    }
    currentWork.value.updatedAt = nowIso();
    persistSoon();
    return true;
  }

  function moveImage(fromIndex, toIndex) {
    if (!currentWork.value) return false;
    const images = currentWork.value.images;
    if (
      fromIndex === toIndex ||
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= images.length ||
      toIndex >= images.length
    ) {
      return false;
    }
    const [moved] = images.splice(fromIndex, 1);
    images.splice(toIndex, 0, moved);
    currentWork.value.updatedAt = nowIso();
    persistSoon();
    return true;
  }

  function reorderImages(imageIds) {
    if (!currentWork.value || !Array.isArray(imageIds)) return false;
    const images = currentWork.value.images;
    const byId = new Map(images.map((image) => [image.id, image]));
    const next = imageIds.map((id) => byId.get(id)).filter(Boolean);
    if (next.length !== images.length) return false;
    if (next.every((image, index) => image === images[index])) return false;
    currentWork.value.images = next;
    currentWork.value.updatedAt = nowIso();
    persistSoon();
    return true;
  }

  function updateImage(imageId, patch = {}) {
    if (!currentWork.value) return null;
    const image = currentWork.value.images.find((item) => item.id === imageId);
    if (!image) return null;
    const nextPatch =
      patch.overlay !== undefined ? { ...patch, overlay: normalizeOverlay(patch.overlay) } : patch;
    Object.assign(image, nextPatch, { id: image.id, assetId: image.assetId });
    currentWork.value.updatedAt = nowIso();
    persistSoon();
    return image;
  }

  function setCover(assetId) {
    if (!currentWork.value || !assetId) return null;
    const image = currentWork.value.images.find((item) => item.assetId === assetId);
    if (image) {
      const index = currentWork.value.images.indexOf(image);
      if (index > 0) currentWork.value.images.splice(index, 1);
      if (index > 0) currentWork.value.images.unshift(image);
    }
    currentWork.value.cover = { assetId };
    currentWork.value.updatedAt = nowIso();
    persistSoon();
    return currentWork.value.cover;
  }

  function setCoverDesign(design) {
    if (!currentWork.value) return null;
    currentWork.value.coverDesign = design
      ? JSON.parse(JSON.stringify(design))
      : null;
    currentWork.value.updatedAt = nowIso();
    persistSoon();
    return currentWork.value.coverDesign;
  }

  function setGalleryLayout(patch = {}) {
    if (!currentWork.value) return null;
    currentWork.value.gallery = { ...currentWork.value.gallery, ...patch };
    currentWork.value.updatedAt = nowIso();
    persistSoon();
    return currentWork.value.gallery;
  }

  async function hydrateImages(resolveSource, { retry = 0 } = {}) {
    if (!currentWork.value || typeof resolveSource !== "function") return;
    let changed = false;
    for (const image of currentWork.value.images) {
      if (image.src) continue;
      let src = await resolveSource(image.assetId);
      // A single miss must not be permanent: the asset index can still be
      // loading when the first pass runs, and nothing calls this again until the
      // id list changes — which is why a card could export as a blank background
      // until the image was re-imported.
      for (let attempt = 0; !src && attempt < retry; attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 80 * (attempt + 1)));
        src = await resolveSource(image.assetId);
      }
      if (src && !image.src) {
        image.src = src;
        changed = true;
      }
    }
    if (changed) currentWork.value.updatedAt = nowIso();
  }

  function upsertVariant(channelId, overrides = {}) {
    if (!currentWork.value || typeof channelId !== "string" || !channelId) return null;
    const existing = currentWork.value.variants.find((variant) => variant.channelId === channelId);
    if (existing) {
      existing.overrides = normalizeVariant({
        ...existing,
        overrides: { ...existing.overrides, ...overrides },
      }).overrides;
      existing.updatedAt = nowIso();
      currentWork.value.updatedAt = nowIso();
      persistSoon();
      return existing;
    }
    const variant = normalizeVariant({
      id: createId("variant"),
      workId: currentWork.value.id,
      channelId,
      overrides,
    });
    currentWork.value.variants.push(variant);
    currentWork.value.updatedAt = nowIso();
    persistSoon();
    return variant;
  }

  function markVariantStatus(channelId, status) {
    if (!currentWork.value) return null;
    const variant = currentWork.value.variants.find((item) => item.channelId === channelId);
    if (!variant) return null;
    variant.status = VARIANT_STATUSES.includes(status) ? status : variant.status;
    variant.updatedAt = nowIso();
    currentWork.value.updatedAt = nowIso();
    persistSoon();
    return variant;
  }

  function removeVariant(variantId) {
    if (!currentWork.value) return false;
    const nextVariants = currentWork.value.variants.filter((variant) => variant.id !== variantId);
    if (nextVariants.length === currentWork.value.variants.length) return false;
    currentWork.value.variants = nextVariants;
    currentWork.value.updatedAt = nowIso();
    persistSoon();
    return true;
  }

  function resetVariant(channelId) {
    if (!currentWork.value) return null;
    const variant = currentWork.value.variants.find((item) => item.channelId === channelId);
    if (!variant) return null;
    variant.overrides = normalizeVariant({ ...variant, overrides: {} }).overrides;
    variant.status = "draft";
    variant.updatedAt = nowIso();
    currentWork.value.updatedAt = nowIso();
    persistSoon();
    return variant;
  }

  const workTitle = computed(() => currentWork.value?.title || "");
  const imageCount = computed(() => currentWork.value?.images.length || 0);
  const variantCount = computed(() => currentWork.value?.variants.length || 0);
  const galleryLayout = computed(() =>
    currentWork.value?.gallery ||
    { ...createDefaultGalleryLayout() },
  );

  watch(
    currentWork,
    () => {
      if (!syncing) persistSoon();
    },
    { deep: true },
  );

  return {
    works,
    currentWork,
    workTitle,
    imageCount,
    variantCount,
    galleryLayout,
    ensureWork,
    createWork,
    updateWork,
    syncFromDocument,
    addImage,
    removeImage,
    moveImage,
    reorderImages,
    updateImage,
    setCover,
    setCoverDesign,
    setGalleryLayout,
    hydrateImages,
    upsertVariant,
    markVariantStatus,
    removeVariant,
    resetVariant,
    persistNow,
  };
}
