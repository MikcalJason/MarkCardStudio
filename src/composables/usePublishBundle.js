import { ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import {
  blobToBase64,
  createOutputFolderName,
  renderPageToImage,
} from "./useCardExport.js";
import { sha256Blob } from "../publish/contentHash.js";
import { getPublishChannel } from "../config/publishChannels.js";
import { i18n } from "../i18n/index.js";

function t(key, params) {
  return i18n.global.t(key, params);
}

function isTauriRuntime() {
  return typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__);
}

function jpegQualityForScale(scale) {
  if (scale === 1) return 0.8;
  if (scale === 3) return 0.95;
  return 0.9;
}

function encodeTextBase64(text) {
  const bytes = new TextEncoder().encode(String(text || ""));
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}

function bundleId() {
  const now = new Date();
  const stamp = [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
    "-",
    String(now.getHours()).padStart(2, "0"),
    String(now.getMinutes()).padStart(2, "0"),
    String(now.getSeconds()).padStart(2, "0"),
  ].join("");
  return `${stamp}-${Math.random().toString(36).slice(2, 8)}`;
}

function createTauriWriter() {
  let tempPath = "";
  return {
    kind: "tauri",
    async begin(rootFolder, bundleName) {
      tempPath = await invoke("begin_publish_bundle", { folderPath: rootFolder, bundleName });
    },
    async write(relativePath, data) {
      const base64Data =
        typeof data === "string" ? encodeTextBase64(data) : await blobToBase64(data);
      await invoke("append_publish_bundle_file", { bundlePath: tempPath, relativePath, base64Data });
    },
    async finish(manifestJson) {
      return invoke("finish_publish_bundle", { bundlePath: tempPath, manifestJson });
    },
    async abort() {
      if (tempPath) await invoke("cancel_publish_bundle", { bundlePath: tempPath });
      tempPath = "";
    },
  };
}

function createDirectoryWriter(rootHandle) {
  async function entry(relativePath) {
    const segments = relativePath.split("/");
    const fileName = segments.pop();
    let directory = rootHandle;
    for (const segment of segments) {
      directory = await directory.getDirectoryHandle(segment, { create: true });
    }
    return directory.getFileHandle(fileName, { create: true });
  }

  return {
    kind: "directory",
    async begin() {},
    async write(relativePath, data) {
      const handle = await entry(relativePath);
      const writable = await handle.createWritable();
      await writable.write(data);
      await writable.close();
    },
    async finish(manifestJson) {
      await this.write("manifest.json", new TextEncoder().encode(manifestJson));
      return rootHandle.name;
    },
    async abort() {},
  };
}

/**
 * Renders the plan's pages through the shared card renderer and writes the
 * publish bundle. Desktop writes it to the app's own managed publish folder, so
 * the flow never asks for a target directory; browser mode keeps the File
 * System Access API because a page has no app folder, and without it the flow
 * stops with a message instead of pretending the files exist.
 */
export function usePublishBundle({
  pages,
  sourcePath,
  themeClass,
  selectedTheme,
  backgroundColor,
  backgroundType,
  backgroundValue,
  transparentBackground,
  scale,
  showTopLeft,
  showTopRight,
  showPageNumber,
  showBottomLeft,
  showBottomRight,
  customFontFamily,
  customFontEmbedCss,
  ensurePagesReady,
}) {
  const isGenerating = ref(false);
  const progress = ref({ stage: "idle", current: 0, total: 0 });
  const lastBundlePath = ref("");
  // The managed bundle folder, resolved once per session and reused for every
  // channel so the dialog can name the destination before anything is written.
  const bundleRootPath = ref("");
  // Loopback bridge for the assisted channels: the Chrome fill extension pulls
  // the bundle from here, so opening the creator page needs no folder picker.
  const bridge = ref(null);
  const bridgeError = ref("");

  async function ensureBundleRoot() {
    if (!isTauriRuntime()) return "";
    if (bundleRootPath.value) return bundleRootPath.value;
    let root = "";
    try {
      root = await invoke("get_publish_bundle_root");
    } catch (error) {
      throw new Error(t("publishFlow.errors.bundleRoot", { error: error?.message || error }));
    }
    bundleRootPath.value = typeof root === "string" ? root : "";
    if (!bundleRootPath.value) {
      throw new Error(t("publishFlow.errors.bundleRoot", { error: "-" }));
    }
    return bundleRootPath.value;
  }

  async function ensureBridge(bundlePath) {
    if (!isTauriRuntime() || !bundlePath) return null;
    const current = bridge.value;
    if (
      current &&
      current.bundlePath === bundlePath &&
      Number(current.expiresAt) > Date.now()
    ) {
      return current;
    }
    const started = await invoke("publish_bridge_start", { bundlePath });
    bridge.value = { ...started, bundlePath };
    bridgeError.value = "";
    return bridge.value;
  }

  async function createWriter() {
    if (isTauriRuntime()) {
      const rootFolder = await ensureBundleRoot();
      return { writer: createTauriWriter(), rootFolder };
    }
    if (typeof window.showDirectoryPicker !== "function") return null;
    let handle = null;
    try {
      handle = await window.showDirectoryPicker({ mode: "readwrite" });
    } catch (error) {
      if (error?.name === "AbortError") return null;
      throw new Error(t("publishFlow.errors.pickerBlocked"));
    }
    return { writer: createDirectoryWriter(handle), rootFolder: handle.name };
  }

  async function generatePublishBundle({ plan, channel, preflight, contentHash, signal } = {}) {
    if (isGenerating.value) return null;
    if (!plan?.images?.length) throw new Error(t("publishFlow.errors.noPages"));

    const abortSignal = signal || null;
    isGenerating.value = true;
    progress.value = { stage: "prepare", current: 0, total: plan.images.length };

    // Gallery scene backdrops are generated on demand, so a bundle must not be
    // written from pages that still point at the plain photo.
    try {
      await ensurePagesReady?.();
    } catch (error) {
      isGenerating.value = false;
      progress.value = { stage: "idle", current: 0, total: 0 };
      throw error?.message ? error : new Error(String(error));
    }

    const created = await createWriter().catch((error) => {
      isGenerating.value = false;
      progress.value = { stage: "idle", current: 0, total: 0 };
      if (error?.name === "AbortError") return null;
      throw error;
    });
    if (!created) {
      isGenerating.value = false;
      progress.value = { stage: "idle", current: 0, total: 0 };
      return null;
    }

    const { writer } = created;
    const list = pages?.value || [];
    const ext = String(plan.options.format).toUpperCase() === "JPG" ? "jpg" : "png";
    const maxBytes = getPublishChannel(plan.channelId)?.media?.maxBytes || 0;
    const quality = jpegQualityForScale(plan.options.scale);
    const renderContext = {
      width: plan.canvas.width,
      height: plan.canvas.height,
      themeClass: themeClass?.value || "theme-swiss-grid",
      transparent: Boolean(transparentBackground?.value),
      backgroundColor: backgroundColor?.value || "#69eacb",
      backgroundType: backgroundType?.value || "gradient",
      backgroundValue: backgroundValue?.value || "",
      format: plan.options.format,
      quality,
      // Document order, matching the export and the scan preview: the bundle may
      // reorder pages for a channel, but the printed number belongs to the doc.
      totalPages: list.length,
      showTopLeft: showTopLeft?.value ?? true,
      showTopRight: showTopRight?.value ?? true,
      showPageNumber: showPageNumber?.value ?? true,
      showBottomLeft: showBottomLeft?.value ?? true,
      showBottomRight: showBottomRight?.value ?? true,
      customFontFamily: customFontFamily?.value || "",
      customFontEmbedCss: customFontEmbedCss?.value || "",
    };

    const bundleName = `${createOutputFolderName(sourcePath?.value)}-publish-${channel.id}`;
    const images = [];

    try {
      await writer.begin(created.rootFolder, bundleName);

      for (let index = 0; index < plan.images.length; index += 1) {
        if (abortSignal?.aborted) throw new Error(t("publishFlow.errors.cancelled"));
        const planned = plan.images[index];
        const page = list[planned.pageIndex];
        if (!page) throw new Error(t("publishFlow.errors.pageMissing", { page: planned.pageIndex + 1 }));

        progress.value = { stage: "render", current: index + 1, total: plan.images.length };
        const rendered = await renderPageToImage(page, {
          ...renderContext,
          pageNumber: planned.pageIndex + 1,
        });

        // A scene page renders on a much larger canvas, so the channel's byte
        // limit can be blown after a bundle is "ready". Fail here, with the page
        // named, instead of during the upload.
        if (maxBytes && rendered.blob.size > maxBytes) {
          throw new Error(t("publishFlow.errors.imageTooLarge", {
            page: planned.pageIndex + 1,
            size: (rendered.blob.size / (1024 * 1024)).toFixed(1),
            max: Math.round(maxBytes / (1024 * 1024)),
          }));
        }

        const file = `images/${String(index + 1).padStart(2, "0")}.${ext}`;
        await writer.write(file, rendered.blob);
        images.push({
          file,
          role: planned.role,
          pageIndex: planned.pageIndex,
          width: rendered.width,
          height: rendered.height,
          bytes: rendered.blob.size,
          sha256: await sha256Blob(rendered.blob),
        });
      }

      progress.value = { stage: "copy", current: plan.images.length, total: plan.images.length };
      await writer.write("title.txt", `${plan.content.title}\n`);
      await writer.write("body.txt", `${plan.content.body}\n`);
      await writer.write("tags.txt", `${plan.content.tags.map((tag) => `#${tag}`).join(" ")}\n`);

      const manifest = {
        schemaVersion: 1,
        generator: "markcard-studio",
        id: bundleId(),
        createdAt: new Date().toISOString(),
        source: {
          path: plan.meta.sourcePath,
          contentHash,
        },
        channel: {
          id: channel.id,
          mode: channel.mode,
          canvas: { width: plan.canvas.width, height: plan.canvas.height },
        },
        content: plan.content,
        images,
        render: {
          theme: selectedTheme?.value || "",
          scale: plan.options.scale,
          format: ext.toUpperCase(),
        },
        publish: {
          mode: plan.options.mode,
          openComment: true,
        },
        checks: {
          ready: preflight?.ready ?? false,
          counts: preflight?.counts ?? { blocker: 0, warning: 0, info: 0 },
          issues: (preflight?.issues || []).map((item) => ({
            code: item.code,
            severity: item.severity,
            section: item.section,
          })),
        },
      };

      progress.value = { stage: "manifest", current: plan.images.length, total: plan.images.length };
      const bundlePath = await writer.finish(JSON.stringify(manifest, null, 2));
      lastBundlePath.value = bundlePath || "";

      // Assisted channels hand the finished bundle to the Chrome extension over
      // a loopback bridge. A bridge failure must not fail a bundle that was
      // already written, so it is reported separately.
      let bridgeInfo = null;
      if (channel.mode === "assist" && bundlePath) {
        bridgeInfo = await ensureBridge(bundlePath).catch((error) => {
          bridgeError.value = error?.message || String(error);
          return null;
        });
      }
      return { bundlePath, manifest, imageCount: images.length, bridge: bridgeInfo };
    } catch (error) {
      await writer.abort().catch(() => {});
      throw error?.message ? error : new Error(String(error));
    } finally {
      isGenerating.value = false;
      progress.value = { stage: "idle", current: 0, total: 0 };
    }
  }

  async function openBundleFolder(bundlePath) {
    if (!bundlePath || !isTauriRuntime()) return;
    await invoke("open_export_folder", { path: bundlePath });
  }

  function supportsBundle() {
    return isTauriRuntime() || typeof window.showDirectoryPicker === "function";
  }

  return {
    bridge,
    bridgeError,
    bundleRootPath,
    ensureBridge,
    ensureBundleRoot,
    generatePublishBundle,
    isGenerating,
    lastBundlePath,
    openBundleFolder,
    progress,
    supportsBundle,
  };
}
