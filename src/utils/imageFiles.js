const IMAGE_MEDIA_TYPES = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  avif: "image/avif",
  bmp: "image/bmp",
  svg: "image/svg+xml",
};

export function mediaTypeFromFileName(fileName = "") {
  const extension = fileName.split(".").pop()?.toLowerCase() || "";
  return IMAGE_MEDIA_TYPES[extension] || "";
}

export function isSupportedImageFile(file) {
  if (!file) return false;
  if (file.type?.startsWith("image/")) return true;
  return Boolean(mediaTypeFromFileName(file.name));
}

export function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(reader.error || new Error("Failed to read the image file"));
    reader.readAsDataURL(file);
  });
}

export function dataUrlByteLength(dataUrl) {
  const encoded = dataUrl.split(",", 2)[1] || "";
  const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
  return Math.max(0, Math.floor((encoded.length * 3) / 4) - padding);
}

export async function sha256DataUrl(dataUrl) {
  const response = await fetch(dataUrl);
  const bytes = await response.arrayBuffer();
  if (!globalThis.crypto?.subtle) {
    throw new Error("SHA-256 is not available in this environment");
  }
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to decode the image"));
    image.src = dataUrl;
  });
}

export async function readImageDimensions(dataUrl) {
  const image = await loadImage(dataUrl);
  return {
    width: image.naturalWidth || image.width || 0,
    height: image.naturalHeight || image.height || 0,
  };
}

export async function createImageThumbnail(dataUrl, maxSize = 320) {
  try {
    const image = await loadImage(dataUrl);
    const width = image.naturalWidth || image.width || 0;
    const height = image.naturalHeight || image.height || 0;
    if (!width || !height) return "";
    const scale = Math.min(1, maxSize / Math.max(width, height));
    const targetWidth = Math.max(1, Math.round(width * scale));
    const targetHeight = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = targetWidth;
    canvas.height = targetHeight;
    const context = canvas.getContext("2d");
    if (!context) return "";
    context.drawImage(image, 0, 0, targetWidth, targetHeight);
    const webp = canvas.toDataURL("image/webp", 0.82);
    return webp.startsWith("data:image/webp") ? webp : canvas.toDataURL("image/png");
  } catch {
    return "";
  }
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)));
  const value = bytes / 1024 ** index;
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

export function formatDimensions(asset) {
  if (!asset?.width || !asset?.height) return "";
  return `${asset.width} × ${asset.height}`;
}

export function fileNameWithoutExtension(fileName = "") {
  const index = fileName.lastIndexOf(".");
  return index > 0 ? fileName.slice(0, index) : fileName;
}

export function extensionForMediaType(mediaType = "") {
  const entry = Object.entries(IMAGE_MEDIA_TYPES).find(([, type]) => type === mediaType.split(";")[0]);
  return entry?.[0] || "png";
}
