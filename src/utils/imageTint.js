// Derives a card backdrop from the picture itself: a tiny downsampled raster
// (smoothly upscaled by the browser, which reads as a blur) plus two colors.
// Computing it once when the image joins the gallery keeps rendering and export
// synchronous, and avoids CSS blur, which is unreliable in the export clone.
const BACKDROP_WIDTH = 18;
const BACKDROP_HEIGHT = 24;
const HEX_PATTERN = /^#[0-9a-f]{6}$/i;

function toHex(channel) {
  return Math.max(0, Math.min(255, Math.round(channel))).toString(16).padStart(2, "0");
}

export function normalizeTint(raw) {
  if (!raw || typeof raw !== "object") return null;
  const average = HEX_PATTERN.test(String(raw.average)) ? String(raw.average).toLowerCase() : "";
  const accent = HEX_PATTERN.test(String(raw.accent)) ? String(raw.accent).toLowerCase() : "";
  const backdrop =
    typeof raw.backdrop === "string" && raw.backdrop.startsWith("data:image/")
      ? raw.backdrop.slice(0, 40_000)
      : "";
  if (!average && !backdrop) return null;
  return { average, accent, backdrop };
}

function loadImage(source, timeoutMs = 4_000) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    // Custom schemes can fail without firing either handler, which would leave
    // the caller waiting forever; the timeout keeps sampling best-effort.
    const timer = setTimeout(() => reject(new Error("image load timed out")), timeoutMs);
    image.onload = () => {
      clearTimeout(timer);
      resolve(image);
    };
    image.onerror = () => {
      clearTimeout(timer);
      reject(new Error("image failed to load"));
    };
    image.src = source;
  });
}

function pickAccent(pixels) {
  let best = null;
  let bestScore = -1;
  for (let index = 0; index < pixels.length; index += 4) {
    const alpha = pixels[index + 3];
    if (alpha < 128) continue;
    const [red, green, blue] = [pixels[index], pixels[index + 1], pixels[index + 2]];
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    const saturation = max === 0 ? 0 : (max - min) / max;
    // Prefer colors that stay visible under white title text.
    const score = saturation * 1.4 + (255 - max) / 255;
    if (score > bestScore) {
      bestScore = score;
      best = [red, green, blue];
    }
  }
  return best;
}

export async function createTint(source) {
  if (typeof document === "undefined") return null;
  if (typeof source !== "string" || !source) return null;
  let image;
  try {
    image = await loadImage(source);
  } catch {
    return null;
  }
  if (!image.naturalWidth || !image.naturalHeight) return null;

  const canvas = document.createElement("canvas");
  canvas.width = BACKDROP_WIDTH;
  canvas.height = BACKDROP_HEIGHT;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) return null;
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  let pixels;
  try {
    pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  } catch {
    // A cross-origin picture taints the canvas; there is nothing to sample.
    return null;
  }

  let red = 0;
  let green = 0;
  let blue = 0;
  let counted = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index + 3] < 128) continue;
    red += pixels[index];
    green += pixels[index + 1];
    blue += pixels[index + 2];
    counted += 1;
  }
  if (!counted) return null;

  const accent = pickAccent(pixels);
  let backdrop = "";
  try {
    backdrop = canvas.toDataURL("image/png");
  } catch {
    backdrop = "";
  }

  return normalizeTint({
    average: `#${toHex(red / counted)}${toHex(green / counted)}${toHex(blue / counted)}`,
    accent: accent ? `#${toHex(accent[0])}${toHex(accent[1])}${toHex(accent[2])}` : "",
    backdrop,
  });
}

/// A readable darkening of the sampled color for text laid over a tint backdrop.
export function tintGradient(tint) {
  if (!tint?.average) return "";
  const accent = tint.accent || tint.average;
  return `linear-gradient(160deg, ${accent} 0%, ${tint.average} 100%)`;
}
