import { getOpenMojiSrc, getOpenMojiSticker } from "../config/openmoji.js";

export const MAX_OVERLAY_ITEMS = 12;
export const OVERLAY_TEXT_COLORS = [
  "#ffffff",
  "#0f172a",
  "#fde047",
  "#fb7185",
  "#38bdf8",
  "#4ade80",
];
const OVERLAY_TEXT_WEIGHTS = [400, 700, 800];

function createItemId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `ovl_${crypto.randomUUID()}`;
  }
  return `ovl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function clampUnit(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(1, Math.max(0, number));
}

function clampSize(value, fallback) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(0.6, Math.max(0.02, number));
}

function clampAngle(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.min(180, Math.max(-180, Math.round(number)));
}

function sanitizeColor(value) {
  const color = String(value || "").trim().toLowerCase();
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/.test(color) ? color : "#ffffff";
}

function sanitizeWeight(value) {
  const weight = Number(value);
  return OVERLAY_TEXT_WEIGHTS.includes(weight) ? weight : 700;
}

function normalizeSticker(item) {
  if (typeof item.stickerId !== "string" || !getOpenMojiSticker(item.stickerId)) return null;
  return {
    kind: "sticker",
    id: typeof item.id === "string" && item.id ? item.id : createItemId(),
    stickerId: item.stickerId,
    x: clampUnit(item.x, 0.5),
    y: clampUnit(item.y, 0.32),
    size: clampSize(item.size, 0.2),
    rotate: clampAngle(item.rotate),
  };
}

function normalizeText(item) {
  const text = typeof item.text === "string" ? item.text.slice(0, 120) : "";
  if (!text.trim()) return null;
  return {
    kind: "text",
    id: typeof item.id === "string" && item.id ? item.id : createItemId(),
    text,
    x: clampUnit(item.x, 0.5),
    y: clampUnit(item.y, 0.72),
    size: clampSize(item.size, 0.07),
    color: sanitizeColor(item.color),
    weight: sanitizeWeight(item.weight),
    rotate: clampAngle(item.rotate),
  };
}

/**
 * Overlay decoration lives on the work's gallery image entry, never on the
 * asset file, so the imported original stays untouched. Stored values are
 * untrusted and are re-validated on every read.
 */
export function normalizeOverlay(overlay) {
  const rawItems = Array.isArray(overlay?.items) ? overlay.items.slice(0, MAX_OVERLAY_ITEMS) : [];
  const items = [];
  for (const item of rawItems) {
    if (!item || typeof item !== "object") continue;
    const normalized = item.kind === "text" ? normalizeText(item) : normalizeSticker(item);
    if (normalized) items.push(normalized);
  }
  return items.length ? { items } : null;
}

export function createStickerItem(stickerId) {
  return normalizeSticker({ kind: "sticker", stickerId });
}

export function createTextItem(text = "") {
  return normalizeText({ kind: "text", text: String(text || "").slice(0, 120) });
}

export function overlayItems(overlay) {
  return Array.isArray(overlay?.items) ? overlay.items : [];
}

export function addOverlayItem(overlay, item) {
  if (!item) return overlay;
  const items = overlayItems(overlay);
  if (items.length >= MAX_OVERLAY_ITEMS) return overlay;
  return { items: [...items, item] };
}

export function updateOverlayItem(overlay, id, patch = {}) {
  const items = overlayItems(overlay).map((item) => {
    if (item.id !== id) return item;
    const normalized = item.kind === "text"
      ? normalizeText({ ...item, ...patch })
      : normalizeSticker({ ...item, ...patch });
    return normalized || item;
  });
  return items.length ? { items } : null;
}

export function removeOverlayItem(overlay, id) {
  const items = overlayItems(overlay).filter((item) => item.id !== id);
  return items.length ? { items } : null;
}

/** Turns stored overlay data into render-ready items for CardArtwork. */
export function resolveOverlay(overlay) {
  return overlayItems(overlay)
    .map((item) => {
      if (item.kind === "text") {
        return item.text.trim() ? { ...item } : null;
      }
      const sticker = getOpenMojiSticker(item.stickerId);
      if (!sticker) return null;
      return { ...item, src: getOpenMojiSrc(sticker), alt: sticker.nameEn };
    })
    .filter(Boolean);
}
