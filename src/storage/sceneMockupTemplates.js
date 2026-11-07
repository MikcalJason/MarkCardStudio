import { SCENE_MOCKUP_TEMPLATES, SCENE_QUAD_POINTS } from "../config/sceneMockups.js";
import { normalizeQuad } from "../utils/sceneMockup.js";

const OVERRIDES_KEY = "markcard_scene_mockups_v1";

const TEMPLATE_BY_ID = new Map(
  SCENE_MOCKUP_TEMPLATES.map((template) => [template.id, template]),
);

// A stored correction describes one particular version of a photo's panel. When
// that photo or its shipped calibration changes, the correction is no longer an
// adjustment but a stale offset that reads as "the card is placed wrong" — so
// every scene carries its own signature and only the stale scene is dropped.
// Bumping `imageVersion` on a template is how a re-generated photo with the same
// id invalidates its corrections.
const SIGNATURE_CACHE = new Map();

function sceneSignature(sceneId) {
  if (SIGNATURE_CACHE.has(sceneId)) return SIGNATURE_CACHE.get(sceneId);
  const template = TEMPLATE_BY_ID.get(sceneId);
  if (!template) return "";
  const text = [
    sceneId,
    template.image || "",
    template.imageVersion || "",
    SCENE_QUAD_POINTS.map((key) => template.quad[key].join(",")).join(";"),
  ].join("|");
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash + text.charCodeAt(index)) | 0;
  }
  const signature = String(hash);
  SIGNATURE_CACHE.set(sceneId, signature);
  return signature;
}

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
  const signatures = {};
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) {
    return { scenes, images, signatures };
  }

  // Corrections are kept per scene and validated against that scene's current
  // signature, so adding or re-calibrating one scene no longer wipes the rest.
  // A store written before signatures existed cannot be validated: it is an
  // offset against an unknown calibration, so it is dropped.
  const rawSignatures =
    stored.signatures && typeof stored.signatures === "object" ? stored.signatures : {};
  const isCurrent = (sceneId) =>
    Boolean(rawSignatures[sceneId]) && rawSignatures[sceneId] === sceneSignature(sceneId);

  const rawScenes = stored.scenes && typeof stored.scenes === "object" ? stored.scenes : {};
  for (const [sceneId, quad] of Object.entries(rawScenes)) {
    const template = TEMPLATE_BY_ID.get(sceneId);
    if (!template || !quad || typeof quad !== "object") continue;
    if (!("tl" in quad) || !isCurrent(sceneId)) continue;
    scenes[sceneId] = normalizeQuad(quad, template.quad);
    signatures[sceneId] = rawSignatures[sceneId];
  }

  const rawImages = stored.images && typeof stored.images === "object" ? stored.images : {};
  for (const [imageId, byScene] of Object.entries(rawImages)) {
    if (!imageId || !byScene || typeof byScene !== "object") continue;
    const entries = {};
    for (const [sceneId, quad] of Object.entries(byScene)) {
      const template = TEMPLATE_BY_ID.get(sceneId);
      if (!template || !quad || typeof quad !== "object") continue;
      if (!isCurrent(sceneId)) continue;
      entries[sceneId] = normalizeQuad(quad, template.quad);
      signatures[sceneId] = rawSignatures[sceneId];
    }
    if (Object.keys(entries).length) images[imageId] = entries;
  }

  return { scenes, images, signatures };
}

function writeStore({ scenes, images, signatures = {} }) {
  try {
    localStorage.setItem(
      OVERRIDES_KEY,
      JSON.stringify({ schemaVersion: 2, signatures, scenes, images }),
    );
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
  store.signatures[sceneId] = sceneSignature(sceneId);
  writeStore(store);
}

export function clearSceneQuadOverride(sceneId) {
  const store = readStore();
  if (!(sceneId in store.scenes)) return;
  delete store.scenes[sceneId];
  pruneSignatures(store);
  writeStore(store);
}

// Signatures only exist to validate stored corrections, so they go away with the
// last correction that needed them.
function pruneSignatures(store) {
  const used = new Set(Object.keys(store.scenes));
  Object.values(store.images).forEach((byScene) => {
    Object.keys(byScene).forEach((sceneId) => used.add(sceneId));
  });
  Object.keys(store.signatures).forEach((sceneId) => {
    if (!used.has(sceneId)) delete store.signatures[sceneId];
  });
}

export function writeImageQuadOverride(imageId, sceneId, quad) {
  const template = TEMPLATE_BY_ID.get(sceneId);
  if (!imageId || !template) return;
  const store = readStore();
  const existing = store.images[imageId] || {};
  store.images[imageId] = { ...existing, [sceneId]: normalizeQuad(quad, template.quad) };
  store.signatures[sceneId] = sceneSignature(sceneId);
  writeStore(store);
}

export function clearImageQuadOverride(imageId, sceneId) {
  const store = readStore();
  const existing = store.images[imageId];
  if (!existing || !(sceneId in existing)) return;
  delete existing[sceneId];
  if (Object.keys(existing).length) store.images[imageId] = existing;
  else delete store.images[imageId];
  pruneSignatures(store);
  writeStore(store);
}

// A removed gallery image must not leave corrections behind: its id is never
// reused, so they would only ever grow the stored map.
export function clearImageQuadOverrides(imageId) {
  const store = readStore();
  if (!(imageId in store.images)) return;
  delete store.images[imageId];
  pruneSignatures(store);
  writeStore(store);
}
