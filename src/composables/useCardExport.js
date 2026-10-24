import { invoke } from "@tauri-apps/api/core";
import { getFontEmbedCSS, toCanvas } from "html-to-image";
import { jsPDF } from "jspdf";
import { createApp, nextTick, ref } from "vue";
import CardArtwork from "../components/preview/CardArtwork.vue";
import { renderMermaidDiagrams, renderEChartsDiagrams } from "./useContentParser.js";
import * as echarts from "echarts";
import { i18n } from "../i18n/index.js";

function t(key, params) {
  return i18n.global.t(key, params);
}

function isTauriRuntime() {
  return typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__);
}

export function useCardExport({
  activePageIndex,
  pages,
  sourcePath,
  selectedPlatform,
  exportMessage,
  isExporting,
  scale,
  selectedFormat,
  transparentBackground,
  backgroundColor,
  backgroundType,
  backgroundValue,
  selectedThemeClass,
  exportPath,
  showPageNumber,
  showTopLeft,
  showTopRight,
  showBottomLeft,
  showBottomRight,
  customFontFamily,
  customFontEmbedCss,
  assetLibrary,
}) {
  // Which export is running, so only the button that was clicked shows a
  // spinner instead of every export button lighting up together.
  const exportAction = ref("");

  async function exportDocument() {
    await nextTick();
    const allPages = pages?.value || [];
    if (!allPages.length) return;
    if (isExporting?.value) return;

    if (isExporting) isExporting.value = true;
    exportAction.value = "document";
    // Backstop: if some await inside the pipeline never settles, the spinner
    // must still stop and the user must learn why nothing was written.
    const watchdog = setTimeout(() => {
      if (isExporting?.value) {
        isExporting.value = false;
        exportAction.value = "";
        exportMessage.value = t("runtime.exportTimeout");
      }
    }, 180_000);

    try {
      const platform = selectedPlatform?.value || { width: 1080, height: 1440, name: "小红书" };
      const currentScale = scale?.value || 2;
      // Map scale (1/2/3) to JPEG quality (0.80/0.90/0.95)
      const jpegQuality = currentScale === 1 ? 0.80 : currentScale === 3 ? 0.95 : 0.90;
      const format = selectedFormat?.value || "PNG";
      // Always export all pages
      const scope = "all";
      const themeClass = selectedThemeClass?.value || "theme-swiss-grid";
      const isTransparent = transparentBackground?.value || false;
      const bgHex = backgroundColor?.value || "#69eacb";
      const bgType = backgroundType?.value || "gradient";
      const bgVal = backgroundValue?.value || "linear-gradient(135deg, #69eacb 0%, #eaccf8 48%, #6654f1 100%)";
      let targetFolder = exportPath?.value?.trim() || "";
      const isTopLeft = showTopLeft?.value ?? true;
      const isTopRight = showTopRight?.value ?? showPageNumber?.value ?? true;
      const isBottomLeft = showBottomLeft?.value ?? true;
      const isBottomRight = showBottomRight?.value ?? true;

      const pagesToExport = scope === "single"
        ? [allPages[activePageIndex.value] || allPages[0]]
        : allPages;

      if (!targetFolder && isTauriRuntime()) {
        exportMessage.value = t("runtime.chooseExportFolder");
        try {
          const selectedFolder = await invoke("pick_export_folder");
          if (!selectedFolder) {
            exportMessage.value = t("runtime.exportCancelled");
            return;
          }
          targetFolder = selectedFolder;
          if (exportPath) exportPath.value = selectedFolder;
        } catch (err) {
          exportMessage.value = t("runtime.folderFailed", { error: err?.message || err });
          return;
        }
      }

      const outputFolderName = createOutputFolderName(sourcePath?.value);

      exportMessage.value = t("runtime.preparingExport", { count: pagesToExport.length });

      try {
        if (format === "PDF") {
          await exportAsPDF(pagesToExport, platform, jpegQuality, themeClass, isTransparent, bgHex, bgType, bgVal, targetFolder, outputFolderName, isTopLeft, isTopRight, isBottomLeft, isBottomRight);
        } else if (format === "长图(PNG)") {
          await exportAsLongImage(pagesToExport, platform, jpegQuality, themeClass, isTransparent, bgHex, bgType, bgVal, targetFolder, outputFolderName, isTopLeft, isTopRight, isBottomLeft, isBottomRight);
        } else if (format === "JPG") {
          await exportAsImages(pagesToExport, platform, jpegQuality, themeClass, false, bgHex, bgType, bgVal, "jpg", targetFolder, outputFolderName, isTopLeft, isTopRight, isBottomLeft, isBottomRight);
        } else {
          await exportAsImages(pagesToExport, platform, jpegQuality, themeClass, isTransparent, bgHex, bgType, bgVal, "png", targetFolder, outputFolderName, isTopLeft, isTopRight, isBottomLeft, isBottomRight);
        }
      } catch (err) {
        console.error("Export error:", err);
        exportMessage.value = t("runtime.exportFailed", { error: err.message || err });
      }
    } finally {
      clearTimeout(watchdog);
      exportAction.value = "";
      if (isExporting) isExporting.value = false;
    }
  }

  async function saveOutputBlob(blob, filename, targetFolder, outputFolderName) {
    const base64Data = await blobToBase64(blob);
    if (!base64Data) {
      throw new Error(t("runtime.binaryFailed"));
    }

    if (!isTauriRuntime()) {
      downloadBlob(blob, filename);
      return null;
    }

    try {
      const savedPath = await invoke("save_export_file", {
        folderPath: targetFolder || "",
        subfolderName: outputFolderName,
        fileName: filename,
        base64Data,
      });
      if (savedPath) return savedPath;
    } catch (err) {
      throw new Error(t("runtime.writeFailed", { error: err?.message || err }));
    }

    throw new Error(t("runtime.writeFailed", { error: "No output path returned" }));
  }

  async function exportAsImages(pageList, platform, quality, themeClass, isTransparent, bgHex, bgType, bgVal, ext, targetFolder, outputFolderName, isTopLeft, isTopRight, isBottomLeft, isBottomRight) {
    let lastSavedPath = null;
    for (let i = 0; i < pageList.length; i++) {
      const page = pageList[i];
      const pageNum = pageList.length === 1 ? activePageIndex.value + 1 : i + 1;
      exportMessage.value = t("runtime.renderingPage", { current: i + 1, total: pageList.length });

      const canvas = await renderPageToCanvas(
        page,
        platform.width,
        platform.height,
        themeClass,
        isTransparent,
        bgHex,
        bgType,
        bgVal,
        ext,
        isTopLeft,
        isTopRight,
        isBottomLeft,
        isBottomRight,
        pageNum,
        pageList.length,
        customFontFamily?.value || "",
        customFontEmbedCss?.value || "",
      );

      if (!canvas) {
        throw new Error(t("runtime.renderFailed", { page: i + 1 }));
      }

      const mimeType = ext === "jpg" ? "image/jpeg" : "image/png";
      const blobQuality = ext === "jpg" ? quality : 1.0;
      const blob = await canvasToBlob(canvas, mimeType, blobQuality);
      if (!blob) {
        throw new Error(t("runtime.convertFailed", { format: ext.toUpperCase() }));
      }

      const filename = `markcard-page-${pageNum}.${ext}`;
      lastSavedPath = await saveOutputBlob(blob, filename, targetFolder, outputFolderName);
    }

    if (lastSavedPath) {
      exportMessage.value = t("runtime.exportedTo", { path: lastSavedPath });
    } else {
      exportMessage.value = pageList.length === 1
        ? t("runtime.exportedPage", { page: activePageIndex.value + 1, format: ext.toUpperCase() })
        : t("runtime.exportedImages", { count: pageList.length, format: ext.toUpperCase() });
    }
  }

  async function exportAsLongImage(pageList, platform, quality, themeClass, isTransparent, bgHex, bgType, bgVal, targetFolder, outputFolderName, isTopLeft, isTopRight, isBottomLeft, isBottomRight) {
    const canvases = [];

    for (let i = 0; i < pageList.length; i++) {
      exportMessage.value = t("runtime.stitchingPage", { current: i + 1, total: pageList.length });
      const canvas = await renderPageToCanvas(
        pageList[i],
        platform.width,
        platform.height,
        themeClass,
        isTransparent,
        bgHex,
        bgType,
        bgVal,
        "png",
        isTopLeft,
        isTopRight,
        isBottomLeft,
        isBottomRight,
        i + 1,
        pageList.length,
        customFontFamily?.value || "",
        customFontEmbedCss?.value || "",
      );
      if (!canvas) {
        throw new Error(t("runtime.renderFailed", { page: i + 1 }));
      }
      canvases.push(canvas);
    }

    if (!canvases.length) {
      throw new Error(t("runtime.longImageFailed"));
    }

    const singleW = canvases[0].width;
    const singleH = canvases[0].height;
    const totalH = singleH * canvases.length;

    const masterCanvas = document.createElement("canvas");
    masterCanvas.width = singleW;
    masterCanvas.height = totalH;
    const ctx = masterCanvas.getContext("2d");

    if (!ctx || masterCanvas.width !== singleW || masterCanvas.height !== totalH) {
      throw new Error(t("runtime.longImageFailed"));
    }

    if (!isTransparent) {
      ctx.fillStyle = bgHex;
      ctx.fillRect(0, 0, singleW, totalH);
    }

    for (let i = 0; i < canvases.length; i++) {
      ctx.drawImage(canvases[i], 0, i * singleH);
    }

    const blob = await canvasToBlob(masterCanvas, "image/png", 1.0);
    if (blob) {
      const filename = `markcard-long-image-${canvases.length}pages.png`;
      const savedPath = await saveOutputBlob(blob, filename, targetFolder, outputFolderName);
      if (savedPath) {
        exportMessage.value = t("runtime.longImageExported", { path: savedPath });
      } else {
        exportMessage.value = t("runtime.longImageComplete", { count: canvases.length });
      }
    }
  }

  async function exportAsPDF(pageList, platform, quality, themeClass, isTransparent, bgHex, bgType, bgVal, targetFolder, outputFolderName, isTopLeft, isTopRight, isBottomLeft, isBottomRight) {
    exportMessage.value = t("runtime.pdfPreparing", { count: pageList.length });

    const isLandscape = platform.width > platform.height;
    const doc = new jsPDF({
      orientation: isLandscape ? "landscape" : "portrait",
      unit: "px",
      format: [platform.width, platform.height],
    });

    for (let i = 0; i < pageList.length; i++) {
      exportMessage.value = t("runtime.pdfPage", { current: i + 1, total: pageList.length });
      const canvas = await renderPageToCanvas(
        pageList[i],
        platform.width,
        platform.height,
        themeClass,
        false,
        bgHex,
        bgType,
        bgVal,
        "png",
        isTopLeft,
        isTopRight,
        isBottomLeft,
        isBottomRight,
        i + 1,
        pageList.length,
        customFontFamily?.value || "",
        customFontEmbedCss?.value || "",
      );

      if (!canvas) {
        throw new Error(t("runtime.pdfFailed", { page: i + 1 }));
      }

      // Keep the cover lossless so decorative stickers survive the second
      // canvas-to-PDF conversion. Content pages remain JPEG-compressed to keep
      // multipage document sizes reasonable.
      const isCover = Boolean(pageList[i]?.cover);
      const imageFormat = isCover ? "PNG" : "JPEG";
      const imgData = canvas.toDataURL(isCover ? "image/png" : "image/jpeg", quality);
      if (i > 0) {
        doc.addPage([platform.width, platform.height], isLandscape ? "landscape" : "portrait");
      }
      doc.addImage(
        imgData,
        imageFormat,
        0,
        0,
        platform.width,
        platform.height,
        undefined,
        isCover ? "FAST" : undefined,
      );
    }

    const filename = `markcard-document-${pageList.length}pages.pdf`;
    const pdfArrayBuffer = doc.output("arraybuffer");
    const pdfBlob = new Blob([pdfArrayBuffer], { type: "application/pdf" });

    const savedPath = await saveOutputBlob(pdfBlob, filename, targetFolder, outputFolderName);
    if (savedPath) {
      exportMessage.value = t("runtime.pdfExported", { path: savedPath });
    } else {
      exportMessage.value = t("runtime.pdfComplete", { count: pageList.length });
    }
  }

  async function openOutputFolder(targetPath) {
    try {
      await invoke("open_export_folder", { path: targetPath || exportPath?.value || "" });
    } catch {
      // ignore fallback
    }
  }

  async function exportToAssetLibrary() {
    await nextTick();
    const allPages = pages?.value || [];
    if (!allPages.length || typeof assetLibrary?.importFromDataUrl !== "function") return;
    if (isExporting?.value) return;
    isExporting.value = true;
    exportAction.value = "library";
    const watchdog = setTimeout(() => {
      if (isExporting?.value) {
        isExporting.value = false;
        exportAction.value = "";
        exportMessage.value = t("runtime.exportTimeout");
      }
    }, 180_000);

    try {
      const platform = selectedPlatform?.value || { width: 1080, height: 1440 };
      const ext = selectedFormat?.value === "JPG" ? "jpg" : "png";
      const currentScale = scale?.value || 2;
      const jpegQuality = currentScale === 1 ? 0.8 : currentScale === 3 ? 0.95 : 0.9;
      const documentStem = createOutputFolderName(sourcePath?.value);
      let added = 0;
      let duplicates = 0;

      for (let i = 0; i < allPages.length; i += 1) {
        exportMessage.value = t("runtime.renderingPage", { current: i + 1, total: allPages.length });
        const { blob } = await renderPageToImage(allPages[i], {
          width: platform.width,
          height: platform.height,
          themeClass: selectedThemeClass?.value || "theme-swiss-grid",
          transparent: transparentBackground?.value || false,
          backgroundColor: backgroundColor?.value || "#69eacb",
          backgroundType: backgroundType?.value || "gradient",
          backgroundValue: backgroundValue?.value || "",
          format: ext === "jpg" ? "JPG" : "PNG",
          quality: jpegQuality,
          pageNumber: i + 1,
          totalPages: allPages.length,
          showTopLeft: showTopLeft?.value ?? true,
          showTopRight: showTopRight?.value ?? showPageNumber?.value ?? true,
          showBottomLeft: showBottomLeft?.value ?? true,
          showBottomRight: showBottomRight?.value ?? true,
          customFontFamily: customFontFamily?.value || "",
          customFontEmbedCss: customFontEmbedCss?.value || "",
        });

        const result = await assetLibrary.importFromDataUrl({
          dataUrl: await blobToDataUrl(blob),
          fileName: `${documentStem}-page-${String(i + 1).padStart(2, "0")}.${ext}`,
          mediaType: blob.type,
          sourceKind: "export",
        });
        if (result.duplicate) duplicates += 1;
        else added += 1;
      }

      exportMessage.value = t("runtime.libraryExported", { added, duplicates });
    } catch (err) {
      console.error("Library export error:", err);
      exportMessage.value = t("runtime.libraryExportFailed", { error: err?.message || err });
    } finally {
      clearTimeout(watchdog);
      exportAction.value = "";
      isExporting.value = false;
    }
  }

  return {
    exportCurrentPage: exportDocument,
    exportToAssetLibrary,
    exportAction,
    openOutputFolder,
  };
}

/**
 * Shared page renderer for consumers that need image bytes instead of files
 * (publish bundles). It must stay the only path from a page to an image so
 * preview, pagination and export keep matching.
 */
export async function renderPageToImage(page, options = {}) {
  const {
    width = 1080,
    height = 1440,
    themeClass = "theme-swiss-grid",
    transparent = false,
    backgroundColor = "#69eacb",
    backgroundType = "gradient",
    backgroundValue = "",
    format = "PNG",
    quality = 0.9,
    pageNumber = 1,
    totalPages = 1,
    showTopLeft = true,
    showTopRight = true,
    showBottomLeft = true,
    showBottomRight = true,
    customFontFamily = "",
    customFontEmbedCss = "",
  } = options;

  const ext = String(format).toUpperCase() === "JPG" ? "jpg" : "png";
  const canvas = await renderPageToCanvas(
    page,
    width,
    height,
    themeClass,
    transparent && ext !== "jpg",
    backgroundColor,
    backgroundType,
    backgroundValue,
    ext,
    showTopLeft,
    showTopRight,
    showBottomLeft,
    showBottomRight,
    pageNumber,
    totalPages,
    customFontFamily,
    customFontEmbedCss,
  );
  if (!canvas) {
    throw new Error(t("runtime.renderFailed", { page: pageNumber }));
  }

  const blob = await canvasToBlob(
    canvas,
    ext === "jpg" ? "image/jpeg" : "image/png",
    ext === "jpg" ? quality : 1.0,
  );
  if (!blob) {
    throw new Error(t("runtime.convertFailed", { format: ext.toUpperCase() }));
  }

  return { blob, width: canvas.width, height: canvas.height };
}

export function createOutputFolderName(markdownPath) {
  if (typeof markdownPath === "string" && markdownPath.trim()) {
    const normalizedPath = markdownPath.trim().replace(/\\/g, "/");
    const fileName = normalizedPath.split("/").pop() || "";
    const extensionIndex = fileName.lastIndexOf(".");
    const stem = extensionIndex > 0 ? fileName.slice(0, extensionIndex) : fileName;
    const safeStem = sanitizeFolderName(stem);
    if (safeStem) return safeStem;
  }

  const now = new Date();
  const date = [now.getFullYear(), now.getMonth() + 1, now.getDate()]
    .map((part) => String(part).padStart(2, "0"))
    .join("");
  const time = [now.getHours(), now.getMinutes(), now.getSeconds()]
    .map((part) => String(part).padStart(2, "0"))
    .join("");
  return `markcard-${date}-${time}`;
}

function sanitizeFolderName(name) {
  return String(name || "")
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-")
    .replace(/[. ]+$/g, "")
    .trim()
    .slice(0, 100);
}

// Offscreen DOM card renderer for high-res snapshot capture using html-to-image
// html-to-image resolves its image loads on requestAnimationFrame, and WebKit can
// leave Image.decode() pending for SVG data URLs. WebViews also pause rAF while
// occluded, so capture gets timer-backed shims for both; everything is restored
// afterwards.
async function toCanvasUnthrottled(node, options) {
  const originalFrame = window.requestAnimationFrame;
  const originalCancel = window.cancelAnimationFrame;
  const originalDecode = HTMLImageElement.prototype.decode;
  window.requestAnimationFrame = (callback) => window.setTimeout(() => callback(performance.now()), 0);
  window.cancelAnimationFrame = (id) => window.clearTimeout(id);
  HTMLImageElement.prototype.decode = function patchedDecode() {
    const source = this.currentSrc || this.src || "";
    if (/^data:image\/svg/i.test(source) || /\.svg(?:[?#]|$)/i.test(source)) {
      return Promise.resolve();
    }
    return withTimeout(
      Promise.resolve()
        .then(() => originalDecode.call(this))
        .catch(() => undefined),
      4_000,
      undefined,
    );
  };
  try {
    return await toCanvas(node, options);
  } finally {
    window.requestAnimationFrame = originalFrame;
    window.cancelAnimationFrame = originalCancel;
    HTMLImageElement.prototype.decode = originalDecode;
  }
}

async function renderPageToCanvas(page, width, height, themeClass, isTransparent, bgHex, bgType, bgVal, ext, isTopLeft = true, isTopRight = true, isBottomLeft = true, isBottomRight = true, pageNum = 1, totalPages = 1, customFontFamily = "", customFontEmbedCss = "") {
  // Render at a standard design viewport (450px wide portrait / 640px landscape)
  // then upscale via pixelRatio so the final canvas exactly matches the target platform size.
  // This avoids the "text looks tiny" problem (DOM rendered at 1080px with 16px fonts)
  // while also avoiding the "file too large" problem (double-scaling beyond platform size).
  const baseWidth = width > height ? 640 : 450;
  const baseHeight = Math.round(baseWidth * (height / width));
  // pixelRatio needed so html-to-image outputs exactly (width × height) pixels
  const renderPixelRatio = width / baseWidth;

  const container = document.createElement("div");
  // Position off-screen so the element renders (images load) but isn't visible to user.
  // Do NOT use opacity/visibility as they inherit to children and break html-to-image output.
  container.style.position = "fixed";
  container.style.left = "-99999px";
  container.style.top = "0";
  container.style.width = `${baseWidth}px`;
  container.style.height = `${baseHeight}px`;
  container.style.zIndex = "-9999";
  container.style.pointerEvents = "none";
  container.style.overflow = "hidden";
  document.body.appendChild(container);

  const exportApp = createApp(CardArtwork, {
    page,
    pageIndex: Math.max(0, pageNum - 1),
    pagesLength: totalPages,
    selectedPlatform: { width, height },
    selectedThemeClass: themeClass,
    transparentBackground: isTransparent && ext !== "jpg",
    backgroundColor: bgHex,
    backgroundType: bgType,
    backgroundValue: bgVal,
    showPageNumber: isTopRight,
    showTopLeft: isTopLeft,
    showTopRight: isTopRight,
    showBottomLeft: isBottomLeft,
    showBottomRight: isBottomRight,
    customFontFamily,
    autoPrepare: false,
  });
  exportApp.use(i18n);
  exportApp.mount(container);
  const posterNode = container.querySelector(".poster-canvas-frame");

  try {
    if (!posterNode) throw new Error(t("runtime.renderFailed", { page: pageNum }));
    if (page?.blocks?.some((block) => block?.oversize)) {
      throw new Error(t("runtime.renderFailed", { page: pageNum }));
    }
    await nextTick();
    await renderMermaidDiagrams(posterNode);
    await renderEChartsDiagrams(posterNode);
    if (document.fonts?.ready) {
      await withTimeout(document.fonts.ready, 3_000, null);
    }
    const discoveredFontCss = await rasterizeMathForExport(posterNode);
    const fontEmbedCSS = [discoveredFontCss, customFontEmbedCss]
      .filter(Boolean)
      .join("\n");
    await rasterizeMermaidForExport(
      posterNode,
      customFontFamily,
      customFontEmbedCss,
    );
    await rasterizeEChartsForExport(posterNode);
    await inlineImagesForExport(posterNode, renderPixelRatio);
    await inlineBackgroundImagesForExport(posterNode);
    await rasterizeCoverStickersForExport(posterNode);

    // Ensure all images (content images, stickers, math formula PNGs, mermaid diagrams)
    // are 100% loaded and decoded in bitmap memory before canvas capture
    const allImages = Array.from(posterNode.querySelectorAll("img"));
    const decodedImages = await Promise.all(
      allImages.map((img) =>
        // Stickers were just rasterized to data URLs; decoding them again only
        // adds WebKit stalls, and the capture loads them by itself.
        img.matches("img.cover-sticker, img.gallery-sticker")
          ? true
          : waitForImageDecode(img),
      ),
    );
    if (decodedImages.some((decoded) => !decoded)) {
      throw new Error(t("runtime.binaryFailed"));
    }

    const scrollArea = posterNode.querySelector(".card-scroll-area");
    if (!page?.gallery && !page?.coverDesign && scrollArea && scrollArea.scrollHeight > scrollArea.clientHeight + 1) {
      throw new Error(t("runtime.renderFailed", { page: pageNum }));
    }

    // Let the browser settle fonts, CSS, and GPU texture uploads (prevents first-export blank images)
    await new Promise((r) => setTimeout(r, 250));

    const captureOptions = {
      pixelRatio: renderPixelRatio,
      width: baseWidth,
      height: baseHeight,
      // html-to-image multiplies canvasWidth/canvasHeight by pixelRatio. The
      // previous values already included that ratio, producing 2592×3456 for
      // a requested 1080×1440 export.
      canvasWidth: baseWidth,
      canvasHeight: baseHeight,
      backgroundColor: (!isTransparent || ext === "jpg") ? (bgHex || "#69eacb") : null,
      cacheBust: false,
      skipFonts: false,
      preferredFontFormat: "woff2",
    };
    if (fontEmbedCSS) captureOptions.fontEmbedCSS = fontEmbedCSS;

    // WebKit does not reliably include ECharts data-URL images in the cloned
    // SVG. Keep their layout during capture, then composite their pixels once.
    const echartsImages = Array.from(posterNode.querySelectorAll("img.echarts-export-image"));
    const echartsImageOpacities = echartsImages.map((image) => image.style.opacity);
    echartsImages.forEach((image) => {
      image.style.opacity = "0";
    });

    let canvas = null;
    try {
      for (let attempt = 1; attempt <= 2; attempt += 1) {
        canvas = await toCanvasUnthrottled(posterNode, captureOptions);
        if (!page?.gallery?.src) break;
        // WebKit has been seen to drop the photo from a clone; retry once before
        // accepting an export that would reach the publisher as a blank card.
        if (!galleryPhotoMissingFrom(canvas, posterNode, captureOptions.backgroundColor)) break;
        if (attempt === 2) {
          console.warn("Gallery photo is missing from the export capture");
        } else {
          await new Promise((resolve) => setTimeout(resolve, 350));
        }
      }
    } finally {
      echartsImages.forEach((image, index) => {
        image.style.opacity = echartsImageOpacities[index];
      });
    }
    compositeContentImages(canvas, posterNode);
    compositeCoverStickers(canvas, posterNode);
    compositeEChartsImages(canvas, posterNode);
    exportApp.unmount();
    container.remove();
    return canvas;
  } catch (err) {
    console.error("html-to-image render error:", err);
    exportApp.unmount();
    container.remove();
    return null;
  }
}

/**
 * KaTeX relies on several custom web fonts. Nested font embedding inside the
 * final html-to-image capture is unreliable in WebViews, so formulas are
 * captured once at their rendered size and replaced by transparent PNGs.
 */
async function rasterizeMathForExport(root) {
  const formulaNodes = Array.from(root.querySelectorAll(".katex"));
  if (!formulaNodes.length) return null;

  let fontEmbedCSS = null;
  try {
    fontEmbedCSS = await getFontEmbedCSS(root, { preferredFontFormat: "woff2" });
  } catch (error) {
    console.warn("Failed to prepare KaTeX fonts for export", error);
  }

  for (const formulaNode of formulaNodes) {
    const rect = formulaNode.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;

    try {
      const width = Math.ceil(rect.width);
      const height = Math.ceil(rect.height);
      const options = {
        pixelRatio: 2,
        width,
        height,
        canvasWidth: width,
        canvasHeight: height,
        cacheBust: false,
        skipFonts: false,
        preferredFontFormat: "woff2",
      };
      if (fontEmbedCSS) options.fontEmbedCSS = fontEmbedCSS;

      const formulaCanvas = await toCanvasUnthrottled(formulaNode, options);
      const image = document.createElement("img");
      image.src = formulaCanvas.toDataURL("image/png");
      image.alt = t("content.math");
      image.className = "katex-export-image";
      image.width = width;
      image.height = height;
      image.style.width = `${width}px`;
      image.style.height = `${height}px`;
      formulaNode.replaceWith(image);
    } catch (error) {
      console.warn("Failed to rasterize KaTeX formula for export", error);
    }
  }

  return fontEmbedCSS;
}

/** Rasterize ECharts diagrams while DOM and canvas are fully initialized. */
async function rasterizeEChartsForExport(root) {
  const nodes = Array.from(root.querySelectorAll(".echarts-render-container"));
  for (const node of nodes) {
    const chart = echarts.getInstanceByDom(node) || node._echartsInstance;
    if (!chart) continue;

    try {
      chart.getZr?.()?.flush?.();

      const dataUrl = chart.getDataURL({
        type: "png",
        pixelRatio: 2,
        backgroundColor: "transparent",
        excludeComponents: ["toolbox"],
      });
      if (dataUrl) {
        const rect = node.getBoundingClientRect();
        const width = Math.ceil(rect.width) || node.clientWidth || 360;
        const height = Math.ceil(rect.height) || node.clientHeight || 160;
        const image = document.createElement("img");
        image.src = dataUrl;
        image.alt = "ECharts Diagram";
        image.className = "echarts-export-image";
        image.width = width;
        image.height = height;
        image.style.width = `${width}px`;
        image.style.height = `${height}px`;
        image.style.display = "block";
        image.style.objectFit = "contain";
        chart.dispose();
        node._echartsInstance = null;
        node.replaceWith(image);
      }
    } catch (error) {
      console.warn("Failed to rasterize ECharts diagram for export", error);
    }
  }
}

/** Rasterize Mermaid while it still has access to the live DOM font and color context. */
async function rasterizeMermaidForExport(root, customFontFamily, customFontEmbedCss) {
  const svgNodes = Array.from(root.querySelectorAll(".mermaid-raw-box svg"));
  for (const svgNode of svgNodes) {
    const rect = svgNode.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;

    const width = Math.ceil(rect.width);
    const height = Math.ceil(rect.height);
    await inlineMermaidSvgFallback(
      svgNode,
      width,
      height,
      customFontFamily,
      customFontEmbedCss,
    );
  }
}

function replaceMermaidWithImage(svgNode, source, width, height) {
  const image = document.createElement("img");
  image.src = source;
  image.alt = t("content.mermaid");
  image.className = "mermaid-export-image";
  image.width = width;
  image.height = height;
  image.style.width = `${width}px`;
  image.style.height = `${height}px`;
  svgNode.replaceWith(image);
}

async function inlineMermaidSvgFallback(
  svgNode,
  width,
  height,
  customFontFamily = "",
  customFontEmbedCss = "",
) {
  const clone = svgNode.cloneNode(true);
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(width));
  clone.setAttribute("height", String(height));

  if (customFontEmbedCss) {
    const styleEl = document.createElementNS("http://www.w3.org/2000/svg", "style");
    styleEl.textContent = customFontEmbedCss;
    clone.insertBefore(styleEl, clone.firstChild);
  }

  const sourceTextNodes = Array.from(svgNode.querySelectorAll("text, tspan, p, span, div, label"));
  const clonedTextNodes = Array.from(clone.querySelectorAll("text, tspan, p, span, div, label"));
  clonedTextNodes.forEach((node, index) => {
    const sourceNode = sourceTextNodes[index];
    if (!sourceNode) return;
    const computed = getComputedStyle(sourceNode);
    const family = customFontFamily
      ? `"${customFontFamily}", sans-serif`
      : computed.fontFamily || "sans-serif";
    node.style.setProperty("font-family", family, "important");
    node.style.fontSize = computed.fontSize;
    node.style.fontWeight = computed.fontWeight || "600";

    let fill = computed.fill;
    if (!fill || fill === "none" || fill === "rgba(0, 0, 0, 0)") {
      fill = computed.color && computed.color !== "rgba(0, 0, 0, 0)" ? computed.color : "#1e293b";
    }
    node.style.fill = fill;
    node.style.color = fill;
    node.setAttribute("fill", fill);
  });

  const serialized = new XMLSerializer().serializeToString(clone);
  const svgDataUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(serialized)}`;

  // Convert SVG Data URL to PNG Data URL so img.decode() in WebKit succeeds 100% without throwing exceptions
  const img = new Image();
  const pngDataUrl = await new Promise((resolve) => {
    img.onload = async () => {
      try {
        await img.decode().catch(() => undefined);
        await new Promise((resolveFrame) => requestAnimationFrame(resolveFrame));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, width * 2);
        canvas.height = Math.max(1, height * 2);
        const ctx = canvas.getContext("2d");
        if (ctx) {
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL("image/png"));
          return;
        }
      } catch (_) {}
      resolve(svgDataUrl);
    };
    img.onerror = () => resolve(svgDataUrl);
    img.src = svgDataUrl;
  });

  replaceMermaidWithImage(svgNode, pngDataUrl, width, height);
}

function convertImageElementToDataUrl(img) {
  try {
    const width = img.naturalWidth || img.width || 300;
    const height = img.naturalHeight || img.height || 200;
    if (width === 0 || height === 0) return null;

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;

    ctx.drawImage(img, 0, 0, width, height);
    return canvas.toDataURL("image/png");
  } catch (_) {
    return null;
  }
}

/**
 * Make every image a ready-to-render data URL before html-to-image clones the
 * export DOM. Local images are already data URLs, while remote/blob images are
 * fetched once here so the clone step does not depend on WebView networking.
 */
async function inlineImagesForExport(root, renderPixelRatio) {
  const imgEls = Array.from(root.querySelectorAll("img"));
  const results = await Promise.all(
    imgEls.map(async (img) => {
      const source = img.currentSrc || img.src;
      if (!source) return true;

      if (/^data:/i.test(img.src)) {
        img.srcset = "";
        const ready = await waitForImageDecode(img);
        if (!ready) return replaceFailedContentImage(img);

        // Large local files can make html-to-image's cloned SVG exceed WebView
        // limits even though the live preview can decode the original source.
        // Gallery cards are full-bleed photos, so they get the same treatment.
        const isGalleryPhoto = img.classList.contains("card-gallery__image");
        if (isGalleryPhoto) {
          const normalized = rasterizeContentImage(img, renderPixelRatio, { preferJpeg: true });
          if (normalized) {
            img.src = normalized;
            await waitForImageDecode(img);
          }
          if (img.complete && img.naturalWidth > 0) {
            return replaceGalleryImageWithBackground(img);
          }
          return false;
        }
        if (img.classList.contains("card-image") || img.classList.contains("card-inline-image")) {
          const normalized = rasterizeContentImage(img, renderPixelRatio);
          if (normalized) {
            img.src = normalized;
            const normalizedReady = await waitForImageDecode(img);
            return normalizedReady || replaceFailedContentImage(img);
          }
        }
        return true;
      }

      // Reuse pixels already decoded by the preview/export DOM when CORS allows it.
      let dataUrl = null;
      if (img.complete && img.naturalWidth > 0) {
        dataUrl = convertImageElementToDataUrl(img);
      }

      if (!dataUrl) {
        try {
          dataUrl = await loadImageSourceAsDataUrl(source);
        } catch (error) {
          console.warn(`Failed to inline image for export: ${source}`, error);
        }
      }

      if (dataUrl) {
        img.srcset = "";
        img.src = dataUrl;
        const ready = await waitForImageDecode(img);
        return ready || replaceFailedContentImage(img);
      }

      return replaceFailedContentImage(img);
    }),
  );

  if (results.some((ready) => !ready)) {
    throw new Error("One or more images could not be prepared for export");
  }
}

function replaceFailedContentImage(image) {
  if (!image.classList.contains("card-image") && !image.classList.contains("card-inline-image")) return false;

  const fallback = document.createElement(image.classList.contains("card-inline-image") ? "span" : "p");
  if (!image.classList.contains("card-inline-image")) fallback.className = "card-paragraph";
  fallback.textContent = image.getAttribute("data-original-markdown")
    || `![${image.alt || ""}](${image.getAttribute("src") || ""})`;
  const wrapper = image.closest(".card-image-wrap, .card-inline-image-wrap");
  (wrapper || image).replaceWith(fallback);
  return true;
}

function rasterizeContentImage(img, renderPixelRatio, { preferJpeg = false } = {}) {
  try {
    const naturalWidth = img.naturalWidth || 0;
    const naturalHeight = img.naturalHeight || 0;
    if (naturalWidth <= 0 || naturalHeight <= 0) return null;

    const rect = img.getBoundingClientRect();
    const targetScale = Math.max(1, Number(renderPixelRatio) || 1);
    const requestedWidth = rect.width > 0
      ? Math.ceil(rect.width * targetScale)
      : naturalWidth;
    const scale = Math.min(1, 4096 / naturalWidth, 4096 / naturalHeight, requestedWidth / naturalWidth);
    const width = Math.max(1, Math.round(naturalWidth * scale));
    const height = Math.max(1, Math.round(naturalHeight * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return null;
    context.drawImage(img, 0, 0, width, height);

    const sourceType = img.src.match(/^data:([^;,]+)/i)?.[1]?.toLowerCase() || "";
    // Photos are re-encoded as JPEG: a multi-megabyte PNG inside html-to-image's
    // cloned SVG is what WebKit silently drops, blanking the card.
    const opaque = preferJpeg && isOpaqueImage(img);
    const outputType =
      sourceType === "image/jpeg" || (preferJpeg && opaque) ? "image/jpeg" : "image/png";
    return canvas.toDataURL(outputType, outputType === "image/jpeg" ? 0.92 : undefined);
  } catch (error) {
    console.warn("Failed to normalize local image for export", error);
    return null;
  }
}

function isOpaqueImage(img) {
  try {
    const probe = document.createElement("canvas");
    probe.width = 16;
    probe.height = 16;
    const context = probe.getContext("2d", { willReadFrequently: true });
    if (!context) return false;
    context.drawImage(img, 0, 0, probe.width, probe.height);
    const pixels = context.getImageData(0, 0, probe.width, probe.height).data;
    for (let index = 3; index < pixels.length; index += 4) {
      if (pixels[index] < 250) return false;
    }
    return true;
  } catch {
    return false;
  }
}

function parseHexColor(value) {
  const match = String(value || "").trim().match(/^#([0-9a-f]{6})$/i);
  if (!match) return null;
  const hex = match[1];
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
  ];
}

/// True when the card area is (almost) entirely the capture background or the
/// neutral matte, which means the photo never made it into the capture.
function galleryPhotoMissingFrom(canvas, root, backgroundColor) {
  const figure = root.querySelector(".card-gallery");
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!figure || !context) return false;
  const rootRect = root.getBoundingClientRect();
  const rect = figure.getBoundingClientRect();
  if (rect.width < 8 || rect.height < 8 || rootRect.width <= 0 || rootRect.height <= 0) {
    return false;
  }
  const scaleX = canvas.width / rootRect.width;
  const scaleY = canvas.height / rootRect.height;
  const left = (rect.left - rootRect.left) * scaleX;
  const top = (rect.top - rootRect.top) * scaleY;
  const width = Math.max(1, rect.width * scaleX);
  const height = Math.max(1, rect.height * scaleY);
  const allowed = [parseHexColor(backgroundColor) || [105, 234, 202], [11, 18, 32]].filter(Boolean);

  const samples = 7;
  let blank = 0;
  let total = 0;
  for (let row = 0; row < samples; row += 1) {
    for (let column = 0; column < samples; column += 1) {
      const x = Math.min(canvas.width - 1, Math.round(left + ((column + 0.5) * width) / samples));
      const y = Math.min(canvas.height - 1, Math.round(top + ((row + 0.5) * height) / samples));
      if (x < 0 || y < 0) continue;
      const pixel = context.getImageData(x, y, 1, 1).data;
      total += 1;
      if (
        allowed.some(
          ([red, green, blue]) =>
            Math.abs(pixel[0] - red) <= 8 &&
            Math.abs(pixel[1] - green) <= 8 &&
            Math.abs(pixel[2] - blue) <= 8,
        )
      ) {
        blank += 1;
      }
    }
  }
  // Text and stickers occupy a small part of the card, so allow a few hits.
  return total > 0 && blank / total >= 0.85;
}

function compositeContentImages(canvas, root) {
  const context = canvas.getContext("2d");
  const rootRect = root.getBoundingClientRect();
  if (!context || rootRect.width <= 0 || rootRect.height <= 0) return;

  const scaleX = canvas.width / rootRect.width;
  const scaleY = canvas.height / rootRect.height;
  for (const image of root.querySelectorAll("img.card-image, img.card-inline-image")) {
    if (!image.complete || image.naturalWidth <= 0) continue;

    const rect = image.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    const x = (rect.left - rootRect.left) * scaleX;
    const y = (rect.top - rootRect.top) * scaleY;
    const width = rect.width * scaleX;
    const height = rect.height * scaleY;
    const radius = Math.min(8 * Math.min(scaleX, scaleY), width / 2, height / 2);
    const opacity = Number.parseFloat(getComputedStyle(image).opacity);

    context.save();
    context.globalAlpha = Number.isFinite(opacity) ? opacity : 1;
    roundedRectPath(context, x, y, width, height, radius);
    context.clip();
    context.drawImage(image, x, y, width, height);
    context.restore();
  }
}

/// WebKit's foreignObject rendering drops gallery photos: they are absolutely
/// positioned, full-bleed, object-fit images. Swapping the element for the same
/// box painted as a CSS background keeps the title, shade, and stickers above it.
function replaceGalleryImageWithBackground(img) {
  const wrapper = document.createElement("div");
  wrapper.className = img.className;
  wrapper.style.backgroundImage = `url("${img.src}")`;
  wrapper.style.backgroundSize = img.closest(".card-gallery--contain") ? "contain" : "cover";
  wrapper.style.backgroundPosition = "center";
  wrapper.style.backgroundRepeat = "no-repeat";
  img.replaceWith(wrapper);
  return true;
}

function compositeCoverStickers(canvas, root) {
  const context = canvas.getContext("2d");
  const rootRect = root.getBoundingClientRect();
  if (!context || rootRect.width <= 0 || rootRect.height <= 0) return;

  const scaleX = canvas.width / rootRect.width;
  const scaleY = canvas.height / rootRect.height;
  for (const sticker of root.querySelectorAll("img.cover-sticker, img.gallery-sticker")) {
    if (!sticker.complete || sticker.naturalWidth <= 0) continue;

    const rect = sticker.getBoundingClientRect();
    const boxWidth = sticker.offsetWidth;
    const boxHeight = sticker.offsetHeight;
    if (rect.width <= 0 || rect.height <= 0 || boxWidth <= 0 || boxHeight <= 0) continue;

    const computed = getComputedStyle(sticker);
    const borderLeft = Number.parseFloat(computed.borderLeftWidth) || 0;
    const borderRight = Number.parseFloat(computed.borderRightWidth) || 0;
    const borderTop = Number.parseFloat(computed.borderTopWidth) || 0;
    const borderBottom = Number.parseFloat(computed.borderBottomWidth) || 0;
    const paddingLeft = Number.parseFloat(computed.paddingLeft) || 0;
    const paddingRight = Number.parseFloat(computed.paddingRight) || 0;
    const paddingTop = Number.parseFloat(computed.paddingTop) || 0;
    const paddingBottom = Number.parseFloat(computed.paddingBottom) || 0;
    const contentWidth = Math.max(
      1,
      boxWidth - borderLeft - borderRight - paddingLeft - paddingRight,
    );
    const contentHeight = Math.max(
      1,
      boxHeight - borderTop - borderBottom - paddingTop - paddingBottom,
    );
    const sourceRatio = sticker.naturalWidth / sticker.naturalHeight;
    const contentRatio = contentWidth / contentHeight;
    const drawWidth = sourceRatio > contentRatio
      ? contentWidth
      : contentHeight * sourceRatio;
    const drawHeight = sourceRatio > contentRatio
      ? contentWidth / sourceRatio
      : contentHeight;
    const drawX = -boxWidth / 2
      + borderLeft
      + paddingLeft
      + (contentWidth - drawWidth) / 2;
    const drawY = -boxHeight / 2
      + borderTop
      + paddingTop
      + (contentHeight - drawHeight) / 2;

    let transform = null;
    try {
      if (computed.transform && computed.transform !== "none") {
        transform = new DOMMatrixReadOnly(computed.transform);
      }
    } catch {
      transform = null;
    }

    context.save();
    context.scale(scaleX, scaleY);
    context.translate(
      rect.left - rootRect.left + rect.width / 2,
      rect.top - rootRect.top + rect.height / 2,
    );
    if (transform) {
      context.rotate(Math.atan2(transform.b, transform.a));
      context.scale(
        Math.hypot(transform.a, transform.b) || 1,
        Math.hypot(transform.c, transform.d) || 1,
      );
    }
    const opacity = Number.parseFloat(computed.opacity);
    context.globalAlpha = Number.isFinite(opacity) ? opacity : 1;
    if (computed.filter && computed.filter !== "none") {
      context.filter = computed.filter;
    }
    context.drawImage(sticker, drawX, drawY, drawWidth, drawHeight);
    context.restore();
  }
}

function compositeEChartsImages(canvas, root) {
  const context = canvas.getContext("2d");
  const rootRect = root.getBoundingClientRect();
  if (!context || rootRect.width <= 0 || rootRect.height <= 0) return;

  const scaleX = canvas.width / rootRect.width;
  const scaleY = canvas.height / rootRect.height;
  for (const image of root.querySelectorAll("img.echarts-export-image")) {
    if (!image.complete || image.naturalWidth <= 0) continue;

    const rect = image.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    const x = (rect.left - rootRect.left) * scaleX;
    const y = (rect.top - rootRect.top) * scaleY;
    const width = rect.width * scaleX;
    const height = rect.height * scaleY;

    context.save();
    context.drawImage(image, x, y, width, height);
    context.restore();
  }
}

function roundedRectPath(context, x, y, width, height, radius) {
  context.beginPath();
  context.moveTo(x + radius, y);
  context.lineTo(x + width - radius, y);
  context.arcTo(x + width, y, x + width, y + radius, radius);
  context.lineTo(x + width, y + height - radius);
  context.arcTo(x + width, y + height, x + width - radius, y + height, radius);
  context.lineTo(x + radius, y + height);
  context.arcTo(x, y + height, x, y + height - radius, radius);
  context.lineTo(x, y + radius);
  context.arcTo(x, y, x + radius, y, radius);
  context.closePath();
}

async function inlineBackgroundImagesForExport(root) {
  const elements = [root, ...root.querySelectorAll("*")];
  const candidates = elements
    .map((element) => ({
      element,
      source: extractCssUrl(element.style.backgroundImage),
    }))
    .filter(({ source }) => source && !/^data:/i.test(source));

  for (const { element, source } of candidates) {
    try {
      const dataUrl = await loadImageSourceAsDataUrl(source);
      const probe = new Image();
      probe.src = dataUrl;
      if (!await waitForImageDecode(probe)) {
        throw new Error("Decoded background image is empty");
      }
      element.style.backgroundImage = `url("${dataUrl}")`;
    } catch (error) {
      console.warn(`Failed to inline background image for export: ${source}`, error);
      throw new Error("A background image could not be prepared for export");
    }
  }
}

function extractCssUrl(backgroundImage) {
  const match = String(backgroundImage || "").trim().match(/^url\((.*)\)$/i);
  if (!match) return "";
  return match[1].trim().replace(/^(["'])(.*)\1$/, "$2");
}

async function loadImageSourceAsDataUrl(source) {
  const absoluteUrl = new URL(source, window.location.href).href;
  const controller = new AbortController();
  // A stalled request would otherwise keep the export spinner alive forever.
  const timer = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetch(absoluteUrl, {
      cache: "force-cache",
      mode: "cors",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const blob = await response.blob();
    if (blob.type && !blob.type.startsWith("image/")) {
      throw new Error(`Unexpected content type: ${blob.type}`);
    }
    return await blobToDataUrl(blob);
  } catch (browserError) {
    if (!isTauriRuntime() || !/^https?:/i.test(absoluteUrl)) throw browserError;

    const resolved = await invoke("resolve_remote_image", { url: absoluteUrl });
    if (!resolved?.dataUrl) throw browserError;
    return resolved.dataUrl;
  } finally {
    clearTimeout(timer);
  }
}

/** Replace cover SVG sources with PNG data before the final DOM capture. */
async function rasterizeCoverStickersForExport(root) {
  const stickers = Array.from(root.querySelectorAll("img.cover-sticker, img.gallery-sticker"));

  for (const sticker of stickers) {
    try {
      await waitForImageDecode(sticker);

      const canvas = document.createElement("canvas");
      canvas.width = 384;
      canvas.height = 384;
      const context = canvas.getContext("2d");
      if (context) {
        context.drawImage(sticker, 0, 0, 384, 384);
        const dataUrl = canvas.toDataURL("image/png");
        if (dataUrl) {
          // The raster is generated synchronously, so there is nothing to wait
          // for here; html-to-image loads the data URL itself during capture.
          sticker.srcset = "";
          sticker.src = dataUrl;
        }
      }
    } catch (error) {
      // Keep the already-inlined SVG as a fallback for image export.
      console.warn("Failed to rasterize cover sticker for export", error);
    }
  }
}

// WebKit's decode() can stay pending for a corrupt or oversized image, so every
// decode in the export path is raced against a timeout; a miss simply falls back
// to the already-available intrinsic size.
function withTimeout(promise, ms, fallback) {
  return Promise.race([
    promise,
    new Promise((resolve) => setTimeout(() => resolve(fallback), ms)),
  ]);
}

function isVectorImage(img) {
  const source = img?.currentSrc || img?.src || "";
  return /^data:image\/svg/i.test(source) || /\.svg(?:[?#]|$)/i.test(source);
}

function decodeImage(img) {
  // WebKit can leave decode() pending forever on SVG sources (OpenMoji stickers
  // are SVG), so vectors rely on the intrinsic size instead of a decode round.
  if (typeof img.decode !== "function" || isVectorImage(img)) {
    return Promise.resolve(img.complete && img.naturalWidth > 0);
  }
  return withTimeout(
    img.decode()
      .then(() => true)
      .catch(() => img.complete && img.naturalWidth > 0),
    4_000,
    img.complete && img.naturalWidth > 0,
  );
}

function waitForImageDecode(img) {
  if (!img) return Promise.resolve(false);

  if (img.complete) {
    if (img.naturalWidth <= 0) return Promise.resolve(false);
    return decodeImage(img);
  }

  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      img.removeEventListener("load", finish);
      img.removeEventListener("error", finish);
      resolve(img.complete && img.naturalWidth > 0);
    };

    if (img.complete) {
      finish();
    } else {
      img.addEventListener("load", finish);
      img.addEventListener("error", finish);
      setTimeout(finish, 3000);
    }
  }).then((loaded) => (loaded ? decodeImage(img) : false));
}

export function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === "string" && reader.result) {
        resolve(reader.result);
      } else {
        reject(new Error("Image data is empty"));
      }
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function parseLine(line) {
  const trimmed = line.trim();
  if (trimmed.startsWith("> ")) {
    return { type: "quote", content: formatRichText(trimmed.slice(2)) };
  }
  if (/^[-*]\s+/.test(trimmed)) {
    return { type: "list", content: formatRichText(trimmed.replace(/^[-*]\s+/, "")) };
  }
  if (/^\d+\.\s+/.test(trimmed)) {
    const num = trimmed.match(/^(\d+)\.\s+/)[1];
    return { type: "ordered-list", num, content: formatRichText(trimmed.replace(/^\d+\.\s+/, "")) };
  }
  return { type: "paragraph", content: formatRichText(trimmed) };
}

function formatRichText(text) {
  if (!text) return "";
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  html = html.replace(/\*\*(.*?)\*\*/g, "<strong class='font-bold'>$1</strong>");
  html = html.replace(/`([^`]+)`/g, "<code class='rounded bg-amber-100/70 dark:bg-amber-950/70 px-1.5 py-0.5 text-xs text-amber-900 dark:text-amber-200 font-mono'>$1</code>");
  html = html.replace(/\*([^*]+)\*/g, "<em class='italic'>$1</em>");
  html = html.replace(/==([^=]+)==/g, "<mark class='bg-amber-200/90 dark:bg-amber-800/70 px-1 rounded'>$1</mark>");

  return html;
}

export function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const dataUrl = reader.result;
      if (!dataUrl) {
        reject(new Error("FileReader result is empty"));
        return;
      }
      const base64 = dataUrl.split(",")[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function canvasToBlob(canvas, mimeType, quality = 0.92) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), mimeType, quality);
  });
}

export function downloadBlob(blob, filename) {
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
