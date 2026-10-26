import { invoke, isTauri } from "@tauri-apps/api/core";
import { computed, nextTick, ref, watch } from "vue";
import qrcode from "qrcode-generator";
import { blobToDataUrl, renderPageToImage } from "./useCardExport";
import { i18n } from "../i18n/index.js";

function t(key, params) {
  return i18n.global.t(key, params);
}

const REMAINING_TICK_MS = 1000;
const STATS_POLL_MS = 2500;
const MAX_QR_PAGES = 99;
const QUIET_ZONE = 4;
const MAX_DIALOG_THUMBS = 12;
const THUMB_LONG_SIDE = 360;

/**
 * Scan-to-preview state: renders the document through the shared card renderer,
 * hands the finished images to the temporary native LAN server, and exposes the
 * URL / QR / live status for the phone. One session at a time; closing the
 * dialog stops the server.
 */
export function useQrPreview({ pages, renderOptions, selectedFormat, ensurePagesReady }) {
  const runtimeIsTauri = isTauri();

  const isOpen = ref(false);
  // idle | rendering | ready | failed | expired | unsupported
  const status = ref("idle");
  const progressText = ref("");
  const errorText = ref("");
  const url = ref("");
  const reachable = ref(false);
  const qrSvg = ref("");
  const pageCount = ref(0);
  const totalBytes = ref(0);
  const expiresAt = ref(0);
  const remainingSecs = ref(0);
  const phoneOpened = ref(false);
  const thumbs = ref([]);

  let sessionSeq = 0;
  let remainingTimer = null;
  let statsTimer = null;
  let disposed = false;

  const sizeLabel = computed(() => formatBytes(totalBytes.value));
  const formatLabel = computed(() =>
    selectedFormat?.value === "JPG" ? "JPG" : "PNG",
  );

  watch(isOpen, (open) => {
    if (open) {
      if (!runtimeIsTauri) {
        status.value = "unsupported";
        return;
      }
      startPreview();
      return;
    }
    stopSession();
  });

  function startPreview() {
    stopTimers();
    startPreviewRender();
  }

  function regeneratePreview() {
    if (!runtimeIsTauri || status.value === "rendering") return;
    startPreviewRender();
  }

  function stopSession() {
    sessionSeq += 1;
    stopTimers();
    if (runtimeIsTauri) {
      invoke("qr_preview_stop").catch(() => {});
    }
    status.value = "idle";
    progressText.value = "";
    errorText.value = "";
    url.value = "";
    qrSvg.value = "";
    expiresAt.value = 0;
    remainingSecs.value = 0;
    phoneOpened.value = false;
    thumbs.value = [];
  }

  function dispose() {
    disposed = true;
    stopSession();
  }

  async function startPreviewRender() {
    const seq = ++sessionSeq;
    status.value = "rendering";
    errorText.value = "";
    progressText.value = t("qrPreview.preparing");

    try {
      // Readiness can replace the page array (measured pagination, gallery
      // scene composites), so the snapshot has to be taken after the await —
      // otherwise the preview renders the pre-ready pages.
      await ensurePagesReady?.();
      if (seq !== sessionSeq) return;
      await nextTick();
      if (seq !== sessionSeq) return;

      const allPages = pages?.value || [];
      if (!allPages.length) {
        throw new Error(t("qrPreview.emptyDocument"));
      }
      if (allPages.length > MAX_QR_PAGES) {
        throw new Error(
          t("qrPreview.tooManyPages", { count: allPages.length, max: MAX_QR_PAGES }),
        );
      }

      const ext = selectedFormat?.value === "JPG" ? "jpg" : "png";
      const files = [];
      const thumbsList = [];
      for (let i = 0; i < allPages.length; i += 1) {
        progressText.value = t("qrPreview.renderingPage", {
          current: i + 1,
          total: allPages.length,
        });
        const dataUrl = await capturePage(
          allPages[i],
          {
            ...renderOptions.value,
            format: ext === "jpg" ? "JPG" : "PNG",
            pageNumber: i + 1,
            totalPages: allPages.length,
          },
          renderOptions.value?.backgroundColor,
        );
        if (seq !== sessionSeq) return;
        files.push({ name: `${String(i + 1).padStart(2, "0")}.${ext}`, dataUrl });
        if (thumbsList.length < MAX_DIALOG_THUMBS) {
          thumbsList.push(await makeThumb(dataUrl));
        }
        if (seq !== sessionSeq) return;
      }

      const started = await invoke("qr_preview_start", {
        files,
        indexHtml: buildPhoneIndexHtml(files, ext),
      });
      if (seq !== sessionSeq) return;

      url.value = started.url;
      reachable.value = Boolean(started.reachable);
      pageCount.value = started.pageCount;
      totalBytes.value = started.totalBytes;
      expiresAt.value = started.expiresAt;
      qrSvg.value = buildQrSvg(started.url);
      phoneOpened.value = false;
      thumbs.value = thumbsList;
      status.value = "ready";
      startTimers();
    } catch (err) {
      if (seq !== sessionSeq) return;
      console.error("QR preview failed:", err);
      errorText.value = err?.message || String(err);
      status.value = "failed";
    }
  }

  /**
   * Renders one page and refuses a capture that is a single flat colour: that
   * is how a dropped html-to-image clone looks (WebKit occasionally discards
   * the whole foreignObject), and the phone must never receive such a page.
   * A fresh mount usually paints, so it gets one retry before failing.
   */
  async function capturePage(page, options, backgroundColor) {
    const first = await renderPageToImage(page, options);
    const firstUrl = await blobToDataUrl(first.blob);
    if (!(await looksBlankCapture(firstUrl, backgroundColor))) return firstUrl;

    // Let the WebView finish the paint it was interrupting before re-mounting.
    await new Promise((resolve) => setTimeout(resolve, 350));
    const retry = await renderPageToImage(page, options);
    const retryUrl = await blobToDataUrl(retry.blob);
    if (await looksBlankCapture(retryUrl, backgroundColor)) {
      throw new Error(t("qrPreview.blankPage", { page: options.pageNumber }));
    }
    return retryUrl;
  }

  function startTimers() {
    stopTimers();
    remainingTimer = setInterval(() => {
      const secs = Math.max(0, Math.round((expiresAt.value - Date.now()) / 1000));
      remainingSecs.value = secs;
      if (status.value === "ready" && secs <= 0) {
        status.value = "expired";
      }
    }, REMAINING_TICK_MS);

    pollStats();
    statsTimer = setInterval(pollStats, STATS_POLL_MS);
  }

  async function pollStats() {
    if (!runtimeIsTauri || disposed || status.value !== "ready") return;
    try {
      const stats = await invoke("qr_preview_stats");
      if (status.value !== "ready") return;
      if (!stats?.running) {
        status.value = "expired";
        return;
      }
      phoneOpened.value = (stats.openCount || 0) > 0;
      if (stats.expiresAt) expiresAt.value = stats.expiresAt;
    } catch {
      // Ignore transient IPC errors; expiry/stop states surface on the next tick.
    }
  }

  function stopTimers() {
    if (remainingTimer) clearInterval(remainingTimer);
    if (statsTimer) clearInterval(statsTimer);
    remainingTimer = null;
    statsTimer = null;
  }

  return {
    isOpen,
    status,
    progressText,
    errorText,
    url,
    reachable,
    qrSvg,
    pageCount,
    totalBytes,
    remainingSecs,
    phoneOpened,
    thumbs,
    sizeLabel,
    formatLabel,
    runtimeIsTauri,
    openQrPreview() {
      if (disposed) return;
      isOpen.value = true;
    },
    regeneratePreview,
    dispose,
  };
}

/**
 * The phone page lists the finished pages. Images stay exact; labels use the
 * desktop session's language so the phone readout matches the app.
 */
function buildPhoneIndexHtml(files, ext) {
  const locale = (i18n.global.locale?.value || "zh-CN").toLowerCase();
  const items = files
    .map(
      (file, index) =>
        `<li><img src="${file.name}" alt="${String(index + 1)}" loading="eager" onerror="this.dataset.error='1'"><span class="tag">${index + 1} / ${files.length}</span></li>`,
    )
    .join("");
  return [
    "<!doctype html>",
    `<html lang="${locale}">`,
    "<head>",
    `<meta charset="utf-8">`,
    `<meta name="viewport" content="width=device-width, initial-scale=1">`,
    `<title>${escapeHtml(t("qrPreview.phoneTitle"))}</title>`,
    "<style>",
    ":root{color-scheme:dark}",
    "body{margin:0;background:#0b1220;color:#94a3b8;font:14px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}",
    "header{padding:20px 16px 8px;text-align:center}",
    "header h1{margin:0;font-size:15px;font-weight:600;color:#e2e8f0}",
    "ul{list-style:none;margin:0;padding:12px}",
    "li{margin:0 0 22px}",
    "img{display:block;width:100%;height:auto}",
    ".tag{display:block;text-align:center;font-size:12px;margin-top:8px;letter-spacing:.08em}",
    "footer{padding:0 16px 32px;text-align:center;font-size:12px;opacity:.65}",
    "img[data-error]{outline:3px solid #ef4444;background:#ef444444}",
    "</style>",
    "</head>",
    "<body>",
    `<header><h1>${escapeHtml(t("qrPreview.phoneTitle"))}</h1></header>`,
    `<ul>${items}</ul>`,
    `<footer>${escapeHtml(t("qrPreview.phoneHint"))}</footer>`,
    "</body>",
    "</html>",
  ].join("");
}

function escapeHtml(text) {
  return String(text ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Local QR renderer: encode once, emit run-length rect paths as plain SVG. */
function buildQrSvg(text) {
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  const count = qr.getModuleCount();
  const size = count + QUIET_ZONE * 2;
  let paths = "";
  for (let row = 0; row < count; row += 1) {
    let runStart = -1;
    for (let col = 0; col < count; col += 1) {
      if (qr.isDark(row, col)) {
        if (runStart < 0) runStart = col;
      } else if (runStart >= 0) {
        paths += appendRun(runStart + QUIET_ZONE, col - runStart, row + QUIET_ZONE);
        runStart = -1;
      }
    }
    if (runStart >= 0) paths += appendRun(runStart + QUIET_ZONE, count - runStart, row + QUIET_ZONE);
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}" shape-rendering="crispEdges"><rect width="${size}" height="${size}" fill="#ffffff"/><path fill="#111827" d="${paths}"/></svg>`;
}

function appendRun(startCol, width, row) {
  return `M${startCol} ${row}h${width}v1h-${width}z`;
}

function formatBytes(bytes) {
  const value = Number(bytes) || 0;
  if (value >= 1024 * 1024) {
    return `${(value / (1024 * 1024)).toFixed(1)} MB`;
  }
  if (value >= 1024) {
    return `${(value / 1024).toFixed(0)} KB`;
  }
  return `${value} B`;
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.decoding = "async";
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("image failed to decode"));
    img.src = dataUrl;
  });
}

/**
 * True when the capture is one flat colour everywhere it matters: the canvas
 * background fill (or white/transparent, for pages without a backdrop) with
 * nothing painted over it. Sampled from the inner area so the card's own edge
 * treatment cannot mask the failure.
 */
async function looksBlankCapture(dataUrl, backgroundColor) {
  const img = await loadImage(dataUrl);
  const width = img.naturalWidth || 1080;
  const height = img.naturalHeight || 1440;
  const probe = document.createElement("canvas");
  const size = 24;
  probe.width = size;
  probe.height = Math.round(size * 1.33);
  const context = probe.getContext("2d", { willReadFrequently: true });
  if (!context) return false;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, probe.width, probe.height);
  context.drawImage(
    img,
    Math.round(width * 0.08),
    Math.round(height * 0.08),
    Math.round(width * 0.84),
    Math.round(height * 0.84),
    0,
    0,
    probe.width,
    probe.height,
  );
  const background = parseHexRgb(backgroundColor);
  const data = context.getImageData(0, 0, probe.width, probe.height).data;
  for (let index = 0; index < data.length; index += 4) {
    if (isFlatPixel(data[index], data[index + 1], data[index + 2], background)) continue;
    return false;
  }
  return true;
}

function isFlatPixel(red, green, blue, background) {
  // White is the underlay for transparent captures.
  if (red >= 246 && green >= 246 && blue >= 246) return true;
  if (!background) return false;
  return (
    Math.abs(red - background[0]) <= 10
    && Math.abs(green - background[1]) <= 10
    && Math.abs(blue - background[2]) <= 10
  );
}

function parseHexRgb(value) {
  const match = String(value || "").trim().match(/^#([0-9a-f]{6})$/i);
  if (!match) return null;
  const hex = match[1];
  return [
    Number.parseInt(hex.slice(0, 2), 16),
    Number.parseInt(hex.slice(2, 4), 16),
    Number.parseInt(hex.slice(4, 6), 16),
  ];
}

/**
 * Renders onto a white underlay so a transparent-but-blank capture reads as
 * white too. A real gallery card never is: photos or the matte always paint.
 */
async function makeThumb(dataUrl) {
  const img = await loadImage(dataUrl);
  const width = img.naturalWidth || 1080;
  const height = img.naturalHeight || 1440;
  const scale = Math.min(1, THUMB_LONG_SIDE / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * scale));
  canvas.height = Math.max(1, Math.round(height * scale));
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.72);
}


