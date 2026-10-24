// Gallery title/caption typography. Sizes are ratios of the card design width
// (like overlay items) so one setting survives every platform canvas, and the
// font choices are system stacks: PingFang ships with macOS/iOS only, so every
// preset keeps a cross-platform fallback tail.
export const GALLERY_FONT_PRESETS = [
  { id: "theme", labelKey: "gallery.fonts.theme", stack: "" },
  {
    id: "pingfang",
    labelKey: "gallery.fonts.pingfang",
    stack: '"PingFang SC", "PingFang TC", "Microsoft YaHei", "Noto Sans SC", sans-serif',
  },
  {
    id: "system",
    labelKey: "gallery.fonts.system",
    stack: 'system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif',
  },
  {
    id: "heiti",
    labelKey: "gallery.fonts.heiti",
    stack: '"Source Han Sans SC", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", sans-serif',
  },
  {
    id: "songti",
    labelKey: "gallery.fonts.songti",
    stack: '"Songti SC", "STSong", "Noto Serif SC", SimSun, serif',
  },
  {
    id: "mono",
    labelKey: "gallery.fonts.mono",
    stack: 'ui-monospace, SFMono-Regular, Menlo, "PingFang SC", monospace',
  },
  { id: "custom", labelKey: "gallery.fonts.custom", stack: "" },
];

export const GALLERY_TITLE_WEIGHTS = [600, 700, 800, 900];
// Where the area around a template gallery card gets its color.
export const GALLERY_BACKGROUNDS = ["theme", "blurred", "tint"];
export const TITLE_RATIO_RANGE = { min: 0.028, max: 0.06 };
export const CAPTION_RATIO_RANGE = { min: 0.02, max: 0.044 };

export const DEFAULT_GALLERY_TYPE = {
  fontId: "theme",
  titleRatio: 0.042,
  titleWeight: 800,
  captionRatio: 0.032,
};

function clampRatio(value, range, fallback) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return fallback;
  return Math.min(range.max, Math.max(range.min, numeric));
}

export function normalizeGalleryType(raw) {
  const font = GALLERY_FONT_PRESETS.find((preset) => preset.id === raw?.fontId);
  return {
    fontId: font ? font.id : DEFAULT_GALLERY_TYPE.fontId,
    titleRatio: clampRatio(raw?.titleRatio, TITLE_RATIO_RANGE, DEFAULT_GALLERY_TYPE.titleRatio),
    titleWeight: GALLERY_TITLE_WEIGHTS.includes(Number(raw?.titleWeight))
      ? Number(raw.titleWeight)
      : DEFAULT_GALLERY_TYPE.titleWeight,
    captionRatio: clampRatio(
      raw?.captionRatio,
      CAPTION_RATIO_RANGE,
      DEFAULT_GALLERY_TYPE.captionRatio,
    ),
  };
}

export function galleryFontStack(fontId, customFontFamily) {
  if (fontId === "custom") return customFontFamily ? `"${customFontFamily}", sans-serif` : "";
  const preset = GALLERY_FONT_PRESETS.find((item) => item.id === fontId);
  return preset?.stack || "";
}
