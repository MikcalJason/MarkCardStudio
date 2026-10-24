import { ref } from "vue";
import { invoke } from "@tauri-apps/api/core";
import {
  blobToBase64,
  createOutputFolderName,
  renderPageToImage,
} from "./useCardExport.js";
import { sha256Blob } from "../publish/contentHash.js";
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
 * publish bundle. Browser mode uses the File System Access API; without it the
 * flow stops with a message instead of pretending the files exist.
 */
export function usePublishBundle({
  pages,
  sourcePath,
  exportPath,
  themeClass,
  selectedTheme,
  backgroundColor,
  backgroundType,
  backgroundValue,
  transparentBackground,
  scale,
  showTopLeft,
  showTopRight,
  showBottomLeft,
  showBottomRight,
  customFontFamily,
  customFontEmbedCss,
}) {
  const isGenerating = ref(false);
  const progress = ref({ stage: "idle", current: 0, total: 0 });
  const lastBundlePath = ref("");

  async function resolveTargetFolder() {
    const stored = exportPath?.value?.trim() || "";
    if (stored) return stored;
    const selected = await invoke("pick_export_folder");
    if (!selected) return "";
    if (exportPath) exportPath.value = selected;
    return selected;
  }

  async function createWriter() {
    if (isTauriRuntime()) {
      const rootFolder = await resolveTargetFolder();
      if (!rootFolder) return null;
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
      totalPages: plan.images.length,
      showTopLeft: showTopLeft?.value ?? true,
      showTopRight: showTopRight?.value ?? true,
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
          pageNumber: index + 1,
        });

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
      return { bundlePath, manifest, imageCount: images.length };
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
    generatePublishBundle,
    isGenerating,
    lastBundlePath,
    openBundleFolder,
    progress,
    supportsBundle,
  };
}
