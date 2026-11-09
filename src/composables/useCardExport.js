import { invoke } from "@tauri-apps/api/core";
import { getFontEmbedCSS, toCanvas } from "html-to-image";
import { jsPDF } from "jspdf";
import { createApp, nextTick, ref } from "vue";
import CardArtwork from "../components/preview/CardArtwork.vue";
import { findSceneTemplate, scenePageSize } from "../config/sceneMockups.js";
import { resolveSceneQuad } from "../storage/sceneMockupTemplates.js";
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
  ensurePagesReady,
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
      // The top-right slot renders the page number only, so hiding page numbers
      // has to blank it here too — otherwise preview and export disagree.
      const isTopRight = (showTopRight?.value ?? true) && (showPageNumber?.value ?? true);
      const isBottomLeft = showBottomLeft?.value ?? true;
      const isBottomRight = showBottomRight?.value ?? true;

      let pagesToExport = scope === "single"
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
        await ensurePagesReady?.();
        // Readiness replaces the page array (measured pagination, gallery scene
        // composites), so the export list is re-read from the live ref here.
        const readyPages = pages?.value || [];
        if (readyPages.length) {
          pagesToExport = scope === "single"
            ? [readyPages[activePageIndex.value] || readyPages[0]]
            : readyPages;
        }
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

      // Each page is its own file here, so a scene page keeps the larger canvas
      // that preserves the warped card's detail. PDF and the stitched long image
      // stay on the platform canvas, because their pages must share one size.
      const pageCanvas = page?.gallery?.sceneBackdrop
        ? scenePageCanvas(page, platform.width, platform.height)
        : platform;
      const canvas = await renderPageToCanvas(
        page,
        pageCanvas.width,
        pageCanvas.height,
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
    // The per-page canvases are full resolution and no longer needed; releasing
    // them keeps a tall stitched image from doubling peak memory.
    canvases.forEach((pageCanvas) => {
      pageCanvas.width = 0;
      pageCanvas.height = 0;
    });

    const blob = await canvasToBlob(masterCanvas, "image/png", 1.0);
    if (!blob) {
      // A null blob means the stitched canvas exceeded what this WebView can
      // encode; staying silent left the spinner running with no file written.
      throw new Error(t("runtime.longImageFailed"));
    }
    const filename = `markcard-long-image-${canvases.length}pages.png`;
    const savedPath = await saveOutputBlob(blob, filename, targetFolder, outputFolderName);
    if (savedPath) {
      exportMessage.value = t("runtime.longImageExported", { path: savedPath });
    } else {
      exportMessage.value = t("runtime.longImageComplete", { count: canvases.length });
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

      exportMessage.value = t("runtime.preparingExport", { count: allPages.length });
      await ensurePagesReady?.();
      // Readiness can replace the page array; export the live one, not the
      // pre-ready snapshot taken before the await.
      const exportPages = pages?.value?.length ? pages.value : allPages;

      for (let i = 0; i < exportPages.length; i += 1) {
        exportMessage.value = t("runtime.renderingPage", { current: i + 1, total: exportPages.length });
        const { blob } = await renderPageToImage(exportPages[i], {
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
          totalPages: exportPages.length,
          showTopLeft: showTopLeft?.value ?? true,
          showTopRight: showTopRight?.value ?? true,
          showPageNumber: showPageNumber?.value ?? true,
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
function scenePageCanvas(page, width, height) {
  const sceneId = page?.gallery?.sceneId;
  const scene = findSceneTemplate(sceneId);
  // The backdrop was composited through this image's own corners, so the canvas
  // has to be sized from the same resolved quad — the shipped template quad would
  // put the page on a different scale than the blob it is painted onto.
  const quad = resolveSceneQuad(sceneId, page?.gallery?.imageId) || scene?.quad;
  return scenePageSize(width, height, quad, width);
}

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
    showPageNumber = showTopRight,
    showBottomLeft = true,
    showBottomRight = true,
    customFontFamily = "",
    customFontEmbedCss = "",
  } = options;

  const ext = String(format).toUpperCase() === "JPG" ? "jpg" : "png";
  // A scene page is a photo with the card warped into the calibrated quad: at the
  // platform canvas the card loses most of its detail, so the page is rendered on
  // the quad-derived canvas instead.
  const target = page?.gallery?.sceneBackdrop
    ? scenePageCanvas(page, width, height)
    : { width, height };
  const canvas = await renderPageToCanvas(
    page,
    target.width,
    target.height,
    themeClass,
    transparent && ext !== "jpg",
    backgroundColor,
    backgroundType,
    backgroundValue,
    ext,
    showTopLeft,
    showTopRight && showPageNumber,
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
// occluded, so capture gets a timer-backed shim for both; everything is restored
// afterwards.
// Captures can overlap (scan-to-preview, publish bundle, a second export), and
// the patch is global. Only the first caller installs it and only the last one
// restores, otherwise a nested call restores a stale capture and leaves the
// whole app running on the setTimeout shim.
//
// The frame shim waits for a real animation frame and only falls back to a timer
// when the WebView stays paused. Replacing rAF with setTimeout outright was the
// reason a capture occasionally came back as nothing but the background colour:
// html-to-image draws its serialized SVG on the frame after load, and WebKit does
// not rasterize that <img> until it has been painted once. A timer is not a paint,
// so drawImage copied an empty raster and the bundle shipped a flat 1080x1440
// JPEG that still passed every size check.
const FRAME_FALLBACK_MS = 64;
let unthrottleDepth = 0;
let unthrottleOriginals = null;
let unthrottleFrames = null;

async function toCanvasUnthrottled(node, options) {
  if (unthrottleDepth === 0) {
    unthrottleOriginals = {
      frame: window.requestAnimationFrame,
      cancel: window.cancelAnimationFrame,
      decode: HTMLImageElement.prototype.decode,
    };
    const originalFrame = unthrottleOriginals.frame;
    const originalCancel = unthrottleOriginals.cancel;
    const originalDecode = unthrottleOriginals.decode;
    const frames = new Map();
    unthrottleFrames = frames;
    window.requestAnimationFrame = (callback) => {
      const state = { id: 0, timer: 0, done: false };
      const fire = () => {
        if (state.done) return;
        state.done = true;
        window.clearTimeout(state.timer);
        frames.delete(state.id);
        callback(performance.now());
      };
      state.id = originalFrame(fire);
      state.timer = window.setTimeout(fire, FRAME_FALLBACK_MS);
      frames.set(state.id, state);
      return state.id;
    };
    window.cancelAnimationFrame = (id) => {
      const state = frames.get(id);
      if (state) {
        state.done = true;
        window.clearTimeout(state.timer);
        frames.delete(id);
      }
      originalCancel(id);
    };
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
  }

  unthrottleDepth += 1;
  try {
    return await toCanvas(node, options);
  } finally {
    unthrottleDepth -= 1;
    if (unthrottleDepth === 0 && unthrottleOriginals) {
      for (const state of unthrottleFrames?.values() || []) {
        state.done = true;
        window.clearTimeout(state.timer);
      }
      unthrottleFrames?.clear?.();
      unthrottleFrames = null;
      window.requestAnimationFrame = unthrottleOriginals.frame;
      window.cancelAnimationFrame = unthrottleOriginals.cancel;
      HTMLImageElement.prototype.decode = unthrottleOriginals.decode;
      unthrottleOriginals = null;
    }
  }
}

/**
 * Waits for a real paint before a capture is retried. A card that came back blank
 * is usually a raster that was not ready yet, so the retry has to land after a
 * frame the WebView actually rendered — with a timer backstop, because an
 * occluded window never fires one.
 */
function waitForPaint(ms) {
  // A window that is hidden or minimized paints nothing at all, so it gets the
  // longer wait: the retry only has a chance once the frame flow resumes.
  const delay = document.visibilityState === "visible" ? ms : Math.max(ms, 1_200);
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      resolve();
    };
    window.setTimeout(finish, delay);
    window.requestAnimationFrame(() => window.setTimeout(finish, 0));
  });
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
    // The gallery photo is the one image large enough for WebKit to drop out of
    // html-to-image's clone, so no gallery photo enters the clone at all: it is
    // lifted out here and painted onto the capture canvas afterwards, under a
    // chrome-only pass that keeps the shade, type, and stickers on top of it.
    const photoLayer = shouldLiftGalleryPhoto(page)
      ? await liftGalleryPhotoForCapture(posterNode, Boolean(page.gallery.sceneBackdrop))
      : null;
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

    const opaqueBackground = (!isTransparent || ext === "jpg") ? (bgHex || "#69eacb") : null;
    const captureOptions = {
      pixelRatio: renderPixelRatio,
      width: baseWidth,
      height: baseHeight,
      // html-to-image multiplies canvasWidth/canvasHeight by pixelRatio. The
      // previous values already included that ratio, producing 2592×3456 for
      // a requested 1080×1440 export.
      canvasWidth: baseWidth,
      canvasHeight: baseHeight,
      // A scene page composes its own background: the photo is painted under the
      // chrome capture, so that pass has to stay transparent.
      backgroundColor: photoLayer ? null : opaqueBackground,
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

    // Decorations are flattened by hand after the capture: WebKit's foreignObject
    // does not reliably paint this absolutely positioned layer.
    const overlayLayer = posterNode.querySelector(".gallery-overlay");
    if (overlayLayer) overlayLayer.style.visibility = "hidden";

    let canvas = null;
    try {
      // With the photo lifted out there is nothing left for the blank-card retry
      // to look for, so the chrome pass is a single capture.
      canvas = photoLayer
        ? await toCanvasUnthrottled(posterNode, captureOptions)
        : await capturePage(posterNode, captureOptions, page, pageNum);
    } finally {
      echartsImages.forEach((image, index) => {
        image.style.opacity = echartsImageOpacities[index];
      });
      if (overlayLayer) overlayLayer.style.visibility = "";
    }
    if (photoLayer && canvas) {
      // A chrome pass that came back as one flat colour never reached the canvas,
      // and compositing the photo under it would publish a card with no type. One
      // retry after a real paint; a still-empty pass falls into the cloned-photo
      // branch below, which paints the photo and the chrome in a single capture.
      if (captureIsBlank(canvas, posterNode)) {
        await waitForPaint(350);
        canvas = await toCanvasUnthrottled(posterNode, captureOptions);
      }
      if (!captureIsBlank(canvas, posterNode) && sceneChromeIsTransparent(canvas, photoLayer)) {
        canvas = composeScenePhotoCapture(canvas, photoLayer);
      } else {
        // Something below the photo still painted opaque, so the photo would be
        // buried under it. Put the page back the way it was and take the old
        // single-pass capture rather than ship a blank card.
        restoreGalleryPhotoForCapture(photoLayer);
        const image = posterNode.querySelector("img.card-gallery__image");
        if (image) await prepareGalleryPhotoForExport(image, renderPixelRatio);
        canvas = await capturePage(
          posterNode,
          { ...captureOptions, backgroundColor: opaqueBackground },
          page,
          pageNum,
        );
      }
    }
    compositeContentImages(canvas, posterNode);
    compositeCoverStickers(canvas, posterNode);
    compositeGalleryOverlayText(canvas, posterNode);
    compositeEChartsImages(canvas, posterNode);
    exportApp.unmount();
    container.remove();
    return canvas;
  } catch (err) {
    console.error("html-to-image render error:", err);
    exportApp.unmount();
    container.remove();
    // The inner throws already carry a localized, specific reason (oversize
    // block, unreadable image, missing remote asset). Swallowing them into null
    // left every caller reporting only "page N failed" with no way to tell a
    // 404 from a CORS block.
    throw err instanceof Error ? err : new Error(String(err));
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

async function prepareGalleryPhotoForExport(img, renderPixelRatio) {
  // The scene composite is already a high-quality JPEG and this is the last
  // generation before the page leaves the app, so keep it near lossless.
  // Only a `cover` photo is height-driven and needs cover resolution; a `contain`
  // photo letterboxes, so width-based sizing already supplies what is displayed.
  // Feeding cover resolution to a contain photo just bloats its JPEG toward the
  // size WebKit drops from the clone, with no clarity gain.
  const isContain = Boolean(img.closest(".card-gallery--contain"));
  const normalized = rasterizeContentImage(img, renderPixelRatio, {
    preferJpeg: true,
    quality: 0.97,
    coverFit: !isContain,
  });
  if (normalized) {
    img.srcset = "";
    img.src = normalized;
    await waitForImageDecode(img);
  }
  if (img.complete && img.naturalWidth > 0) {
    return replaceGalleryImageWithBackground(img);
  }
  return false;
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
        if (img.classList.contains("card-gallery__image")) {
          return prepareGalleryPhotoForExport(img, renderPixelRatio);
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
        // Scene backdrops reach the exporter as blob URLs, so they take this
        // path instead of the data-URL branch above.
        if (img.classList.contains("card-gallery__image")) {
          return prepareGalleryPhotoForExport(img, renderPixelRatio);
        }
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

function rasterizeContentImage(img, renderPixelRatio, { preferJpeg = false, quality = 0.95, coverFit = false } = {}) {
  try {
    const naturalWidth = img.naturalWidth || 0;
    const naturalHeight = img.naturalHeight || 0;
    if (naturalWidth <= 0 || naturalHeight <= 0) return null;

    const rect = img.getBoundingClientRect();
    const targetScale = Math.max(1, Number(renderPixelRatio) || 1);
    // A cover-cropped photo is scaled by max(rect.w/nat.w, rect.h/nat.h), so when
    // its aspect differs from the card's the crop is driven by height, not width.
    // Sizing the raster from width alone would hand html-to-image a low-res image
    // that it then upscales, softening the embedded photo. Match the cover scale.
    const coverWidth = coverFit && rect.height > 0
      ? Math.max(rect.width, rect.height * (naturalWidth / naturalHeight))
      : rect.width;
    const requestedWidth = coverWidth > 0
      ? Math.ceil(coverWidth * targetScale)
      : naturalWidth;
    const scale = Math.min(1, 4096 / naturalWidth, 4096 / naturalHeight, requestedWidth / naturalWidth);
    const width = Math.max(1, Math.round(naturalWidth * scale));
    const height = Math.max(1, Math.round(naturalHeight * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return null;
    // Downsampling a photo from native size to the card box uses the browser's
    // default "low" smoothing, which aliases fine detail and thins CJK strokes.
    // "high" applies a box/area filter that keeps the embedded photo legible,
    // which is the whole point of a content-first gallery card.
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = "high";
    context.drawImage(img, 0, 0, width, height);

    const sourceType = img.src.match(/^data:([^;,]+)/i)?.[1]?.toLowerCase() || "";
    // Photos are re-encoded as JPEG: a multi-megabyte PNG inside html-to-image's
    // cloned SVG is what WebKit silently drops, blanking the card. This is the
    // only lossy generation a gallery photo gets, so it stays high enough to
    // keep warped scene-mockup type from breaking up.
    const opaque = preferJpeg && isOpaqueImage(img);
    const outputType =
      sourceType === "image/jpeg" || (preferJpeg && opaque) ? "image/jpeg" : "image/png";
    return canvas.toDataURL(outputType, outputType === "image/jpeg" ? quality : undefined);
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
  try {
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
  } catch {
    // A tainted canvas cannot be sampled; let the capture stand as-is.
    return false;
  }
  // Text and stickers occupy a small part of the card, so allow a few hits.
  return total > 0 && blank / total >= 0.85;
}

/// Flattens the free-text decorations onto the captured card. The DOM layer is
/// hidden during capture, so this is the only place those texts are painted —
/// wrapping, alignment, rotation, and the shadow mirror `card-gallery.css`.
function compositeGalleryOverlayText(canvas, root) {
  const context = canvas.getContext("2d");
  const rootRect = root.getBoundingClientRect();
  if (!context || rootRect.width <= 0 || rootRect.height <= 0) return;
  const scaleX = canvas.width / rootRect.width;
  const scaleY = canvas.height / rootRect.height;

  for (const node of root.querySelectorAll(".gallery-overlay__text")) {
    const text = node.textContent || "";
    if (!text.trim()) continue;
    const rect = node.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    const style = getComputedStyle(node);
    const fontSize = (Number.parseFloat(style.fontSize) || 12) * scaleY;
    const lineHeight = fontSize * 1.3;
    const maxWidth = rect.width * scaleX;

    context.save();
    context.translate(
      (rect.left - rootRect.left + rect.width / 2) * scaleX,
      (rect.top - rootRect.top + rect.height / 2) * scaleY,
    );
    const angle = transformAngle(style.transform);
    if (angle) context.rotate(angle);
    context.font = `${style.fontWeight || 700} ${fontSize}px ${style.fontFamily || "sans-serif"}`;
    context.fillStyle = style.color || "#ffffff";
    context.textAlign = "center";
    context.textBaseline = "middle";
    context.shadowColor = "rgba(2, 6, 23, 0.5)";
    context.shadowBlur = 10 * scaleY;
    context.shadowOffsetY = 2 * scaleY;

    const lines = wrapCanvasText(context, text, maxWidth);
    const startY = -((lines.length - 1) * lineHeight) / 2;
    lines.forEach((line, index) => context.fillText(line, 0, startY + index * lineHeight));
    context.restore();
  }
}

function transformAngle(transform) {
  const match = String(transform || "").match(/^matrix\(([^)]+)\)$/);
  if (!match) return 0;
  const [a, b] = match[1].split(",").map((value) => Number.parseFloat(value));
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.atan2(b, a);
}

/// Mirrors `white-space: pre-wrap` + `overflow-wrap: anywhere`: explicit breaks
/// are kept and overlong content wraps per character.
function wrapCanvasText(context, text, maxWidth) {
  const lines = [];
  for (const paragraph of String(text).split("\n")) {
    if (!paragraph) {
      lines.push("");
      continue;
    }
    let current = "";
    for (const character of paragraph) {
      const candidate = current + character;
      if (current && context.measureText(candidate).width > maxWidth) {
        lines.push(current);
        current = character;
      } else {
        current = candidate;
      }
    }
    lines.push(current);
  }
  return lines.length ? lines : [""];
}

function compositeContentImages(canvas, root) {
  const context = canvas.getContext("2d");
  const rootRect = root.getBoundingClientRect();
  if (!context || rootRect.width <= 0 || rootRect.height <= 0) return;

  // Same reason as the normalization step: default "low" smoothing aliases and
  // thins detail when a content photo is downscaled into the final canvas.
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";

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

/// Which gallery pages get their photo lifted out of the clone: every one of
/// them. A scene composite, a raw full-bleed photo and a template card's photo
/// are all multi-megapixel, and the photo-only rasterizes of those three look
/// the same to WebKit, so leaving any of them inside the cloned SVG keeps the
/// silent-drop race live. Everything the photo used to sit under is repainted by
/// `composeScenePhotoCapture`, and everything it sat under — border, shade, type,
/// stickers — still lands on top from the chrome pass.
function shouldLiftGalleryPhoto(page) {
  if (new URLSearchParams(location.search).get("noLift") === "1") return false;
  const gallery = page?.gallery;
  return Boolean(gallery && !gallery.empty && gallery.src);
}

/// True when the gallery photo really is one flat colour, which is the single
/// card a blank-looking capture is right about. Reads the bitmap synchronously:
/// this runs on every gallery page, and a `decode()` round here would cost a
/// second round trip on the way to the lift that already waits for it. Anything
/// that cannot be read counts as "not flat" and leaves the guards armed.
function gallerySourceIsFlat(root) {
  const image = root.querySelector("img.card-gallery__image");
  if (!image || !image.complete || image.naturalWidth <= 0) return false;
  const probe = document.createElement("canvas");
  probe.width = 10;
  probe.height = 10;
  const context = probe.getContext("2d", { willReadFrequently: true });
  if (!context) return false;
  try {
    context.drawImage(image, 0, 0, probe.width, probe.height);
    return isFlatRaster(probe);
  } catch {
    return false;
  }
}

/// Takes the gallery photo out of the export DOM and records the boxes it has to
/// be painted back into. These photos are multi-megapixel, and WebKit silently
/// drops images of that size from html-to-image's clone — the page then exports
/// as the capture's flat background colour. Keeping the photo out of the clone
/// removes that failure mode entirely, and painting it ourselves also skips a
/// pointless JPEG generation.
async function liftGalleryPhotoForCapture(root, isSceneBackdrop = false) {
  const image = root.querySelector("img.card-gallery__image");
  const figure = image?.closest(".card-gallery");
  if (!image || !figure) return null;
  if (image.naturalWidth <= 0 && !(await waitForImageDecode(image))) {
    throw new Error(t("runtime.binaryFailed"));
  }

  const rootRect = root.getBoundingClientRect();
  const figureRect = figure.getBoundingClientRect();
  const imageRect = image.getBoundingClientRect();
  if (rootRect.width <= 0 || rootRect.height <= 0) return null;
  if (figureRect.width <= 0 || figureRect.height <= 0) return null;

  // The pixels are taken while the element is still in the document and freshly
  // decoded. Drawing a detached image later is what a scene page cannot risk: a
  // WebView is free to drop the bitmap of an element that left the tree, and a
  // revoked blob would then paint nothing at all.
  const photo = rasterizeScenePhoto(image, !isSceneBackdrop);
  const imageStyle = getComputedStyle(image);
  const figureStyle = getComputedStyle(figure);
  const frameStyle = getComputedStyle(root);
  const layer = {
    photo,
    image,
    figure,
    rootRect,
    figureRect,
    imageRect,
    fit: imageStyle.objectFit || "cover",
    radius: Number.parseFloat(figureStyle.borderTopLeftRadius) || 0,
    background: frameStyle.backgroundColor || "",
    backdrop: null,
    cleared: [],
  };

  // Every layer under the photo is the card's own matte. Left alone it would be
  // captured on top of the photo instead of under it, so the whole ancestor chain
  // up to the frame is cleared and composeScenePhotoCapture paints the colour
  // back before the chrome lands on it.
  for (let node = figure; node; node = node.parentElement) {
    layer.cleared.push({
      node,
      background: node.style.background,
      backgroundImage: node.style.backgroundImage,
      boxShadow: node.style.boxShadow,
    });
    node.style.background = "transparent";
    node.style.backgroundImage = "none";
    node.style.boxShadow = "none";
    if (node === root) break;
  }

  image.remove();

  // The blurred backdrop paints *under* the photo in the preview, so it cannot
  // ride in the chrome pass that lands on top of it. It is a small pre-blurred
  // raster (CSS blur is unreliable in the clone), so taking its pixels here and
  // painting them first is faithful — and a `contain` letterbox or a framed
  // card really does show it, so hiding it is not an option either.
  const backdrop = root.querySelector("img.poster-backdrop");
  if (backdrop && backdrop.getBoundingClientRect().width > 0) {
    layer.backdrop = {
      node: backdrop,
      photo: rasterizeScenePhoto(backdrop, true),
      rect: backdrop.getBoundingClientRect(),
      fit: getComputedStyle(backdrop).objectFit || "cover",
      visibility: backdrop.style.visibility,
    };
    backdrop.style.visibility = "hidden";
  }
  return layer;
}

/// Undoes liftGalleryPhotoForCapture so a page can still be captured with its
/// photo inside the cloned markup.
function restoreGalleryPhotoForCapture(layer) {
  if (layer.backdrop) {
    layer.backdrop.node.style.visibility = layer.backdrop.visibility || "";
    layer.backdrop = null;
  }
  for (const entry of layer.cleared || []) {
    entry.node.style.background = entry.background;
    entry.node.style.backgroundImage = entry.backgroundImage;
    entry.node.style.boxShadow = entry.boxShadow;
  }
  layer.cleared = [];
  if (!layer.image.isConnected) {
    layer.figure.insertBefore(layer.image, layer.figure.firstChild);
  }
}

/// A bitmap of a lifted gallery photo, taken while the element is still in the
/// document. A scene composite that reads back as one flat colour means the
/// WebView dropped its decoded pixels, so the page would reach the publisher as
/// a blank card and the raster is refused; `allowFlat` switches that guard off
/// for sources where a single colour is a legitimate picture — the backdrop of a
/// tinted card, or a gallery photo the user really did import as one flat fill.
function rasterizeScenePhoto(image, allowFlat = false) {
  const width = image.naturalWidth || 0;
  const height = image.naturalHeight || 0;
  if (width <= 0 || height <= 0) throw new Error(t("runtime.binaryFailed"));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error(t("runtime.binaryFailed"));
  context.drawImage(image, 0, 0, width, height);
  if (!allowFlat && isFlatRaster(canvas)) throw new Error(t("runtime.binaryFailed"));
  return canvas;
}

/// A 10×10 downsample of one flat colour means nothing was painted into the
/// raster; no shipped scene composite is a single colour.
function isFlatRaster(canvas) {
  const probe = document.createElement("canvas");
  probe.width = 10;
  probe.height = 10;
  const context = probe.getContext("2d", { willReadFrequently: true });
  if (!context) return false;
  try {
    context.drawImage(canvas, 0, 0, probe.width, probe.height);
    const data = context.getImageData(0, 0, probe.width, probe.height).data;
    const red = data[0];
    const green = data[1];
    const blue = data[2];
    const tolerance = 6;
    for (let index = 0; index < data.length; index += 4) {
      if (
        Math.abs(data[index] - red) > tolerance
        || Math.abs(data[index + 1] - green) > tolerance
        || Math.abs(data[index + 2] - blue) > tolerance
      ) {
        return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}

/// True when the chrome capture left the photo's box see-through, which is what
/// lets the lifted photo be painted underneath it.
function sceneChromeIsTransparent(chrome, layer) {
  const context = chrome.getContext("2d", { willReadFrequently: true });
  if (!context) return true;
  const scaleX = chrome.width / layer.rootRect.width;
  const scaleY = chrome.height / layer.rootRect.height;
  const left = (layer.figureRect.left - layer.rootRect.left) * scaleX;
  const top = (layer.figureRect.top - layer.rootRect.top) * scaleY;
  const width = layer.figureRect.width * scaleX;
  const height = layer.figureRect.height * scaleY;
  const samples = 5;
  let opaque = 0;
  let total = 0;
  try {
    for (let row = 0; row < samples; row += 1) {
      for (let column = 0; column < samples; column += 1) {
        const x = Math.min(chrome.width - 1, Math.round(left + ((column + 0.5) * width) / samples));
        const y = Math.min(chrome.height - 1, Math.round(top + ((row + 0.5) * height) / samples));
        if (x < 0 || y < 0) continue;
        total += 1;
        if (context.getImageData(x, y, 1, 1).data[3] > 250) opaque += 1;
      }
    }
  } catch {
    // A tainted canvas cannot be sampled; the composition still works.
    return true;
  }
  // Title and caption glyphs are opaque but only cover a small part of the card.
  return total === 0 || opaque / total < 0.6;
}

/// True when the captured canvas is one single colour although the card itself
/// has ink on it. That is the signature of a capture that ran before WebKit
/// rasterized the cloned SVG: the canvas carries only the background fill, the
/// JPEG weighs ~20 KB, and nothing else in the pipeline notices. A card that
/// really is empty (no chrome, no blocks) is left alone.
function captureIsBlank(canvas, root) {
  if (!posterHasInk(root)) return false;
  // 96x128 keeps each probe block at ~11x11 capture pixels: small enough that a
  // single text line or rule leaves the block's average, coarse enough that the
  // read stays a single cheap drawImage.
  const probe = document.createElement("canvas");
  probe.width = 96;
  probe.height = 128;
  const context = probe.getContext("2d", { willReadFrequently: true });
  if (!context) return false;
  try {
    context.drawImage(canvas, 0, 0, probe.width, probe.height);
    const data = context.getImageData(0, 0, probe.width, probe.height).data;
    const red = data[0];
    const green = data[1];
    const blue = data[2];
    // JPEG rounding on a solid fill stays inside this band; ink does not.
    const tolerance = 10;
    for (let index = 0; index < data.length; index += 4) {
      if (
        Math.abs(data[index] - red) > tolerance
        || Math.abs(data[index + 1] - green) > tolerance
        || Math.abs(data[index + 2] - blue) > tolerance
      ) {
        return false;
      }
    }
    return true;
  } catch {
    // A tainted canvas cannot be sampled; let the capture stand as-is.
    return false;
  }
}

/// Whether the rendered card has anything that must survive into the capture:
/// text, a picture, a diagram, or a sticker.
function posterHasInk(root) {
  if (String(root.innerText || "").trim()) return true;
  return Boolean(root.querySelector("img, svg, canvas, hr"));
}

/// Captures one page and refuses to hand back a blank raster. Retries once after
/// a real paint, then fails: a flat card carrying only the background colour has
/// repeatedly reached the publisher as a "successful" bundle, and a failed page
/// is far cheaper than a silent one.
async function capturePage(root, captureOptions, page, pageNum = 1) {
  let canvas = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    canvas = await toCanvasUnthrottled(root, captureOptions);

    if (page?.gallery?.src && galleryPhotoMissingFrom(canvas, root, captureOptions.backgroundColor)) {
      if (attempt === 2) {
        // A card whose own picture really is one flat colour is indistinguishable
        // from a dropped photo at this point, so the guard asks the source first.
        if (!gallerySourceIsFlat(root)) throw new Error(t("runtime.blankCard", { page: pageNum }));
        break;
      }
      await waitForPaint(350);
      continue;
    }

    if (captureIsBlank(canvas, root)) {
      if (attempt === 2) throw new Error(t("runtime.blankPage", { page: pageNum }));
      await waitForPaint(350);
      continue;
    }

    break;
  }
  return canvas;
}

/// Paints the lifted photo, then lays the chrome-only capture over it: the shade
/// gradient, type, and stickers still blend against the photo because they were
/// captured with the same transparency they render with in the preview.
function composeScenePhotoCapture(chrome, layer) {
  const canvas = document.createElement("canvas");
  canvas.width = chrome.width;
  canvas.height = chrome.height;
  const context = canvas.getContext("2d");
  if (!context) return chrome;
  // The lifted photo is usually larger than the capture canvas, and the default
  // "low" smoothing aliases fine detail and thins CJK strokes.
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";

  const scaleX = canvas.width / layer.rootRect.width;
  const scaleY = canvas.height / layer.rootRect.height;
  const clipX = (layer.figureRect.left - layer.rootRect.left) * scaleX;
  const clipY = (layer.figureRect.top - layer.rootRect.top) * scaleY;
  const clipWidth = layer.figureRect.width * scaleX;
  const clipHeight = layer.figureRect.height * scaleY;
  const boxX = (layer.imageRect.left - layer.rootRect.left) * scaleX;
  const boxY = (layer.imageRect.top - layer.rootRect.top) * scaleY;
  const boxWidth = layer.imageRect.width * scaleX;
  const boxHeight = layer.imageRect.height * scaleY;

  // A `contain` letterbox and a framed gallery's rounded corners show the card's
  // matte, which the chrome capture no longer carries.
  const matte = /^rgba\(0, 0, 0, 0\)$/.test(layer.background) ? "#0b1220" : layer.background;
  context.fillStyle = matte || "#0b1220";
  context.fillRect(0, 0, canvas.width, canvas.height);

  // The blurred backdrop is what a letterbox or a framed margin really shows, so
  // it goes down before the photo rather than riding in the chrome on top of it.
  if (layer.backdrop?.photo) {
    const rect = layer.backdrop.rect;
    drawImageObjectFit(
      context,
      layer.backdrop.photo,
      (rect.left - layer.rootRect.left) * scaleX,
      (rect.top - layer.rootRect.top) * scaleY,
      rect.width * scaleX,
      rect.height * scaleY,
      layer.backdrop.fit,
    );
  }

  context.save();
  roundedRectPath(
    context,
    clipX,
    clipY,
    clipWidth,
    clipHeight,
    Math.min(layer.radius * Math.min(scaleX, scaleY), clipWidth / 2, clipHeight / 2),
  );
  context.clip();
  drawImageObjectFit(context, layer.photo, boxX, boxY, boxWidth, boxHeight, layer.fit);
  context.restore();

  context.drawImage(chrome, 0, 0);
  return canvas;
}

/// Mirrors `object-fit` for the one case the export cannot leave to the browser.
/// The source is the rasterised scene photo, so its own size stands in for the
/// decoded image dimensions.
function drawImageObjectFit(context, image, x, y, width, height, fit) {
  const naturalWidth = image.naturalWidth || image.width || 0;
  const naturalHeight = image.naturalHeight || image.height || 0;
  if (naturalWidth <= 0 || naturalHeight <= 0 || width <= 0 || height <= 0) return;
  if (fit === "fill") {
    context.drawImage(image, x, y, width, height);
    return;
  }
  const contain = fit === "contain" || fit === "scale-down";
  const scale = contain
    ? Math.min(width / naturalWidth, height / naturalHeight)
    : Math.max(width / naturalWidth, height / naturalHeight);
  const drawWidth = naturalWidth * scale;
  const drawHeight = naturalHeight * scale;
  context.drawImage(
    image,
    x + (width - drawWidth) / 2,
    y + (height - drawHeight) / 2,
    drawWidth,
    drawHeight,
  );
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
