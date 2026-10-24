import { getOpenMojiSrc, getOpenMojiSticker } from "./openmoji.js";

const COVER_STICKER_SETS = {
  "theme-warm": [
    { id: "1F970", position: "top-right" },
    { id: "2728", position: "bottom-left" },
  ],
  "theme-fresh": [
    { id: "1F98B", position: "top-right" },
    { id: "1F331", position: "bottom-left" },
  ],
  "theme-ink": [
    { id: "1F4A1", position: "top-right" },
    { id: "1F4CA", position: "bottom-left" },
  ],
  "theme-apple-notes": [
    { id: "270F", position: "top-right" },
    { id: "1F4CC", position: "bottom-left" },
  ],
  "theme-instagram": [
    { id: "1F4F8", position: "top-right" },
    { id: "1F49C", position: "bottom-left" },
  ],
  "theme-spiral": [
    { id: "1F4CE", position: "top-right" },
    { id: "2B50", position: "bottom-left" },
  ],
  "theme-newspaper": [
    { id: "1F4F0", position: "top-right" },
    { id: "2615", position: "bottom-left" },
  ],
  "theme-cyberpunk": [
    { id: "1F916", position: "bottom-right" },
    { id: "1F680", position: "bottom-left" },
  ],
  "theme-ali-orange": [
    { id: "2728", position: "top-right" },
    { id: "1F4A1", position: "bottom-left" },
  ],
  "theme-byte-pulse": [
    { id: "1F680", position: "top-right" },
    { id: "1F4A1", position: "bottom-left" },
  ],
  "theme-macos-window": [
    { id: "1F4F8", position: "top-right" },
    { id: "1F4CC", position: "bottom-left" },
  ],
  "theme-bauhaus": [
    { id: "2B50", position: "top-right" },
    { id: "2B50", position: "bottom-left" },
  ],
  "theme-swiss-grid": [
    { id: "1F4CA", position: "top-right" },
    { id: "270F", position: "bottom-left" },
  ],
  "theme-riso-jam": [
    { id: "1F49C", position: "top-right" },
    { id: "1F970", position: "bottom-left" },
  ],
  "theme-y2k-chrome": [
    { id: "2728", position: "top-right" },
    { id: "1F49C", position: "bottom-left" },
  ],
  "theme-blueprint": [
    { id: "1F4CE", position: "top-right" },
    { id: "1F4CA", position: "bottom-left" },
  ],
};

function resolveSticker(item) {
  const sticker = getOpenMojiSticker(item.id);
  if (!sticker) return null;
  return {
    id: sticker.id,
    src: getOpenMojiSrc(sticker),
    alt: sticker.nameEn,
    position: item.position,
  };
}

export function getCoverStickers(themeClass) {
  const set = COVER_STICKER_SETS[themeClass] || COVER_STICKER_SETS["theme-warm"];
  return set.map(resolveSticker).filter(Boolean);
}

export function resolveCoverStickerSelection(selection = []) {
  return selection
    .map((item) => {
      const sticker = getOpenMojiSticker(item.id);
      if (!sticker) return null;
      return {
        id: sticker.id,
        src: getOpenMojiSrc(sticker),
        alt: sticker.nameEn,
        position: item.position || "top-right",
      };
    })
    .filter(Boolean);
}
