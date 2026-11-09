// Throwaway A/B of the lifted gallery capture against the cloned one. Delete after use.
import "./styles/app.css";
import { renderPageToImage } from "./composables/useCardExport.js";
import { createDefaultGalleryLayout } from "./composables/useWork.js";
import { normalizeOverlay } from "./utils/imageOverlay.js";

const LIFTED = new URLSearchParams(location.search).get("noLift") !== "1";
const KEY = LIFTED ? "ab.lift" : "ab.clone";

function hexRgb(hex) {
  const v = hex.replace("#", "");
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}

// 16 vertical stripes, each a different colour, so every output pixel names the
// source column it came from. 1600x900 into a 3:4 box forces a real crop.
function makeStripedPhoto() {
  const canvas = document.createElement("canvas");
  canvas.width = 1600;
  canvas.height = 900;
  const ctx = canvas.getContext("2d");
  const colors = [
    "#e6194b", "#3cb44b", "#ffe119", "#4363d8", "#f58231", "#911eb4", "#46f0f0", "#f032e6",
    "#d2f53c", "#bcf60c", "#fabebe", "#008080", "#e6beff", "#9a6324", "#800000", "#aaffc3",
  ];
  colors.forEach((color, index) => {
    ctx.fillStyle = color;
    ctx.fillRect(index * 100, 0, 100, 900);
  });
  return canvas.toDataURL("image/png");
}

function makeBackdrop() {
  const canvas = document.createElement("canvas");
  canvas.width = 8;
  canvas.height = 8;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#e0762a";
  ctx.fillRect(0, 0, 8, 8);
  return canvas.toDataURL("image/png");
}

function makePage(galleryOverrides, extra = {}) {
  return {
    label: "01", kicker: "@MarkCard", title: "标题文字", bodyMarkdown: "", body: [], blocks: [],
    imageClass: "", imageUrl: "", cover: true, isOverflow: false, stickers: [], date: "", quote: "",
    ...extra,
    ...(galleryOverrides === null
      ? {}
      : {
        gallery: {
          ...createDefaultGalleryLayout(),
          empty: false, alt: "probe", caption: "图注文字", index: 0, total: 3, missing: false,
          sceneBackdrop: false, imageId: "asset-1",
          tint: { version: 1, average: "rgb(222,218,205)", accent: "rgb(40,40,40)", backdrop: makeBackdrop(), width: 8, height: 8 },
          ...galleryOverrides,
        },
      }),
  };
}

const base = {
  width: 1080, height: 1440, quality: 2, themeClass: "theme-swiss-grid", transparent: false,
  bgType: "gradient", bgHex: "#69eacb",
  bgVal: "linear-gradient(135deg, #69eacb 0%, #eaccf8 48%, #6654f1 100%)",
  ext: "jpg", showTopLeft: true, showTopRight: true, showBottomLeft: true, showBottomRight: true,
  customFontFamily: "", customFontEmbedCss: "",
};

const items = [
  { name: "raw cover bleed", page: makePage({ mode: "raw", fit: "cover", frame: "bleed", background: "theme" }) },
  { name: "raw contain bleed", page: makePage({ mode: "raw", fit: "contain", frame: "bleed", background: "theme" }) },
  { name: "template cover bleed", page: makePage({ mode: "template", fit: "cover", frame: "bleed", background: "theme" }) },
  { name: "template framed cover", page: makePage({ mode: "template", fit: "cover", frame: "framed", background: "theme" }) },
  { name: "template cover blurred", page: makePage({ mode: "template", fit: "cover", frame: "bleed", background: "blurred" }) },
  { name: "template contain blurred", page: makePage({ mode: "template", fit: "contain", frame: "framed", background: "blurred" }) },
  { name: "empty gallery", page: makePage({ empty: true, src: "" }) },
  { name: "themed markdown page", page: makePage(null, { bodyMarkdown: "# 标题\n\n正文内容。" }) },
];

function gridOf(canvas) {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const values = [];
  for (let y = 0; y < canvas.height; y += 45) {
    for (let x = 0; x < canvas.width; x += 45) {
      const d = ctx.getImageData(x, y, 1, 1).data;
      values.push(d[0], d[1], d[2], d[3]);
    }
  }
  return values;
}

async function toCanvas(blob) {
  const url = URL.createObjectURL(blob);
  const img = await new Promise((resolve, reject) => {
    const node = new Image();
    node.onload = () => resolve(node);
    node.onerror = () => reject(new Error("decode failed"));
    node.src = url;
  });
  URL.revokeObjectURL(url);
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  canvas.getContext("2d").drawImage(img, 0, 0);
  return canvas;
}

async function main() {
  const photo = makeStripedPhoto();
  const store = {};
  for (const item of items) {
    const page = item.page;
    if (page.gallery && !page.gallery.empty && page.gallery.src !== "") {
      page.gallery = { ...page.gallery, src: photo };
    }
    const started = performance.now();
    try {
      const rendered = await renderPageToImage(page, { ...base, pageNumber: 1, pagesLength: 3 });
      const canvas = await toCanvas(rendered.blob || rendered);
      store[item.name] = {
        bytes: (rendered.blob || rendered).size,
        ms: Math.round(performance.now() - started),
        grid: gridOf(canvas),
        width: canvas.width,
        height: canvas.height,
      };
    } catch (err) {
      store[item.name] = { error: String(err?.message || err), ms: Math.round(performance.now() - started) };
    }
  }
  localStorage.setItem(KEY, JSON.stringify(store));
  window.__AB__ = { mode: KEY, cases: Object.keys(store).length, lifts: window.__LIFT_LOG__ || [] };
}

// Run after both passes: reports the lifted/clone pixel difference per case.
window.__abDiff = () => {
  const lift = JSON.parse(localStorage.getItem("ab.lift") || "{}");
  const clone = JSON.parse(localStorage.getItem("ab.clone") || "{}");
  return Object.keys(lift).map((name) => {
    const a = lift[name];
    const b = clone[name];
    if (a.error || b.error) return { name, liftError: a.error, cloneError: b.error };
    const deltas = [];
    for (let i = 0; i < Math.min(a.grid.length, b.grid.length); i += 4) {
      deltas.push(Math.abs(a.grid[i] - b.grid[i]) + Math.abs(a.grid[i + 1] - b.grid[i + 1]) + Math.abs(a.grid[i + 2] - b.grid[i + 2]));
    }
    deltas.sort((x, y) => x - y);
    return {
      name,
      liftBytes: a.bytes,
      cloneBytes: b.bytes,
      samples: deltas.length,
      medianDelta: deltas[Math.floor(deltas.length / 2)],
      p95Delta: deltas[Math.floor(deltas.length * 0.95)],
      worstDelta: deltas[deltas.length - 1],
    };
  });
};

main().catch((err) => { window.__AB__ = { fatal: String(err?.message || err) }; });
