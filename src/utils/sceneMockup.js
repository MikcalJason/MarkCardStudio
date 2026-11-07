import { SCENE_MOCKUP_OUTPUT, SCENE_QUAD_POINTS } from "../config/sceneMockups.js";

const sceneImageCache = new Map();

// A composite is a chain of full-size intermediates (surface → warped quad → lit
// layer → frame), and a gallery batch or a corner drag repeats it dozens of
// times per second. Reusing those canvases keeps the pipeline from allocating a
// few megabytes of garbage per frame, which is what showed up as frame drops.
const scratchCanvases = new Map();

function acquireScratch(key, width, height) {
  let canvas = scratchCanvases.get(key);
  if (!canvas) {
    canvas = document.createElement("canvas");
    canvas.width = Math.max(1, width);
    canvas.height = Math.max(1, height);
    scratchCanvases.set(key, canvas);
    return canvas;
  }
  // Assigning a size reallocates the backing store, so only resize when needed.
  if (canvas.width !== width) canvas.width = width;
  if (canvas.height !== height) canvas.height = height;
  const context = canvas.getContext("2d");
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.globalAlpha = 1;
  context.globalCompositeOperation = "source-over";
  context.clearRect(0, 0, width, height);
  return canvas;
}

// The warp reads every card texel through getImageData, which forces a GPU
// readback. Dragging a corner re-composites the same card every frame, so the
// decoded pixels are kept for the current card only.
//
// Only a decoded <img> is immutable enough to be cached by identity:
// `prepareCardSurface` hands over a pooled canvas that is repainted for the next
// card, so treating that identity as a content identity would hand the second
// gallery image the first card's pixels.
let cardPixelCache = null;
let cardPixelCanvas = null;
let cardPixelContext = null;

function readCardPixels(cardSource) {
  const width = cardSource.naturalWidth || cardSource.width;
  const height = cardSource.naturalHeight || cardSource.height;
  if (!width || !height) return null;
  const cacheable =
    typeof HTMLImageElement !== "undefined" && cardSource instanceof HTMLImageElement;
  if (
    cacheable &&
    cardPixelCache &&
    cardPixelCache.source === cardSource &&
    cardPixelCache.width === width &&
    cardPixelCache.height === height
  ) {
    return cardPixelCache;
  }
  if (!cardPixelCanvas) {
    cardPixelCanvas = document.createElement("canvas");
    cardPixelContext = cardPixelCanvas.getContext("2d", { willReadFrequently: true });
  }
  if (cardPixelCanvas.width !== width) cardPixelCanvas.width = width;
  if (cardPixelCanvas.height !== height) cardPixelCanvas.height = height;
  cardPixelContext.clearRect(0, 0, width, height);
  cardPixelContext.drawImage(cardSource, 0, 0);
  const image = cardPixelContext.getImageData(0, 0, width, height);
  const entry = {
    source: cardSource,
    width,
    height,
    pixels8: image.data,
    pixels32: new Uint32Array(image.data.buffer),
  };
  if (cacheable) cardPixelCache = entry;
  return entry;
}

// Drops the decoded card so a long gallery run does not pin one card's pixels.
export function releaseCardPixels() {
  cardPixelCache = null;
}

export function loadSceneImage(src) {
  if (!sceneImageCache.has(src)) {
    const promise = new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error(`Failed to load scene: ${src}`));
      image.src = src;
    });
    // A failed decode must not become the cached answer for the whole session:
    // the file can reappear (a restored asset, a slower disk) and every caller
    // would otherwise keep receiving the same rejection.
    promise.catch(() => sceneImageCache.delete(src));
    sceneImageCache.set(src, promise);
  }
  return sceneImageCache.get(src);
}

// Lets callers that composite many scenes in a row drop each decoded photo, so
// a full-catalog preview never keeps every full-resolution scene resident.
export function releaseSceneImage(src) {
  sceneImageCache.delete(src);
}

// The pooled intermediates are sized for the current scene page (tens of MB at
// 2160×2880). They are worth keeping across one batch or one drag, but not for
// the rest of the session, so a run releases them when it ends.
export function releaseSceneScratch() {
  scratchCanvases.forEach((canvas) => {
    canvas.width = 0;
    canvas.height = 0;
  });
  scratchCanvases.clear();
}

export function normalizeQuad(quad, fallback = null) {
  const result = {};
  for (const key of SCENE_QUAD_POINTS) {
    const fallbackPoint = fallback?.[key] || [0, 0];
    const point = Array.isArray(quad?.[key]) ? quad[key] : null;
    const x = Number(point?.[0]);
    const y = Number(point?.[1]);
    result[key] = [
      Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : fallbackPoint[0],
      Number.isFinite(y) ? Math.min(1, Math.max(0, y)) : fallbackPoint[1],
    ];
  }
  return result;
}

export function quadIsDegenerate(quad) {
  const points = SCENE_QUAD_POINTS.map((key) => quad[key]);
  const area = Math.abs(
    points.reduce((sum, point, index) => {
      const next = points[(index + 1) % points.length];
      return sum + (point[0] * next[1] - next[0] * point[1]);
    }, 0) / 2,
  );
  return area < 0.005;
}

// Maps destination (quad) points to source (card) points. Returns the eight
// coefficients of a projective transform, or null for a degenerate quad.
function solveHomography(source, target) {
  const matrix = [];
  const vector = [];
  for (let index = 0; index < 4; index += 1) {
    const [x, y] = source[index];
    const [u, v] = target[index];
    matrix.push([x, y, 1, 0, 0, 0, -x * u, -y * u]);
    vector.push(u);
    matrix.push([0, 0, 0, x, y, 1, -x * v, -y * v]);
    vector.push(v);
  }

  const size = 8;
  for (let column = 0; column < size; column += 1) {
    let pivot = column;
    for (let row = column + 1; row < size; row += 1) {
      if (Math.abs(matrix[row][column]) > Math.abs(matrix[pivot][column])) pivot = row;
    }
    if (Math.abs(matrix[pivot][column]) < 1e-12) return null;
    if (pivot !== column) {
      [matrix[column], matrix[pivot]] = [matrix[pivot], matrix[column]];
      [vector[column], vector[pivot]] = [vector[pivot], vector[column]];
    }
    const divisor = matrix[column][column];
    for (let k = column; k < size; k += 1) matrix[column][k] /= divisor;
    vector[column] /= divisor;
    for (let row = 0; row < size; row += 1) {
      if (row === column) continue;
      const factor = matrix[row][column];
      if (!factor) continue;
      for (let k = column; k < size; k += 1) matrix[row][k] -= factor * matrix[column][k];
      vector[row] -= factor * vector[column];
    }
  }
  return vector;
}

export function getSceneCoverRect(sceneImage, width, height) {
  const scale = Math.max(
    width / sceneImage.naturalWidth,
    height / sceneImage.naturalHeight,
  );
  const drawnWidth = sceneImage.naturalWidth * scale;
  const drawnHeight = sceneImage.naturalHeight * scale;
  return {
    offsetX: (width - drawnWidth) / 2,
    offsetY: (height - drawnHeight) / 2,
    drawnWidth,
    drawnHeight,
  };
}

// Calibrated quads live in scene-photo coordinates; the preview needs them in
// output-canvas coordinates after the cover crop.
export function sceneQuadToOutput(quad, sceneImage, width, height) {
  const normalizedQuad = normalizeQuad(quad);
  const { offsetX, offsetY, drawnWidth, drawnHeight } = getSceneCoverRect(
    sceneImage,
    width,
    height,
  );
  return SCENE_QUAD_POINTS.map((key) => [
    offsetX + normalizedQuad[key][0] * drawnWidth,
    offsetY + normalizedQuad[key][1] * drawnHeight,
  ]);
}

export function outputPointToScenePoint(point, sceneImage, width, height) {
  const { offsetX, offsetY, drawnWidth, drawnHeight } = getSceneCoverRect(
    sceneImage,
    width,
    height,
  );
  return [
    Math.min(1, Math.max(0, (point[0] - offsetX) / drawnWidth)),
    Math.min(1, Math.max(0, (point[1] - offsetY) / drawnHeight)),
  ];
}

function drawSceneCover(context, scene, width, height) {
  const rect = getSceneCoverRect(scene, width, height);
  context.drawImage(scene, rect.offsetX, rect.offsetY, rect.drawnWidth, rect.drawnHeight);
  return rect;
}

export function loadImageSource(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load image: ${src}`));
    image.src = src;
  });
}

function quadSize(destinationQuad) {
  const [tl, tr, br, bl] = destinationQuad;
  const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
  const width = (distance(tl, tr) + distance(bl, br)) / 2;
  const height = (distance(tl, bl) + distance(tr, br)) / 2;
  return { width, height };
}

// Our cards are authored 3:4 while most bundled screens and sheets are not, so a
// contained card always leaves a margin on the surface. Those margins used to
// stay transparent so the photo's own screen or paper showed through, which
// reads as an empty band. They are instead filled with the card's own outermost
// row and column stretched outwards: the seam is exact, and the surface reads as
// the card's background continuing to the screen edge. A softened copy of the
// whole card is deliberately not used as the fill — on a light card it reads as
// a rendering smear instead of a surface.
const MARGIN_FALLOFF = 0.12;

function fillContainMargins(context, cardSource, layout) {
  const { x, y, width, height, surfaceWidth, surfaceHeight } = layout;
  const sourceWidth = cardSource.naturalWidth || cardSource.width;
  const sourceHeight = cardSource.naturalHeight || cardSource.height;
  const left = Math.max(0, x);
  const right = Math.max(0, surfaceWidth - (x + width));
  const top = Math.max(0, y);
  const bottom = Math.max(0, surfaceHeight - (y + height));
  if (left < 0.5 && right < 0.5 && top < 0.5 && bottom < 0.5) return;

  context.save();
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";

  // Each margin takes one source pixel and overlaps the card by a pixel, so a
  // rounding difference can never leave a hairline of the photo between them.
  if (top >= 0.5) {
    context.drawImage(cardSource, 0, 0, sourceWidth, 1, 0, 0, surfaceWidth, top + 1);
  }
  if (bottom >= 0.5) {
    context.drawImage(
      cardSource,
      0,
      sourceHeight - 1,
      sourceWidth,
      1,
      0,
      y + height - 1,
      surfaceWidth,
      bottom + 1,
    );
  }
  if (left >= 0.5) {
    context.drawImage(cardSource, 0, 0, 1, sourceHeight, 0, 0, left + 1, surfaceHeight);
  }
  if (right >= 0.5) {
    context.drawImage(
      cardSource,
      sourceWidth - 1,
      0,
      1,
      sourceHeight,
      x + width - 1,
      0,
      right + 1,
      surfaceHeight,
    );
  }

  // A whisper of falloff towards the outer edge, so a wide margin reads as
  // depth rather than as a flat slab of the card's colour.
  const shade = (fromX, fromY, toX, toY, areaX, areaY, areaWidth, areaHeight) => {
    const gradient = context.createLinearGradient(fromX, fromY, toX, toY);
    gradient.addColorStop(0, `rgba(8, 10, 16, ${MARGIN_FALLOFF})`);
    gradient.addColorStop(1, "rgba(8, 10, 16, 0)");
    context.fillStyle = gradient;
    context.fillRect(areaX, areaY, areaWidth, areaHeight);
  };
  if (left >= 0.5) shade(0, 0, left, 0, 0, 0, left, surfaceHeight);
  if (right >= 0.5) {
    shade(surfaceWidth, 0, surfaceWidth - right, 0, surfaceWidth - right, 0, right, surfaceHeight);
  }
  if (top >= 0.5) shade(0, 0, 0, top, 0, 0, surfaceWidth, top);
  if (bottom >= 0.5) {
    shade(0, surfaceHeight, 0, surfaceHeight - bottom, 0, surfaceHeight - bottom, surfaceWidth, bottom);
  }

  context.restore();
}

// Screens and printed pages have their own aspect ratio, and the photo shows
// them at an angle. `fit` decides how the card meets that surface:
// - `fill`: the card takes the surface exactly, the way a real 3:4 panel looks
//   under the same perspective. Portrait pads use it, because their blank plate
//   *is* the panel: a 3:4 card covers it edge to edge with no margin, and the
//   projective warp supplies the foreshortening.
// - `contain`: the whole card stays readable and the card's own edge colours are
//   continued into the margins. Used where the surface is genuinely another
//   physical shape (landscape monitors, laptops, sheets of paper).
// - `cover`: fills and crops, for flat prints whose ratio is already near 3:4.
// None of them leaves a see-through margin, because the photo's blank plate
// showing through is exactly what reads as an empty band.
function prepareCardSurface(cardSource, destinationQuad, fit, padding = 0, options = {}) {
  const sourceWidth = cardSource.naturalWidth || cardSource.width;
  const sourceHeight = cardSource.naturalHeight || cardSource.height;
  if (!sourceWidth || !sourceHeight) return cardSource;

  const destination = quadSize(destinationQuad);
  if (!destination.width || !destination.height) return cardSource;
  if (fit !== "cover" && fit !== "contain" && fit !== "fill") return cardSource;

  const { maxLongSide = 2400, minLongSide = 600, oversample = 2 } = options;
  const aspect = destination.width / destination.height;
  const longSide = Math.min(
    maxLongSide,
    Math.max(minLongSide, Math.round(Math.max(destination.width, destination.height) * oversample)),
  );
  let surfaceWidth = aspect >= 1 ? longSide : Math.max(2, Math.round(longSide * aspect));
  let surfaceHeight = aspect >= 1 ? Math.max(2, Math.round(longSide / aspect)) : longSide;

  const inset = Math.min(0.2, Math.max(0, Number(padding) || 0));
  const usable = 1 - inset * 2;
  const fitScale =
    fit === "cover"
      ? Math.max(
          (surfaceWidth * usable) / sourceWidth,
          (surfaceHeight * usable) / sourceHeight,
        )
      : Math.min(
          (surfaceWidth * usable) / sourceWidth,
          (surfaceHeight * usable) / sourceHeight,
        );

  // The fit scale is proportional to the surface size, so a surface that would
  // upscale the card is simply shrunk until the card lands 1:1. Invented texels
  // carry no detail and only give the warp's area filter more to average away.
  const shrink = fit === "fill" ? 1 : 1 / Math.max(1, fitScale);
  surfaceWidth = Math.max(2, Math.round(surfaceWidth * shrink));
  surfaceHeight = Math.max(2, Math.round(surfaceHeight * shrink));
  const scale = fitScale * shrink;

  const canvas = acquireScratch("card-surface", surfaceWidth, surfaceHeight);
  const context = canvas.getContext("2d");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";

  if (fit === "fill") {
    context.drawImage(cardSource, 0, 0, surfaceWidth, surfaceHeight);
    return canvas;
  }

  const drawnWidth = sourceWidth * scale;
  const drawnHeight = sourceHeight * scale;
  const layout = {
    x: (surfaceWidth - drawnWidth) / 2,
    y: (surfaceHeight - drawnHeight) / 2,
    width: drawnWidth,
    height: drawnHeight,
    surfaceWidth,
    surfaceHeight,
  };
  if (fit === "contain") fillContainMargins(context, cardSource, layout);
  context.drawImage(cardSource, layout.x, layout.y, drawnWidth, drawnHeight);
  return canvas;
}

// Warps the card onto the quad with a real projective transform. A mesh of
// affine cells would leave hairline seams across card text, so this samples the
// source image per destination pixel instead. The card is masked to a rounded
// rectangle in source space so the display's rounded corners survive the warp.
//
// When the card is minified onto a smaller screen a single 4-tap bilinear both
// softens and aliases it, and the fine strokes of the card's type are the first
// thing to go. So each destination pixel averages the exact rectangle of the
// card it covers, weighted by how much of every texel falls inside it and
// premultiplied so the transparent, rounded-off corners do not darken the edges.
function warpCardIntoQuad(context, cardSource, destinationQuad, cornerRadius) {
  const source = readCardPixels(cardSource);
  if (!source) return null;
  const { width: sourceWidth, height: sourceHeight } = source;
  const pixels32 = source.pixels32;
  const sourcePixels = source.pixels8;

  const targetPoints = [
    [0, 0],
    [sourceWidth, 0],
    [sourceWidth, sourceHeight],
    [0, sourceHeight],
  ];
  const homography = solveHomography(destinationQuad, targetPoints);
  if (!homography) return null;

  const cornerFraction = Math.min(Math.max(0, Number(cornerRadius) || 0), 0.25);
  const cornerRadiusPx = Math.min(
    cornerFraction * sourceWidth,
    sourceWidth / 2,
    sourceHeight / 2,
  );
  const [h0, h1, h2, h3, h4, h5, h6, h7] = homography;
  const xs = destinationQuad.map((point) => point[0]);
  const ys = destinationQuad.map((point) => point[1]);
  const minX = Math.max(0, Math.floor(Math.min(...xs)));
  const maxX = Math.min(context.canvas.width, Math.ceil(Math.max(...xs)));
  const minY = Math.max(0, Math.floor(Math.min(...ys)));
  const maxY = Math.min(context.canvas.height, Math.ceil(Math.max(...ys)));
  const boxWidth = maxX - minX;
  const boxHeight = maxY - minY;
  if (boxWidth <= 0 || boxHeight <= 0) return null;

  const buffer = acquireScratch("quad-buffer", boxWidth, boxHeight);
  const bufferContext = buffer.getContext("2d");
  const out = bufferContext.createImageData(boxWidth, boxHeight);
  const outData = out.data;
  const outPixels = new Uint32Array(outData.buffer);

  // A magnified or 1:1 screen only needs one interpolation per pixel; anything
  // that minifies the card gets the exact overlap box below.
  const magnifyOnly =
    sourceWidth <= boxWidth * 1.05 && sourceHeight <= boxHeight * 1.05;
  const maxBoxHalf = 10;

  // Writes the bilinear interpolation at source coordinate (u, v) into `tap`
  // (straight, non-premultiplied RGBA).
  const tap = new Float64Array(4);
  function sampleBilinear(u, v) {
    const sampleX = Math.min(sourceWidth - 1, Math.max(0, u - 0.5));
    const sampleY = Math.min(sourceHeight - 1, Math.max(0, v - 0.5));
    const x0 = Math.floor(sampleX);
    const y0 = Math.floor(sampleY);
    const x1 = Math.min(sourceWidth - 1, x0 + 1);
    const y1 = Math.min(sourceHeight - 1, y0 + 1);
    const fx = sampleX - x0;
    const fy = sampleY - y0;

    const index00 = (y0 * sourceWidth + x0) * 4;
    const index10 = (y0 * sourceWidth + x1) * 4;
    const index01 = (y1 * sourceWidth + x0) * 4;
    const index11 = (y1 * sourceWidth + x1) * 4;
    const w00 = (1 - fx) * (1 - fy);
    const w10 = fx * (1 - fy);
    const w01 = (1 - fx) * fy;
    const w11 = fx * fy;

    tap[0] =
      sourcePixels[index00] * w00 +
      sourcePixels[index10] * w10 +
      sourcePixels[index01] * w01 +
      sourcePixels[index11] * w11;
    tap[1] =
      sourcePixels[index00 + 1] * w00 +
      sourcePixels[index10 + 1] * w10 +
      sourcePixels[index01 + 1] * w01 +
      sourcePixels[index11 + 1] * w11;
    tap[2] =
      sourcePixels[index00 + 2] * w00 +
      sourcePixels[index10 + 2] * w10 +
      sourcePixels[index01 + 2] * w01 +
      sourcePixels[index11 + 2] * w11;
    tap[3] =
      sourcePixels[index00 + 3] * w00 +
      sourcePixels[index10 + 3] * w10 +
      sourcePixels[index01 + 3] * w01 +
      sourcePixels[index11 + 3] * w11;
  }

  // Coverage only needs the corner distance where a rounded corner can bite;
  // the interior is opaque whatever the radius is.
  const cornerLimit = cornerRadiusPx + 1;
  const interiorMaxU = sourceWidth - cornerLimit;
  const interiorMaxV = sourceHeight - cornerLimit;
  const halfWidth = sourceWidth / 2;
  const halfHeight = sourceHeight / 2;
  const cornerInsetX = halfWidth - cornerRadiusPx;
  const cornerInsetY = halfHeight - cornerRadiusPx;

  const startX = minX + 0.5;
  for (let y = 0; y < boxHeight; y += 1) {
    const destY = minY + y + 0.5;
    // The projective map is affine along a row, so u, v and the denominator step
    // by a constant: one divide per pixel instead of three products plus one.
    let scale = h6 * startX + h7 * destY + 1;
    let uNumerator = h0 * startX + h1 * destY + h2;
    let vNumerator = h3 * startX + h4 * destY + h5;
    let pixel = y * boxWidth;
    for (let x = 0; x < boxWidth; x += 1, pixel += 1) {
      const inverse = 1 / scale;
      const u = uNumerator * inverse;
      const v = vNumerator * inverse;
      const denominator = scale;
      uNumerator += h0;
      vNumerator += h3;
      scale += h6;
      if (denominator > -1e-9 && denominator < 1e-9) continue;
      if (u < 0 || u > sourceWidth || v < 0 || v > sourceHeight) continue;

      let coverage = 1;
      if (
        u < cornerLimit ||
        u > interiorMaxU ||
        v < cornerLimit ||
        v > interiorMaxV
      ) {
        const cornerX = Math.abs(u - halfWidth) - cornerInsetX;
        const cornerY = Math.abs(v - halfHeight) - cornerInsetY;
        const outside =
          Math.min(Math.max(cornerX, cornerY), 0) +
          Math.hypot(Math.max(cornerX, 0), Math.max(cornerY, 0)) -
          cornerRadiusPx;
        coverage = Math.min(1, Math.max(0, 0.5 - outside));
        if (coverage <= 0) continue;
      }

      let red;
      let green;
      let blue;
      let alpha;
      if (magnifyOnly) {
        sampleBilinear(u, v);
        red = tap[0];
        green = tap[1];
        blue = tap[2];
        alpha = tap[3] / 255;
      } else {
        // The local footprint of one destination pixel in texels: the derivative
        // of the projective map, so a foreshortened far edge averages more than
        // the near edge instead of sharing one global blur.
        const invHalf = Math.abs(inverse) * 0.5;
        const halfX = Math.min(
          maxBoxHalf,
          (Math.abs(h0 - u * h6) + Math.abs(h1 - u * h7)) * invHalf,
        );
        const halfY = Math.min(
          maxBoxHalf,
          (Math.abs(h3 - v * h6) + Math.abs(h4 - v * h7)) * invHalf,
        );
        const u0 = u - halfX;
        const u1 = u + halfX;
        const v0 = v - halfY;
        const v1 = v + halfY;
        const tx0 = Math.max(0, Math.floor(u0));
        const tx1 = Math.min(sourceWidth - 1, Math.floor(u1));
        const ty0 = Math.max(0, Math.floor(v0));
        const ty1 = Math.min(sourceHeight - 1, Math.floor(v1));
        let sumWeight = 0;
        let sumAlpha = 0;
        let sumRed = 0;
        let sumGreen = 0;
        let sumBlue = 0;
        // One 32-bit read per texel: four channel reads cost the loop about
        // twice as much, and this inner box runs up to 441 times per pixel.
        // Only the first and last texel of the box are partially covered; the
        // rest carry weight 1, which is what `min`/`max` per texel were paying for.
        if (tx0 === tx1) {
          const weightX = Math.min(tx0 + 1, u1) - Math.max(tx0, u0);
          for (let ty = ty0; ty <= ty1; ty += 1) {
            const weightY = Math.min(ty + 1, v1) - Math.max(ty, v0);
            if (weightY <= 0) continue;
            const weight = weightX * weightY;
            const texel = pixels32[ty * sourceWidth + tx0];
            const texelAlpha = texel >>> 24;
            sumWeight += weight;
            sumAlpha += texelAlpha * weight;
            sumRed += (texel & 255) * texelAlpha * weight;
            sumGreen += ((texel >>> 8) & 255) * texelAlpha * weight;
            sumBlue += ((texel >>> 16) & 255) * texelAlpha * weight;
          }
        } else {
          const firstX = tx0 + 1 - u0;
          const lastX = u1 - tx1;
          for (let ty = ty0; ty <= ty1; ty += 1) {
            const weightY = Math.min(ty + 1, v1) - Math.max(ty, v0);
            if (weightY <= 0) continue;
            const row = ty * sourceWidth;
            let weight = firstX * weightY;
            let texel = pixels32[row + tx0];
            let texelAlpha = texel >>> 24;
            sumWeight += weight;
            sumAlpha += texelAlpha * weight;
            sumRed += (texel & 255) * texelAlpha * weight;
            sumGreen += ((texel >>> 8) & 255) * texelAlpha * weight;
            sumBlue += ((texel >>> 16) & 255) * texelAlpha * weight;
            for (let tx = tx0 + 1; tx < tx1; tx += 1) {
              texel = pixels32[row + tx];
              texelAlpha = texel >>> 24;
              sumWeight += weightY;
              sumAlpha += texelAlpha * weightY;
              sumRed += (texel & 255) * texelAlpha * weightY;
              sumGreen += ((texel >>> 8) & 255) * texelAlpha * weightY;
              sumBlue += ((texel >>> 16) & 255) * texelAlpha * weightY;
            }
            weight = lastX * weightY;
            texel = pixels32[row + tx1];
            texelAlpha = texel >>> 24;
            sumWeight += weight;
            sumAlpha += texelAlpha * weight;
            sumRed += (texel & 255) * texelAlpha * weight;
            sumGreen += ((texel >>> 8) & 255) * texelAlpha * weight;
            sumBlue += ((texel >>> 16) & 255) * texelAlpha * weight;
          }
        }
        if (sumWeight <= 0 || sumAlpha <= 0) continue;
        red = sumRed / sumAlpha;
        green = sumGreen / sumAlpha;
        blue = sumBlue / sumAlpha;
        alpha = sumAlpha / sumWeight / 255;
      }

      alpha *= coverage;
      if (alpha <= 0.002) continue;

      // Little-endian RGBA: one 32-bit store per pixel instead of four.
      outPixels[pixel] =
        (((alpha * 255 + 0.5) | 0) << 24) |
        (((blue + 0.5) | 0) << 16) |
        (((green + 0.5) | 0) << 8) |
        ((red + 0.5) | 0);
    }
  }

  bufferContext.putImageData(out, 0, 0);
  return { canvas: buffer, x: minX, y: minY };
}

// The photo already contains the screen and its bezel; only the display is
// replaced. Tint, glare, and dim are clipped to the card's own alpha so they
// never tint the bezel exposed by the rounded corners.
function applyScreenLighting(buffer, quad, lighting) {
  if (!lighting) return;
  const tintOpacity = Number(lighting.tint?.opacity) || 0;
  const glare = Number(lighting.glare) || 0;
  const dim = Number(lighting.dim) || 0;
  if (tintOpacity <= 0 && glare <= 0 && dim <= 0) return;
  const context = buffer.getContext("2d");
  // The mask is the layer's own alpha; a pooled canvas keeps this pass from
  // allocating (and the browser from clearing) a second full-size bitmap.
  const mask = acquireScratch("lighting-mask", buffer.width, buffer.height);
  mask.getContext("2d").drawImage(buffer, 0, 0);

  const xs = quad.map((point) => point[0]);
  const ys = quad.map((point) => point[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  context.save();

  const tint = lighting.tint;
  if (tint?.opacity > 0) {
    context.globalCompositeOperation = "soft-light";
    context.fillStyle = `rgba(${tint.color}, ${tint.opacity})`;
    context.fillRect(0, 0, buffer.width, buffer.height);
  }

  if (lighting.glare > 0) {
    context.globalCompositeOperation = "source-over";
    const sheen = context.createLinearGradient(minX, minY, maxX, maxY);
    sheen.addColorStop(0, `rgba(255, 255, 255, ${lighting.glare})`);
    sheen.addColorStop(0.42, "rgba(255, 255, 255, 0)");
    sheen.addColorStop(1, "rgba(255, 255, 255, 0)");
    context.fillStyle = sheen;
    context.fillRect(minX, minY, maxX - minX, maxY - minY);
  }

  if (lighting.dim > 0) {
    context.globalCompositeOperation = "multiply";
    context.fillStyle = `rgba(0, 0, 0, ${lighting.dim})`;
    context.fillRect(0, 0, buffer.width, buffer.height);
  }

  context.restore();

  context.globalCompositeOperation = "destination-in";
  context.drawImage(mask, 0, 0);
  context.globalCompositeOperation = "source-over";
}

export function composeSceneMockup({
  sceneImage,
  cardImage,
  quad,
  lighting = null,
  cornerRadius = 0,
  fit = "cover",
  padding = 0,
  fast = false,
  width = SCENE_MOCKUP_OUTPUT.width,
  height = SCENE_MOCKUP_OUTPUT.height,
}) {
  const normalizedQuad = normalizeQuad(quad);
  if (!sceneImage || !cardImage || quadIsDegenerate(normalizedQuad)) return null;

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";

  const { offsetX, offsetY, drawnWidth, drawnHeight } = drawSceneCover(
    context,
    sceneImage,
    width,
    height,
  );

  // Template quads are normalized to the scene photo, so apply the cover crop
  // before drawing. A scene cropped to a different output ratio must not shift
  // the calibration.
  const destinationQuad = SCENE_QUAD_POINTS.map((key) => [
    offsetX + normalizedQuad[key][0] * drawnWidth,
    offsetY + normalizedQuad[key][1] * drawnHeight,
  ]);

  const cardSurface = prepareCardSurface(
    cardImage,
    destinationQuad,
    fit,
    padding,
    // A live drag renders every frame: keep the intermediate surface at the
    // destination's own size so the warp takes the single-tap bilinear path
    // instead of area-averaging an oversized card, which is the frame-drop cost.
    fast ? { maxLongSide: 1200, minLongSide: 128, oversample: 1 } : undefined,
  );
  const layer = warpCardIntoQuad(context, cardSurface, destinationQuad, cornerRadius);
  if (!layer) return canvas;
  const localQuad = destinationQuad.map(([x, y]) => [x - layer.x, y - layer.y]);
  applyScreenLighting(layer.canvas, localQuad, lighting);
  context.drawImage(layer.canvas, layer.x, layer.y);
  return canvas;
}

export function canvasToBlob(canvas, mimeType = "image/png", quality = 0.92) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), mimeType, quality);
  });
}
