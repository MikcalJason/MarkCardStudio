export const COVER_RATIOS = [
  { id: "3:4", width: 1080, height: 1440, labelKey: "cover.ratios.portrait" },
  { id: "1:1", width: 1080, height: 1080, labelKey: "cover.ratios.square" },
  { id: "2.35:1", width: 1410, height: 600, labelKey: "cover.ratios.banner" },
];

export const COVER_TEMPLATES = [
  {
    id: "editorial",
    nameZh: "编辑网格",
    nameEn: "Editorial Grid",
    category: "editorial",
    className: "cover-design--editorial",
    defaults: {
      align: "left",
      font: "sans",
      titleScale: 0.145,
      padding: 0.08,
      safeArea: 0.06,
      uppercaseKicker: true,
      overlay: 0.1,
    },
  },
  {
    id: "magazine",
    nameZh: "杂志封面",
    nameEn: "Magazine",
    category: "editorial",
    className: "cover-design--magazine",
    defaults: {
      align: "center",
      font: "serif",
      titleScale: 0.15,
      padding: 0.1,
      safeArea: 0.08,
      uppercaseKicker: false,
      overlay: 0.12,
    },
  },
  {
    id: "journal",
    nameZh: "手帐便签",
    nameEn: "Journal Note",
    category: "creative",
    className: "cover-design--journal",
    defaults: {
      align: "left",
      font: "serif",
      titleScale: 0.125,
      padding: 0.11,
      safeArea: 0.07,
      uppercaseKicker: false,
      overlay: 0,
    },
  },
  {
    id: "minimal",
    nameZh: "极简留白",
    nameEn: "Minimal",
    category: "minimal",
    className: "cover-design--minimal",
    defaults: {
      align: "center",
      font: "sans",
      titleScale: 0.12,
      padding: 0.12,
      safeArea: 0.08,
      uppercaseKicker: true,
      overlay: 0.04,
    },
  },
  {
    id: "tech",
    nameZh: "终端科技",
    nameEn: "Terminal",
    category: "tech",
    className: "cover-design--tech",
    defaults: {
      align: "left",
      font: "mono",
      titleScale: 0.125,
      padding: 0.08,
      safeArea: 0.06,
      uppercaseKicker: true,
      overlay: 0.22,
    },
  },
  {
    id: "collage",
    nameZh: "拼贴海报",
    nameEn: "Collage",
    category: "art",
    className: "cover-design--collage",
    defaults: {
      align: "left",
      font: "display",
      titleScale: 0.14,
      padding: 0.07,
      safeArea: 0.06,
      uppercaseKicker: true,
      overlay: 0.06,
    },
  },
  {
    id: "gradient",
    nameZh: "渐变宣言",
    nameEn: "Gradient Statement",
    category: "gradient",
    className: "cover-design--gradient",
    defaults: {
      align: "center",
      font: "display",
      titleScale: 0.16,
      padding: 0.09,
      safeArea: 0.07,
      uppercaseKicker: true,
      overlay: 0.08,
    },
  },
  {
    id: "cinema",
    nameZh: "电影海报",
    nameEn: "Cinema",
    category: "photo",
    className: "cover-design--cinema",
    defaults: {
      align: "left",
      font: "sans",
      titleScale: 0.15,
      padding: 0.09,
      safeArea: 0.07,
      uppercaseKicker: true,
      overlay: 0.45,
    },
  },
];

export const COVER_BACKGROUND_STYLES = [
  { id: "mesh", labelKey: "cover.backgrounds.mesh", tw: "from-violet-500 via-rose-400 to-amber-300" },
  { id: "gradient", labelKey: "cover.backgrounds.gradient", tw: "from-sky-500 via-indigo-500 to-fuchsia-500" },
  { id: "paper", labelKey: "cover.backgrounds.paper", tw: "from-amber-100 via-orange-50 to-stone-200" },
  { id: "grid", labelKey: "cover.backgrounds.grid", tw: "from-slate-100 via-white to-slate-200" },
  { id: "riso", labelKey: "cover.backgrounds.riso", tw: "from-rose-300 via-pink-200 to-cyan-200" },
  { id: "blueprint", labelKey: "cover.backgrounds.blueprint", tw: "from-blue-950 via-blue-900 to-sky-800" },
  { id: "chrome", labelKey: "cover.backgrounds.chrome", tw: "from-slate-200 via-violet-200 to-sky-200" },
  { id: "noise", labelKey: "cover.backgrounds.noise", tw: "from-slate-900 via-slate-800 to-indigo-900" },
];

export const COVER_FONTS = ["sans", "serif", "mono", "display"];
export const COVER_ALIGNMENTS = ["left", "center"];

export function getCoverTemplate(templateId) {
  return COVER_TEMPLATES.find((template) => template.id === templateId) || COVER_TEMPLATES[0];
}

export function getCoverRatio(ratioId) {
  return COVER_RATIOS.find((ratio) => ratio.id === ratioId) || COVER_RATIOS[0];
}

export function createDefaultCoverDesign({
  title = "",
  subtitle = "",
  kicker = "MARKCARD STUDIO",
  meta = "",
  brand = "MarkCard Studio",
  templateId = "editorial",
  ratio = "3:4",
  baseColor = "#6354f4",
  accentColor = "#f59e0b",
  backgroundStyle = "mesh",
  seed = 1,
} = {}) {
  const template = getCoverTemplate(templateId);
  return {
    schemaVersion: 1,
    templateId: template.id,
    ratio,
    title,
    subtitle,
    kicker,
    meta,
    brand,
    background: {
      style: backgroundStyle,
      seed: Number(seed) || 1,
      baseColor,
      accentColor,
    },
    layout: {
      ...template.defaults,
      textColor: "",
      accentColor: "",
    },
  };
}
