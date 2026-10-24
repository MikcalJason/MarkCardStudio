import { reactive } from "vue";
import {
  createDefaultCoverDesign,
  getCoverTemplate,
  getCoverRatio,
} from "../config/coverTemplates.js";
import { randomCoverSeed } from "../utils/coverBackgrounds.js";

function normalizeDesign(raw, fallback) {
  if (!raw || typeof raw !== "object") return fallback;
  return {
    schemaVersion: 1,
    templateId: typeof raw.templateId === "string" ? raw.templateId : fallback.templateId,
    ratio: getCoverRatio(raw.ratio).id,
    title: typeof raw.title === "string" ? raw.title : fallback.title,
    subtitle: typeof raw.subtitle === "string" ? raw.subtitle : fallback.subtitle,
    kicker: typeof raw.kicker === "string" ? raw.kicker : fallback.kicker,
    meta: typeof raw.meta === "string" ? raw.meta : fallback.meta,
    brand: typeof raw.brand === "string" ? raw.brand : fallback.brand,
    background: {
      style: typeof raw.background?.style === "string" ? raw.background.style : fallback.background.style,
      seed: Number.isFinite(raw.background?.seed) ? raw.background.seed : fallback.background.seed,
      baseColor: typeof raw.background?.baseColor === "string" ? raw.background.baseColor : fallback.background.baseColor,
      accentColor: typeof raw.background?.accentColor === "string" ? raw.background.accentColor : fallback.background.accentColor,
    },
    layout: {
      ...fallback.layout,
      ...(raw.layout && typeof raw.layout === "object" ? raw.layout : {}),
      titleScale: Math.min(0.2, Math.max(0.08, Number(raw.layout?.titleScale) || fallback.layout.titleScale)),
      padding: Math.min(0.16, Math.max(0.04, Number(raw.layout?.padding) || fallback.layout.padding)),
      safeArea: Math.min(0.12, Math.max(0.02, Number(raw.layout?.safeArea) || fallback.layout.safeArea)),
      overlay: Math.min(0.9, Math.max(0, Number(raw.layout?.overlay) || 0)),
    },
  };
}

export function createCoverDesignFromWork({
  work,
  title = "",
  subtitle = "",
  baseColor = "#6354f4",
  accentColor = "#f59e0b",
  date = "",
} = {}) {
  const design = createDefaultCoverDesign({
    title: title || work?.title || "",
    subtitle,
    kicker: "MARKCARD STUDIO",
    meta: date,
    brand: "MarkCard Studio",
    templateId: "editorial",
    ratio: "3:4",
    baseColor,
    accentColor,
    backgroundStyle: "mesh",
    seed: randomCoverSeed(),
  });
  return normalizeDesign(work?.coverDesign, design);
}

export function useCoverStudio() {
  const design = reactive(createDefaultCoverDesign());

  function replace(next) {
    Object.assign(design, normalizeDesign(next, design));
    design.background = { ...design.background, ...(next?.background || {}) };
    design.layout = { ...design.layout, ...(next?.layout || {}) };
  }

  function reset(base = {}) {
    replace(createDefaultCoverDesign(base));
  }

  function updateContent(patch = {}) {
    for (const key of ["title", "subtitle", "kicker", "meta", "brand"]) {
      if (patch[key] !== undefined) design[key] = String(patch[key]);
    }
    if (patch.ratio) design.ratio = getCoverRatio(patch.ratio).id;
  }

  function updateLayout(patch = {}) {
    Object.assign(design.layout, patch);
    design.layout.titleScale = Math.min(0.2, Math.max(0.08, Number(design.layout.titleScale) || 0.14));
    design.layout.padding = Math.min(0.16, Math.max(0.04, Number(design.layout.padding) || 0.08));
    design.layout.safeArea = Math.min(0.12, Math.max(0.02, Number(design.layout.safeArea) || 0.06));
    design.layout.overlay = Math.min(0.9, Math.max(0, Number(design.layout.overlay) || 0));
  }

  function updateBackground(patch = {}) {
    Object.assign(design.background, patch);
    design.background.seed = Math.max(1, Math.round(Number(design.background.seed) || 1));
  }

  function applyTemplate(templateId) {
    const template = getCoverTemplate(templateId);
    design.templateId = template.id;
    updateLayout({
      align: template.defaults.align,
      font: template.defaults.font,
      titleScale: template.defaults.titleScale,
      padding: template.defaults.padding,
      safeArea: template.defaults.safeArea,
      overlay: template.defaults.overlay,
      uppercaseKicker: template.defaults.uppercaseKicker,
    });
  }

  function setRatio(ratioId) {
    design.ratio = getCoverRatio(ratioId).id;
  }

  function shuffleBackground(style) {
    updateBackground({
      seed: randomCoverSeed(),
      ...(style ? { style } : {}),
    });
  }

  function serialize() {
    return JSON.parse(JSON.stringify(design));
  }

  return {
    design,
    replace,
    reset,
    updateContent,
    updateLayout,
    updateBackground,
    applyTemplate,
    setRatio,
    shuffleBackground,
    serialize,
  };
}
