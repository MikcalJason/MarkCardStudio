import { SCENE_QUAD_POINTS } from "../config/sceneMockups.js";

// One-shot quad auto-fit: snaps each calibrated edge onto the nearest strong
// luminance edge (the screen bezel, the sheet boundary, the frame) so the user
// starts from an aligned quad instead of dragging four corners by hand.
//
// The search is deliberately local. It starts from the current quad and only
// looks for edges inside a narrow band around each side, which keeps a wrong
// detection bounded to one side: a side with no confident edge keeps its
// current line, and the whole fit is rejected when the result would move a
// corner implausibly far. A global "find the biggest bright rectangle" pass
// would fight photos where the sheet and the wall share a tone.

const WORK_LONG_SIDE = 384;
const SAMPLES_PER_EDGE = 24;
// Search band around each edge, as a fraction of the edge length.
const SEARCH_FRACTION = 0.1;
const SEARCH_MIN_PX = 10;
const SEARCH_MAX_PX = 48;
// Minimum |gradient| (0-255 scale) that counts as a real edge.
const EDGE_STRENGTH = 14;
// How far (normalized) a corner may travel before the fit is rejected.
const MAX_CORNER_MOVE = 0.18;
// A side needs at least this share of confident samples before it snaps.
const MIN_SAMPLE_RATIO = 0.5;

function rasterizeGray(image) {
  const iw = image.naturalWidth || image.width;
  const ih = image.naturalHeight || image.height;
  if (!iw || !ih) return null;
  const scale = Math.min(1, WORK_LONG_SIDE / Math.max(iw, ih));
  const width = Math.max(2, Math.round(iw * scale));
  const height = Math.max(2, Math.round(ih * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.drawImage(image, 0, 0, width, height);
  const { data } = context.getImageData(0, 0, width, height);
  const gray = new Float32Array(width * height);
  for (let i = 0, p = 0; i < gray.length; i += 1, p += 4) {
    gray[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
  }
  return { gray, width, height };
}

function sampleGray(plane, x, y) {
  const xi = Math.min(plane.width - 1, Math.max(0, Math.round(x)));
  const yi = Math.min(plane.height - 1, Math.max(0, Math.round(y)));
  return plane.gray[yi * plane.width + xi];
}

// Signed distance (pixels, along the normal) from the current edge to the
// nearest confident luminance step inside the band, or null when the band is
// flat. Among comparably strong edges the closest one wins: the real boundary,
// not a stronger line deeper in the background.
function snapOffset(plane, x, y, nx, ny, radius) {
  const steps = Math.max(3, Math.round(radius));
  const count = steps * 2 + 1;
  const values = new Float32Array(count);
  for (let i = 0; i < count; i += 1) {
    const t = i - steps;
    values[i] = sampleGray(plane, x + nx * t, y + ny * t);
  }
  const gradients = new Float32Array(count);
  let maxGradient = 0;
  for (let i = 1; i < count - 1; i += 1) {
    gradients[i] = Math.abs((values[i + 1] - values[i - 1]) / 2);
    if (gradients[i] > maxGradient) maxGradient = gradients[i];
  }
  if (maxGradient < EDGE_STRENGTH) return null;
  const bar = maxGradient * 0.6;
  let best = steps;
  let bestDistance = Infinity;
  for (let i = 1; i < count - 1; i += 1) {
    if (gradients[i] < bar) continue;
    const distance = Math.abs(i - steps);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  return best - steps;
}

// Total least squares over the snapped sample points: a point on the line plus
// its direction (the scatter's principal axis).
function fitEdgeLine(points) {
  let mx = 0;
  let my = 0;
  for (const point of points) {
    mx += point[0];
    my += point[1];
  }
  mx /= points.length;
  my /= points.length;
  let sxx = 0;
  let sxy = 0;
  let syy = 0;
  for (const point of points) {
    const dx = point[0] - mx;
    const dy = point[1] - my;
    sxx += dx * dx;
    sxy += dx * dy;
    syy += dy * dy;
  }
  const theta = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  return { px: mx, py: my, dx: Math.cos(theta), dy: Math.sin(theta) };
}

function intersectLines(a, b) {
  const denom = a.dx * b.dy - a.dy * b.dx;
  if (Math.abs(denom) < 1e-9) return null;
  const ex = b.px - a.px;
  const ey = b.py - a.py;
  const t = (ex * b.dy - ey * b.dx) / denom;
  return [a.px + a.dx * t, a.py + a.dy * t];
}

function quadArea(points) {
  let sum = 0;
  for (let i = 0; i < 4; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % 4];
    sum += a[0] * b[1] - b[0] * a[1];
  }
  return Math.abs(sum) / 2;
}

function quadIsConvex(points) {
  let sign = 0;
  for (let i = 0; i < 4; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % 4];
    const c = points[(i + 2) % 4];
    const cross = (b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]);
    if (Math.abs(cross) < 1e-9) return false;
    const current = Math.sign(cross);
    if (!sign) sign = current;
    else if (current !== sign) return false;
  }
  return Boolean(sign);
}

const clamp01 = (value) => Math.min(1, Math.max(0, value));

// Returns a new normalized quad, or null when no confident fit exists (the
// caller then keeps the current corners untouched).
export function autoFitQuad(sceneImage, quad) {
  if (!sceneImage || !quad) return null;
  const plane = rasterizeGray(sceneImage);
  if (!plane) return null;

  const corners = SCENE_QUAD_POINTS.map((key) => {
    const point = quad[key];
    return Array.isArray(point) ? [Number(point[0]) || 0, Number(point[1]) || 0] : [0, 0];
  });

  // Edge order follows SCENE_QUAD_POINTS: top, right, bottom, left.
  const edgePairs = [[0, 1], [1, 2], [2, 3], [3, 0]];
  const lines = [];
  for (const [ai, bi] of edgePairs) {
    const a = corners[ai];
    const b = corners[bi];
    const ax = a[0] * plane.width;
    const ay = a[1] * plane.height;
    const bx = b[0] * plane.width;
    const by = b[1] * plane.height;
    const ex = bx - ax;
    const ey = by - ay;
    const length = Math.hypot(ex, ey);
    if (length < 4) {
      lines.push(null);
      continue;
    }
    const dx = ex / length;
    const dy = ey / length;
    const nx = -dy;
    const ny = dx;
    const radius = Math.min(SEARCH_MAX_PX, Math.max(SEARCH_MIN_PX, length * SEARCH_FRACTION));
    const snapped = [];
    for (let i = 0; i < SAMPLES_PER_EDGE; i += 1) {
      // Skip the ends: near a corner the neighbouring edge pollutes the band.
      const t = 0.12 + (0.76 * i) / (SAMPLES_PER_EDGE - 1);
      const px = ax + ex * t;
      const py = ay + ey * t;
      const offset = snapOffset(plane, px, py, nx, ny, radius);
      if (offset === null) continue;
      snapped.push([px + nx * offset, py + ny * offset]);
    }
    if (snapped.length >= SAMPLES_PER_EDGE * MIN_SAMPLE_RATIO) {
      lines.push(fitEdgeLine(snapped));
    } else {
      // Not enough confident samples: keep the current edge exactly where it
      // is, so one weak side (a glare band, a hand over the edge) never drags
      // the fit.
      lines.push({ px: ax, py: ay, dx, dy });
    }
  }

  const [top, right, bottom, left] = lines;
  if (!top || !right || !bottom || !left) return null;
  const tl = intersectLines(left, top);
  const tr = intersectLines(top, right);
  const br = intersectLines(right, bottom);
  const bl = intersectLines(bottom, left);
  if (!tl || !tr || !br || !bl) return null;

  // The intersections come back in work-plane pixels while `corners` are
  // normalized, so every guard below has to compare in normalized units.
  const fitted = [tl, tr, br, bl].map(([x, y]) => [x / plane.width, y / plane.height]);
  for (let i = 0; i < 4; i += 1) {
    const point = fitted[i];
    const original = corners[i];
    if (
      Math.abs(point[0] - original[0]) > MAX_CORNER_MOVE ||
      Math.abs(point[1] - original[1]) > MAX_CORNER_MOVE
    ) {
      return null;
    }
  }
  if (quadArea(fitted) < quadArea(corners) * 0.35) return null;
  if (quadArea(fitted) > quadArea(corners) * 2.8) return null;
  if (!quadIsConvex(fitted)) return null;

  return {
    tl: [clamp01(fitted[0][0]), clamp01(fitted[0][1])],
    tr: [clamp01(fitted[1][0]), clamp01(fitted[1][1])],
    br: [clamp01(fitted[2][0]), clamp01(fitted[2][1])],
    bl: [clamp01(fitted[3][0]), clamp01(fitted[3][1])],
  };
}
