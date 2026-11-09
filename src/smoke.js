// Throwaway verification of the gallery photo lift. Delete after use.
import { renderPageToImage } from "./composables/useCardExport.js";
import { normalizeOverlay } from "./utils/imageOverlay.js";
import { createDefaultGalleryLayout } from "./composables/useWork.js";

const SRC = "1280x1600 JPEG with a bright border ring and a dark interior so a blank capture is obvious";
const TINT = {
  version: 1,
  average: "rgb(222, 218, 205)",
  accent: "rgb(60, 60, 60)",
  backdrop: "data:image/jpeg;base64,"
    + "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0a"
    + "HBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAA"
    + "AAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==",
  width: 1,
  height: 1,
};

function makeGallery(overrides = {}) {
  return {
    ...createDefaultGalleryLayout(),
    empty: false,
    src: SRC,
    alt: "probe",
    caption: "图注示例",
    index: 0,
    total: 3,
    missing: false,
    sceneBackdrop: false,
    imageId: "asset-1",
    overlay: normalizeOverlay({
      version: 1,
      items: [{ id: "s1", kind: "sticker", codePoint: "1F60B", position: { x: 12, y: 14 }, size: 12 }],
      texts: [{ id: "t1", text: "标题文字", position: { x: 30, y: 70 } }],
    }),
    tint: TINT,
    ...overrides,
  };
}

function makePage(gallery, extra = {}) {
  return {
    label: "02", kicker: "@MarkCard", title: "测试图文卡片标题", bodyMarkdown: "",
    body: [], blocks: [], imageClass: "", imageUrl: "", cover: false,
    isOverflow: false, stickers: [], date: "2026.11.07", quote: "引用文字",
    ...extra,
    ...(gallery ? { gallery } : {}),
  };
}

const base = {
  width: 1080, height: 1440, quality: 2, themeClass: "theme-swiss-grid",
  transparent: false, bgType: "gradient",
  bgHex: "#69eacb", bgVal: "linear-gradient(135deg, #69eacb 0%, #eaccf8 48%, #6654f1 100%)",
  ext: "jpg", showTopLeft: true, showTopRight: true, showBottomLeft: true, showBottomRight: true,
  customFontFamily: "", customFontEmbedCss: "",
};

const items = [
  { name: "raw cover bleed", page: makePage(makeGallery({ mode: "raw", fit: "cover", frame: "bleed", background: "theme" })) },
  { name: "raw contain bleed", page: makePage(makeGallery({ mode: "raw", fit: "contain", frame: "bleed", background: "theme" })) },
  { name: "template cover bleed", page: makePage(makeGallery({ mode: "template", fit: "cover", frame: "bleed", background: "theme" })) },
  { name: "template framed cover", page: makePage(makeGallery({ mode: "template", fit: "cover", frame: "framed", background: "theme" })) },
  { name: "template cover + blurred backdrop", page: makePage(makeGallery({ mode: "template", fit: "cover", frame: "bleed", background: "blurred" })) },
  { name: "template contain + blurred backdrop", page: makePage(makeGallery({ mode: "template", fit: "contain", frame: "framed", background: "blurred" })) },
  { name: "empty gallery", page: makePage(makeGallery({ empty: true, src: "" })) },
  { name: "themed markdown page", page: makePage(null, { bodyMarkdown: "# 标题\n\n正文内容。" }) },
];

function readPixels(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("decode failed " + url)); };
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(img, 0, 0);
      URL.revokeObjectURL(url);
      resolve({ ctx, canvas, size: `${img.naturalWidth}x${img.naturalHeight}` });
    };
    img.src = url;
  });
}

function sample(ctx, x, y) {
  const d = ctx.getImageData(x, y, 1, 1).data;
  return `${d[0]},${d[1]},${d[2]},${d[3]}`;
}

function flatness(ctx, canvas) {
  const probe = document.createElement("canvas");
  probe.width = 10;
  probe.height = 10;
  const p = probe.getContext("2d", { willReadFrequently: true });
  p.drawImage(canvas, 0, 0, 10, 10);
  const d = p.getImageData(0, 0, 10, 10).data;
  let min = 255;
  let max = 0;
  let sum = 0;
  for (let i = 0; i < d.length; i += 4) {
    const v = (d[i] + d[i + 1] + d[i + 2]) / 3;
    sum += v;
    min = Math.min(min, v);
    max = Math.max(max, v);
  }
  return { flat: max - min <= 6, mean: Math.round(sum / (d.length / 4)) };
}

// The card photo fills the middle of the page; the frame padding around it is
// where the backdrop (or the matte) is the only thing that can paint.
const POINTS = {
  photoCentre: [540, 720],
  photoTopLeft: [70, 70],
  framePadding: [5, 720],
  titleBand: [200, 1180],
};

async function main() {
  // A real 3.5 MB PNG: the size class the WebView has been dropping.
  const big = await makeBigPhoto();
  const out = [];
  const views = [];
  for (const item of items) {
    const page = item.page;
    let record;
    if (page.gallery && !page.gallery.empty && page.gallery.src === SRC) {
      page.gallery = { ...page.gallery, src: big.url };
    }
    const started = performance.now();
    try {
      const rendered = await withTimeout(
        renderPageToImage(page, { ...base, pageNumber: page.label, pagesLength: 3 }),
        90000,
      );
      const blob = rendered.blob || rendered;
      const read = await readPixels(blob);
      const samples = {};
      for (const [key, [x, y]] of Object.entries(POINTS)) samples[key] = sample(read.ctx, x, y);
      record = {
        case: item.name,
        bytes: blob.size,
        ms: Math.round(performance.now() - started),
        size: read.size,
        ...flatness(read.ctx, read.canvas),
        samples,
      };
      views.push({ name: item.name, url: URL.createObjectURL(blob) });
      window.__OUT__ = (window.__OUT__ || []).concat([{ name: item.name, url: blob }]);
    } catch (err) {
      record = { case: item.name, error: String(err?.message || err), ms: Math.round(performance.now() - started) };
    }
    out.push(record);
  }
  showGallery(views);
  window.__SMOKE__ = out;
}

function showGallery(views) {
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;inset:0;z-index:99999;background:#111;overflow:auto;padding:12px;"
    + "display:grid;grid-template-columns:repeat(4,1fr);gap:8px;font:12px monospace;color:#eee";
  for (const view of views) {
    const cell = document.createElement("div");
    cell.innerHTML = `<div style="margin-bottom:4px">${view.name}</div>`;
    const img = document.createElement("img");
    img.src = view.url;
    img.style.cssText = "width:100%;display:block;border:1px solid #444";
    cell.appendChild(img);
    host.appendChild(cell);
  }
  document.body.appendChild(host);
}

async function makeBigPhoto() {
  const canvas = document.createElement("canvas");
  canvas.width = 1328;
  canvas.height = 1760;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#20242c";
  ctx.fillRect(0, 0, 1328, 1760);
  // Strong structure: bands, a ring, and text, so a resample cannot read flat.
  for (let y = 0; y < 1760; y += 8) {
    ctx.fillStyle = `rgb(${(y * 7) % 256},${(y * 13) % 256},${(y * 29) % 256})`;
    ctx.fillRect(40, y + 20, 1248, 4);
  }
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 12;
  ctx.strokeRect(60, 60, 1208, 1640);
  ctx.fillStyle = "#fff";
  ctx.font = "96px sans-serif";
  ctx.fillText("MEASURE", 180, 900);
  // Pad to a multi-megabyte PNG payload.
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  return { url: URL.createObjectURL(blob), bytes: blob.size };
}

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms)),
  ]);
}

main().catch((err) => { window.__SMOKE__ = [{ fatal: String(err?.message || err) }]; });
