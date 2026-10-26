import { SCENE_MOCKUP_TEMPLATES, SCENE_QUAD_POINTS } from "../config/sceneMockups.js";
import { normalizeQuad } from "../utils/sceneMockup.js";

const OVERRIDES_KEY = "markcard_scene_mockups_v1";

const TEMPLATE_BY_ID = new Map(
  SCENE_MOCKUP_TEMPLATES.map((template) => [template.id, template]),
);

// A stored correction describes one particular version of a photo's panel. When
// the shipped calibration changes, an old correction is no longer an adjustment
// but a stale offset that reads as "the card is placed wrong", so the store is
// versioned by the template quads themselves.
const TEMPLATE_VERSION = (() => {
  let hash = 5381;
  for (const template of SCENE_MOCKUP_TEMPLATES) {
    const text = `${template.id}:${SCENE_QUAD_POINTS.map((key) => template.quad[key].join(",")).join(";")}`;
    for (let index = 0; index < text.length; index += 1) {
      hash = ((hash << 5) + hash + text.charCodeAt(index)) | 0;
    }
  }
  return String(hash);
})();

// Calibration has two levels, because one correction cannot be right for every
// card: a scene default (the panel of that photo) and a per-image correction for
// the one card that does not sit in it. Fixing a single gallery image must never
// move the others, so the two are stored apart.
//   { scenes: { [sceneId]: quad }, images: { [imageId]: { [sceneId]: quad } } }
// The original flat `{ [sceneId]: quad }` shape is still read as `scenes`.
function readStore() {
  let stored = null;
  try {
    stored = JSON.parse(localStorage.getItem(OVERRIDES_KEY) || "null");
  } catch {
    stored = null;
  }
  const scenes = {};
  const images = {};
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return { scenes, images };
  // A correction saved against a different shipped calibration (including the
  // very first, unversioned shape) is an offset, not an adjustment: drop it so
  // the card never sits where the photo no longer is.
  if (stored.version !== TEMPLATE_VERSION) {
    writeStore({ scenes, images });
    return { scenes, images };
  }

  const rawScenes =
    stored.scenes && typeof stored.scenes === "object" ? stored.scenes : stored;
  for (const [sceneId, quad] of Object.entries(rawScenes)) {
    const template = TEMPLATE_BY_ID.get(sceneId);
    if (!template || !quad || typeof quad !== "object") continue;
    // Skips the sibling `images` map when the v1 shape is read as scenes.
    if (!("tl" in quad)) continue;
    scenes[sceneId] = normalizeQuad(quad, template.quad);
  }

  const rawImages = stored.images && typeof stored.images === "object" ? stored.images : {};
  for (const [imageId, byScene] of Object.entries(rawImages)) {
    if (!imageId || !byScene || typeof byScene !== "object") continue;
    const entries = {};
    for (const [sceneId, quad] of Object.entries(byScene)) {
      const template = TEMPLATE_BY_ID.get(sceneId);
      if (!template || !quad || typeof quad !== "object") continue;
      entries[sceneId] = normalizeQuad(quad, template.quad);
    }
    if (Object.keys(entries).length) images[imageId] = entries;
  }

  return { scenes, images };
}

function writeStore({ scenes, images }) {
  try {
    localStorage.setItem(OVERRIDES_KEY, JSON.stringify({ version: TEMPLATE_VERSION, scenes, images }));
  } catch {
    // Calibration is a convenience; keep the in-memory value when storage is full.
  }
}

export function readSceneQuadOverrides() {
  return readStore().scenes;
}

export function readImageQuadOverrides() {
  return readStore().images;
}

// What the compositor should use for one image in one scene: the image's own
// correction first, then the scene default, then the template.
export function resolveSceneQuad(sceneId, imageId = "") {
  if (!TEMPLATE_BY_ID.has(sceneId)) return null;
  const { scenes, images } = readStore();
  return (imageId ? images[imageId]?.[sceneId] : null) || scenes[sceneId] || null;
}

export function writeSceneQuadOverride(sceneId, quad) {
  const template = TEMPLATE_BY_ID.get(sceneId);
  if (!template) return;
  const store = readStore();
  store.scenes[sceneId] = normalizeQuad(quad, template.quad);
  writeStore(store);
}

export function clearSceneQuadOverride(sceneId) {
  const store = readStore();
  if (!(sceneId in store.scenes)) return;
  delete store.scenes[sceneId];
  writeStore(store);
}

export function writeImageQuadOverride(imageId, sceneId, quad) {
  const template = TEMPLATE_BY_ID.get(sceneId);
  if (!imageId || !template) return;
  const store = readStore();
  const existing = store.images[imageId] || {};
  store.images[imageId] = { ...existing, [sceneId]: normalizeQuad(quad, template.quad) };
  writeStore(store);
}

export function clearImageQuadOverride(imageId, sceneId) {
  const store = readStore();
  const existing = store.images[imageId];
  if (!existing || !(sceneId in existing)) return;
  delete existing[sceneId];
  if (Object.keys(existing).length) store.images[imageId] = existing;
  else delete store.images[imageId];
  writeStore(store);
}

// A removed gallery image must not leave corrections behind: its id is never
// reused, so they would only ever grow the stored map.
export function clearImageQuadOverrides(imageId) {
  const store = readStore();
  if (!(imageId in store.images)) return;
  delete store.images[imageId];
  writeStore(store);
}
