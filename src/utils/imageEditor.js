export const IMAGE_EDIT_RATIOS = [
  { id: "original", labelKey: "imageEditor.ratios.original" },
  { id: "1:1", labelKey: "imageEditor.ratios.square", value: 1 },
  { id: "4:5", labelKey: "imageEditor.ratios.portrait45", value: 4 / 5 },
  { id: "3:4", labelKey: "imageEditor.ratios.portrait34", value: 3 / 4 },
  { id: "16:9", labelKey: "imageEditor.ratios.wide", value: 16 / 9 },
];

export const IMAGE_FILTERS = [
  { id: "none", labelKey: "imageEditor.filters.none", css: "none" },
  { id: "warm", labelKey: "imageEditor.filters.warm", css: "sepia(0.18) saturate(1.12) brightness(1.03)" },
  { id: "cool", labelKey: "imageEditor.filters.cool", css: "saturate(0.96) hue-rotate(-8deg) brightness(1.02)" },
  { id: "mono", labelKey: "imageEditor.filters.mono", css: "grayscale(1) contrast(1.06)" },
  { id: "fade", labelKey: "imageEditor.filters.fade", css: "saturate(0.8) contrast(0.92) brightness(1.07)" },
  { id: "vivid", labelKey: "imageEditor.filters.vivid", css: "saturate(1.28) contrast(1.06)" },
];

export function getImageFilterCss(filterId) {
  return IMAGE_FILTERS.find((filter) => filter.id === filterId)?.css || "none";
}

export function getImageRatio(ratioId, width, height) {
  if (ratioId === "original" || !ratioId) return width / Math.max(1, height);
  return IMAGE_EDIT_RATIOS.find((ratio) => ratio.id === ratioId)?.value || width / Math.max(1, height);
}

function createCanvas(width, height) {
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

/**
 * Draws a rotated/flipped/cropped/filtered image. The same function powers the
 * preview and the saved asset so the result does not depend on CSS transforms.
 */
export function renderEditedImage(image, options = {}) {
  const {
    rotate = 0,
    flipX = false,
    flipY = false,
    ratio = "original",
    focal = { x: 0.5, y: 0.5 },
    filter = "none",
    maxSize = 2400,
  } = options;

  const naturalWidth = image.naturalWidth || image.width || 1;
  const naturalHeight = image.naturalHeight || image.height || 1;
  const normalizedRotate = ((Number(rotate) % 360) + 360) % 360;
  const rotatedWidth = normalizedRotate % 180 === 0 ? naturalWidth : naturalHeight;
  const rotatedHeight = normalizedRotate % 180 === 0 ? naturalHeight : naturalWidth;
  const scale = Math.min(1, 3200 / Math.max(rotatedWidth, rotatedHeight));
  const sourceWidth = Math.max(1, Math.round(rotatedWidth * scale));
  const sourceHeight = Math.max(1, Math.round(rotatedHeight * scale));

  const sourceCanvas = createCanvas(sourceWidth, sourceHeight);
  const sourceContext = sourceCanvas.getContext("2d");
  if (!sourceContext) return null;
  sourceContext.translate(sourceWidth / 2, sourceHeight / 2);
  sourceContext.rotate((normalizedRotate * Math.PI) / 180);
  sourceContext.scale(flipX ? -1 : 1, flipY ? -1 : 1);
  sourceContext.drawImage(
    image,
    (-naturalWidth * scale) / 2,
    (-naturalHeight * scale) / 2,
    naturalWidth * scale,
    naturalHeight * scale,
  );

  const targetRatio = getImageRatio(ratio, sourceWidth, sourceHeight);
  const sourceRatio = sourceWidth / sourceHeight;
  let cropWidth = sourceWidth;
  let cropHeight = sourceHeight;
  if (sourceRatio > targetRatio) {
    cropWidth = sourceHeight * targetRatio;
  } else {
    cropHeight = sourceWidth / targetRatio;
  }
  const focusX = Math.min(1, Math.max(0, Number(focal?.x ?? 0.5)));
  const focusY = Math.min(1, Math.max(0, Number(focal?.y ?? 0.5)));
  const cropX = Math.max(0, (sourceWidth - cropWidth) * focusX);
  const cropY = Math.max(0, (sourceHeight - cropHeight) * focusY);

  let outputWidth;
  let outputHeight;
  if (targetRatio >= 1) {
    outputWidth = maxSize;
    outputHeight = maxSize / targetRatio;
  } else {
    outputHeight = maxSize;
    outputWidth = maxSize * targetRatio;
  }
  const outputCanvas = createCanvas(outputWidth, outputHeight);
  const outputContext = outputCanvas.getContext("2d");
  if (!outputContext) return null;
  outputContext.imageSmoothingEnabled = true;
  outputContext.imageSmoothingQuality = "high";
  outputContext.filter = getImageFilterCss(filter);
  outputContext.drawImage(
    sourceCanvas,
    cropX,
    cropY,
    cropWidth,
    cropHeight,
    0,
    0,
    outputCanvas.width,
    outputCanvas.height,
  );
  return outputCanvas;
}

export function imageEditedDataUrl(image, options = {}) {
  const canvas = renderEditedImage(image, options);
  return canvas?.toDataURL("image/png") || "";
}
