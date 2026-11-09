// Throwaway geometry probe for the widened gallery photo lift. Delete after use.
import { renderPageToImage } from "./composables/useCardExport.js";
import { createDefaultGalleryLayout } from "./composables/useWork.js";

const STRIPES = [
  "#e6194b", "#3cb44b", "#ffe119", "#4363d8", "#f58231", "#911eb4", "#46f0f0", "#f032e6",
  "#d2f53c", "#bcf60c", "#fabebe", "#008080", "#e6beff", "#9a6324", "#800000", "#aaffc3",
];

function stripeColor(index) {
  return STRIPES[((index % STRIPES.length) + STRIPES.length) % STRIPES.length];
}

function hexRgb(hex) {
  const v = hex.replace("#", "");
  return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
}

// 16 vertical stripes of 100 px each, identical down the height, so any output
// pixel names the source column it came from.
function makeStripedPhoto() {
  const canvas = document.createElement("canvas");
  canvas.width = 1600;
  canvas.height = 900;
  const ctx = canvas.getContext("2d");
  STRIPES.forEach((color, index) => {
    ctx.fillStyle = color;
    ctx.fillRect(index * 100, 0, 100, 900);
  });
  return { url: canvas.toDataURL("image/png"), canvas };
}

function makePage(galleryOverrides) {
  return {
    label: "01", kicker: "@MarkCard", title: "标题", bodyMarkdown: "", body: [], blocks: [],
    imageClass: "", imageUrl: "", cover: true, isOverflow: false, stickers: [], date: "", quote: "",
    gallery: {
      ...createDefaultGalleryLayout(),
      empty: false, alt: "probe", caption: "图注", index: 0, total: 1, missing: false,
      sceneBackdrop: false, imageId: "asset-1",
      tint: { version: 1, average: "rgb(200, 120, 60)", accent: "rgb(20, 30, 40)", backdrop: "", width: 1, height: 1 },
      ...galleryOverrides,
    },
  };
}

const base = {
  width: 1080, height: 1440, quality: 2, themeClass: "theme-swiss-grid", transparent: false,
  bgType: "none", bgHex: "#69eacb", bgVal: "", ext: "png",
  showTopLeft: false, showTopRight: false, showBottomLeft: false, showBottomRight: false,
  customFontFamily: "", customFontEmbedCss: "",
};

async function render(page, src) {
  page.gallery = { ...page.gallery, src };
  const rendered = await renderPageToImage(page, { ...base, pageNumber: 1, pagesLength: 1 });
  const blob = rendered.blob || rendered;
  const img = await loadImage(URL.createObjectURL(blob));
  const canvas = document.createElement("canvas");
  canvas.width = img.naturalWidth;
  canvas.height = img.naturalHeight;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  return { ctx, canvas, blob };
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image load failed"));
    img.src = url;
  });
}

function nearest(colorName, rgb) {
  const want = hexRgb(colorName);
  let best = 0;
  let bestDistance = Infinity;
  STRIPES.forEach((candidate, index) => {
    const c = hexRgb(candidate);
    const distance = Math.abs(c[0] - rgb[0]) + Math.abs(c[1] - rgb[1]) + Math.abs(c[2] - rgb[2]);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = index;
    }
  });
  return { index: best, stripe: STRIPES[best], distance: bestDistance, got: rgb.join(",") };
}

function readPixel(ctx, x, y) {
  const d = ctx.getImageData(x, y, 1, 1).data;
  return [d[0], d[1], d[2]];
}

function waitForSmokeSuite() {
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = () => {
      if (window.__SMOKE__ || Date.now() - started > 180000) resolve();
      else setTimeout(tick, 500);
    };
    tick();
  });
}

async function main() {
  // Both scripts shim requestAnimationFrame for the capture, so they must not
  // overlap.
  await waitForSmokeSuite();
  const photo = makeStripedPhoto();
  const results = [];
  const OUT = 2.4; // 1080 / 450 design px

  // --- cover: the crop is the thing that can be wrong -------------------
  // scale = 600/900 = 0.6667, drawn 1066.7 wide in a 450 box → offset 308.3
  const cover = await render(makePage({ mode: "raw", fit: "cover", frame: "bleed", background: "theme" }), photo.url);
  const coverExpect = (outX) => Math.round((outX / OUT + 308.333) / 0.6666667 / 100);
  for (const outX of [4, 270, 540, 810, 1075]) {
    const want = coverExpect(outX);
    const got = nearest(stripeColor(want), readPixel(cover.ctx, outX, 720));
    results.push({ test: `cover x=${outX}`, want, got: got.index, stripe: got.stripe, distance: got.distance, pass: got.index === want && got.distance < 40 });
  }

  // --- contain: the letterbox band is the thing that can be wrong ------
  // scale = 450/1600 = 0.28125, drawn 450x253.1 in a 600 box → offset 173.4
  const bandTop = Math.round(173.44 * OUT);
  const contain = await render(makePage({ mode: "template", fit: "contain", frame: "bleed", background: "theme" }), photo.url);
  const above = readPixel(contain.ctx, 540, bandTop - 12);
  const inside = readPixel(contain.ctx, 540, bandTop + 12);
  const insideStripe = nearest(stripeColor(8), inside);
  const belowEnd = Math.round((173.44 + 253.12) * OUT);
  const below = readPixel(contain.ctx, 540, belowEnd - 12);
  const belowBand = readPixel(contain.ctx, 540, belowEnd + 12);
  results.push({
    test: "contain band above is not the photo",
    above: above.join(","), inside: inside.join(","), wantInsideStripe: 8,
    pass: above.join(",") !== inside.join(",") && insideStripe.index === 8,
  });
  results.push({
    test: "contain band below is not the photo",
    below: below.join(","), belowBand: belowBand.join(","),
    pass: below.join(",") !== belowBand.join(","),
  });

  // --- backdrop: blurred must differ from the plain matte --------------
  const tinted = await render(makePage({ mode: "template", fit: "contain", frame: "bleed", background: "theme" }), photo.url);
  const small = await makeBackdrop();
  const blurred = await render(makePage({
    mode: "template", fit: "contain", frame: "bleed", background: "blurred",
    tint: { version: 1, average: "#102030", accent: "#f0e0d0", backdrop: small.url, width: 1, height: 1 },
  }), photo.url);
  const matteBand = readPixel(tinted.ctx, 540, bandTop - 12);
  const backdropBand = readPixel(blurred.ctx, 540, bandTop - 12);
  const backdropPhoto = readPixel(blurred.ctx, 540, bandTop + 12);
  results.push({
    test: "blurred backdrop paints the letterbox (not the matte, not buried)",
    matteBand: matteBand.join(","), backdropBand: backdropBand.join(","),
    backdropColor: small.rgb.join(","), insidePhoto: backdropPhoto.join(","),
    // The shade gradient sits over the band, so compare hue rather than value:
    // the backdrop is red-dominant, the neutral matte is a dark blue-slate.
    pass: backdropBand.join(",") !== matteBand.join(",")
      && backdropBand[0] > backdropBand[1] + 20 && backdropBand[0] > backdropBand[2] + 20
      && backdropPhoto.join(",") !== backdropBand.join(","),
  });

  // --- chrome still lands on top of the photo --------------------------
  const plain = await render(makePage({ mode: "raw", fit: "cover", frame: "bleed", background: "theme" }), photo.url);
  const dressed = await render(makePage({
    mode: "template", fit: "cover", frame: "bleed", background: "theme", showCaptions: true,
  }), photo.url);
  results.push({
    test: "template chrome darkens the photo band that raw leaves bare",
    rawBottom: meanBand(plain.ctx).join(","), templateBottom: meanBand(dressed.ctx).join(","),
    pass: luminance(meanBand(dressed.ctx)) < luminance(meanBand(plain.ctx)) - 8,
  });

  window.__PROBE__ = results;
}

// The backdrop raster the app really uses is a tiny blurred PNG; an orange flat
// one of the same shape is enough to prove it is the layer that paints.
async function makeBackdrop() {
  const canvas = document.createElement("canvas");
  canvas.width = 4;
  canvas.height = 4;
  const ctx = canvas.getContext("2d");
  ctx.fillStyle = "#e0762a";
  ctx.fillRect(0, 0, 4, 4);
  const rgb = [224, 118, 42];
  return { url: canvas.toDataURL("image/png"), rgb };
}

function nearestColor(a, b) {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]);
}

function meanBand(ctx) {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let x = 120; x < 960; x += 7) {
    for (let y = 1200; y < 1400; y += 11) {
      const d = ctx.getImageData(x, y, 1, 1).data;
      r += d[0];
      g += d[1];
      b += d[2];
      n += 1;
    }
  }
  return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
}

function luminance([r, g, b]) {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

main().catch((err) => { window.__PROBE__ = { error: String(err?.message || err) }; });
