<script setup>
import { invoke, isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import AppCloseConfirmDialog from "./components/AppCloseConfirmDialog.vue";
import AppUpdateDialog from "./components/AppUpdateDialog.vue";
import AppIcon from "./components/AppIcon.vue";
import AppStatusbar from "./components/AppStatusbar.vue";
import AppSettingsDialog from "./components/AppSettingsDialog.vue";
import AppTitlebar from "./components/AppTitlebar.vue";
import AppToolbar from "./components/AppToolbar.vue";
import AssetLibraryBrowser from "./components/assets/AssetLibraryBrowser.vue";
import AssetsWorkspace from "./components/workspaces/AssetsWorkspace.vue";
import CoverStudioDialog from "./components/cover/CoverStudioDialog.vue";
import CreationModePlaceholder from "./components/CreationModePlaceholder.vue";
import GallerySequencePanel from "./components/gallery/GallerySequencePanel.vue";
import InspectorPanel from "./components/InspectorPanel.vue";
import MarkdownEditor from "./components/MarkdownEditor.vue";
import OpsWorkspace from "./components/workspaces/OpsWorkspace.vue";
import PreviewPanel from "./components/PreviewPanel.vue";
import PublishDialog from "./components/publish/PublishDialog.vue";
import PublishWorkspace from "./components/workspaces/PublishWorkspace.vue";
import StickerPickerDialog from "./components/StickerPickerDialog.vue";
import { useAssetLibrary } from "./composables/useAssetLibrary";
import { useCardExport } from "./composables/useCardExport";
import { usePublishBundle } from "./composables/usePublishBundle";
import { usePublishHistory } from "./composables/usePublishHistory";
import { usePublishPlan } from "./composables/usePublishPlan";
import { useStudioDocument } from "./composables/useStudioDocument";
import { useUpdater } from "./composables/useUpdater";
import { useWork } from "./composables/useWork";
import { createTint } from "./utils/imageTint.js";
import { useWorkspaceUi } from "./composables/useWorkspaceUi";
import { useAppPreferences } from "./i18n/index.js";
import { getThemeByName } from "./config/themes.js";

const exportFormats = ["PNG", "JPG", "PDF", "长图(PNG)"];
const settingTabs = ["平台", "分页", "背景", "字体", "标头"];
const { t } = useI18n();
const runtimeIsTauri = isTauri();

const {
  markdownSource,
  sourcePath,
  savedContent,
  isDirty,
  pages,
  selectedPage,
  activePageIndex,
  isLoadingDocument,
  isExporting,
  exportMessage,
  autoSaveStatus,
  showPageNumber,
  showTopLeft,
  showTopRight,
  showBottomLeft,
  showBottomRight,
  selectedTheme,
  selectedPlatformName,
  selectedFormat,
  scale,
  transparentBackground,
  solidBackground,
  backgroundColor,
  exportPath,
  zoom,
  activeTab,
  customWidth,
  customHeight,
  customFonts,
  selectedFontId,
  customFontFamily,
  customFontEmbedCss,
  isLoadingCustomFonts,
  customFontError,
  isCustomFontRuntimeAvailable,
  lineCount,
  wordCount,
  platforms,
  selectedPlatform,
  canvasRatio,
  canvasSizeLabel,
  selectedThemeClass,
  canGoPrevious,
  canGoNext,
  canUndo,
  canRedo,
  undo,
  redo,
  backgroundType,
  backgroundValue,
  paginationMode,
  customDelimiter,
  maxPageLength,
  setPaginationMode,
  setCustomDelimiter,
  setMaxPageLength,
  setBackgroundType,
  setBackgroundValue,
  updateGlobalMeta,
  loadDocumentFromContent,
  openDocumentFromDialog,
  saveDocument,
  createNewDocument,
  setDocumentTitle,
  addPageTemplate,
  deletePage,
  movePage,
  selectPage,
  nextPage,
  previousPage,
  setZoom,
  toggleTheme,
  setCustomWidth,
  setCustomHeight,
  setCustomDimensions,
  swapDimensions,
  importCustomFont,
  selectCustomFont,
  deleteCustomFont,
  coverStickerSelection,
  setCoverStickerSelection,
  setGallerySource,
} = useStudioDocument();

const {
  activeWorkspace,
  creationMode,
  setWorkspace,
  setCreationMode,
  assetLibraryOpen,
  openAssetLibrary,
  closeAssetLibrary,
  stickerPickerOpen,
  openStickerPicker,
  closeStickerPicker,
  coverStudioOpen,
  openCoverStudio,
  closeCoverStudio,
} = useWorkspaceUi();

const assetLibrary = useAssetLibrary();
const {
  currentWork,
  workTitle,
  imageCount,
  galleryLayout,
  ensureWork,
  createWork,
  syncFromDocument,
  addImage,
  removeImage,
  moveImage,
  updateImage,
  updateWork,
  setCover,
  setCoverDesign,
  setGalleryLayout,
  hydrateImages,
  upsertVariant,
  markVariantStatus,
  resetVariant,
} = useWork();

const assetPickerMode = ref(false);
const documentTitle = computed(
  () => pages.value[0]?.title || selectedPage.value?.title || workTitle.value || "",
);
const coverTheme = computed(() => getThemeByName(selectedTheme.value));
const coverDate = computed(() => {
  const now = new Date();
  return `${now.getFullYear()}.${String(now.getMonth() + 1).padStart(2, "0")}`;
});

ensureWork({ sourcePath: sourcePath.value, title: documentTitle.value });
setGallerySource(creationMode, currentWork);

function syncWorkNow() {
  syncFromDocument({
    title: documentTitle.value,
    sourcePath: sourcePath.value,
    theme: selectedTheme.value,
    canvas: {
      width: selectedPlatform.value?.width,
      height: selectedPlatform.value?.height,
    },
    mode: creationMode.value,
    markdown: markdownSource.value,
  });
}

syncWorkNow();

let workSyncTimer = null;
function scheduleWorkSync() {
  if (workSyncTimer) clearTimeout(workSyncTimer);
  workSyncTimer = setTimeout(() => {
    workSyncTimer = null;
    syncWorkNow();
  }, 400);
}

watch(
  [sourcePath, markdownSource, selectedTheme, selectedPlatformName, customWidth, customHeight, documentTitle, creationMode],
  scheduleWorkSync,
);

async function syncGalleryUsage() {
  const work = currentWork.value;
  if (!work) return;
  await assetLibrary.init();
  const refs = new Set(work.images.map((image) => `gallery:${image.id}`));
  for (const asset of assetLibrary.assets.value) {
    for (const usage of [...asset.usage]) {
      if (
        usage.workId === work.id &&
        usage.ref.startsWith("gallery:") &&
        !refs.has(usage.ref)
      ) {
        await assetLibrary.removeUsage(asset.assetId, usage);
      }
    }
  }
  for (const image of work.images) {
    assetLibrary.addUsage(image.assetId, {
      workId: work.id,
      ref: `gallery:${image.id}`,
    });
  }
}

watch(
  [() => currentWork.value?.images.map((image) => image.assetId).join("|"), () => assetLibrary.assets.value.length],
  async () => {
    await hydrateImages((assetId) => assetLibrary.getAssetDataUrl(assetId));
    await syncGalleryUsage();
  },
  { immediate: true },
);

const previewPanelRef = ref(null);
const settingsDialogOpen = ref(false);
const publishDialogOpen = ref(false);
const closeDialogOpen = ref(false);
const isClosingApplication = ref(false);
const viewportWidth = ref(typeof window !== "undefined" ? window.innerWidth : 1600);
const leftSidebarDocked = computed(() => viewportWidth.value >= 1240);
const rightSidebarDocked = computed(() => viewportWidth.value >= 1180);
const leftDrawerOpen = ref(false);
const rightDrawerOpen = ref(false);
const showLeftDrawerToggle = computed(() => !leftSidebarDocked.value);
const showRightDrawerToggle = computed(() => !rightSidebarDocked.value);
const layoutStyle = computed(() => ({
  gridTemplateColumns:
    leftSidebarDocked.value && rightSidebarDocked.value
      ? "minmax(320px, 386px) minmax(0,1fr) minmax(300px, 332px)"
      : leftSidebarDocked.value
        ? "minmax(320px, 386px) minmax(0,1fr)"
        : rightSidebarDocked.value
          ? "minmax(0,1fr) minmax(300px, 332px)"
          : "minmax(0,1fr)",
}));
let removeCloseRequestedListener = null;
let removeExitRequestedListener = null;
let appIsUnmounted = false;
const { exportCurrentPage, exportToAssetLibrary, exportAction } = useCardExport({
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
});

const publishPlan = usePublishPlan({
  pages,
  currentWork,
  markdownSource,
  sourcePath,
  selectedPlatform,
  isDirty,
  transparentBackground,
  scale,
  upsertVariant,
  markVariantStatus,
  resetVariant,
});

const publishBundle = usePublishBundle({
  pages,
  sourcePath,
  exportPath,
  themeClass: selectedThemeClass,
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
});

const publishHistory = usePublishHistory();

function openPublishDialog() {
  publishHistory.refresh();
  publishDialogOpen.value = true;
}

function applyChannelCanvas(channel) {
  const match = platforms.find(
    (platform) =>
      !platform.custom &&
      platform.width === channel.canvas.width &&
      platform.height === channel.canvas.height,
  );
  if (match) {
    selectedPlatformName.value = match.name;
    return;
  }
  setCustomDimensions(channel.canvas.width, channel.canvas.height);
  selectedPlatformName.value = "自定义尺寸";
}

function backToCreation() {
  publishDialogOpen.value = false;
  setWorkspace("create");
}

function handlePublishAction(issue) {
  if (issue?.action?.type === "switch-canvas") {
    applyChannelCanvas(publishPlan.channel.value);
    return;
  }
  backToCreation();
}

const { resolvedAppearance, setAppearancePreference } = useAppPreferences();
const isDarkMode = computed(() => resolvedAppearance.value === "dark");

function toggleDarkMode() {
  setAppearancePreference(isDarkMode.value ? "light" : "dark");
}

function selectPlatform(name) {
  selectedPlatformName.value = name;
}

function openAssetManager() {
  assetPickerMode.value = false;
  openAssetLibrary();
}

function openAssetPicker() {
  assetPickerMode.value = true;
  assetLibrary.clearSelection();
  openAssetLibrary();
}

function closeAssetDialog() {
  assetPickerMode.value = false;
  closeAssetLibrary();
}

function handleSelectCreationMode(mode) {
  setCreationMode(mode);
  scheduleWorkSync();
}

function handleNewDocument() {
  createNewDocument();
  createWork({ title: t("document.title") });
  scheduleWorkSync();
}

async function handleAssetInsert(asset) {
  if (!asset?.assetId) return false;
  if (!sourcePath.value) {
    exportMessage.value = t("assets.saveBeforeInsert");
    return false;
  }
  const snippet = await assetLibrary.buildMarkdownSnippet(
    asset.assetId,
    sourcePath.value,
    asset.alt || asset.name,
  );
  if (!snippet) {
    exportMessage.value = t("assets.insertFailed");
    return false;
  }
  const nextMarkdown = `${markdownSource.value.replace(/\s+$/, "")}\n\n${snippet.markdown}\n`;
  recordDiscreteChange(nextMarkdown);
  assetLibrary.addUsage(asset.assetId, {
    workId: currentWork.value?.id || "",
    ref: "markdown",
  });
  exportMessage.value = snippet.mirrored
    ? t("assets.inserted", { name: asset.name || asset.fileName })
    : t("assets.mirrorFailed");
  closeAssetDialog();
  return true;
}

// The workspace has no export/insert panel, so failures must surface in the
// library's own message area instead of an invisible exportMessage.
async function handleWorkspaceInsert(asset) {
  const ok = await handleAssetInsert(asset);
  if (!ok) assetLibrary.error.value = exportMessage.value || t("assets.insertFailed");
}

function tintableSource(source) {
  return typeof source === "string" && /^(data:|blob:|https?:|\/)/i.test(source);
}

// Deferred so the gallery card appears immediately; the tint only paints the
// backdrop and every backdrop consumer already falls back to the wallpaper.
function scheduleGalleryTint(image, source) {
  if (!tintableSource(source)) return;
  window.setTimeout(async () => {
    try {
      const tint = await createTint(source);
      if (tint) updateImage(image.id, { tint });
    } catch {
      // Sampling is decorative; keep the wallpaper fallback.
    }
  }, 0);
}

async function addGalleryAssets(assets = []) {
  if (!currentWork.value) return;
  let added = 0;
  for (const asset of assets) {
    if (!asset?.assetId) continue;
    const src = await assetLibrary.getAssetDataUrl(asset.assetId);
    const image = addImage({
      assetId: asset.assetId,
      src,
      alt: asset.alt || "",
      caption: "",
    });
    if (image) {
      added += 1;
      // Sampling runs in the background: a large photo must never delay the
      // image from appearing, and older callers already handle a missing tint.
      scheduleGalleryTint(image, asset.thumbDataUrl || src);
      assetLibrary.addUsage(asset.assetId, {
        workId: currentWork.value.id,
        ref: `gallery:${image.id}`,
      });
      if (sourcePath.value) {
        assetLibrary.ensureMirror(asset.assetId, sourcePath.value);
      }
    }
  }
  if (added) {
    selectPage(
      Math.max(0, galleryCoverPageOffset() + currentWork.value.images.length - 1),
    );
  }
  closeAssetDialog();
}

function handleAssetPick(assets) {
  if (!Array.isArray(assets) || !assets.length) return;
  if (!assetPickerMode.value) return;
  addGalleryAssets(assets);
}

// The assets workspace is document-independent, so sending a picture to the
// gallery has to land the user back in 创作/图集 where the result is visible.
async function handleWorkspaceAddToGallery(assets) {
  const list = (Array.isArray(assets) ? assets : [assets]).filter((asset) => asset?.assetId);
  if (!list.length) return;
  ensureWork({ sourcePath: sourcePath.value, title: documentTitle.value });
  setWorkspace("create");
  setCreationMode("gallery");
  await addGalleryAssets(list);
}

function handleAddPage() {
  if (creationMode.value === "gallery") {
    openAssetPicker();
    return;
  }
  addPageTemplate();
}

function removeGalleryImage(image) {
  if (!image) return;
  removeImage(image.id);
  assetLibrary.removeUsage(image.assetId, {
    workId: currentWork.value?.id || "",
    ref: `gallery:${image.id}`,
  });
}

function handleRemoveGalleryImage(image) {
  const offset = galleryCoverPageOffset();
  const index = currentWork.value?.images.findIndex((item) => item.id === image.id) ?? -1;
  removeGalleryImage(image);
  const lastImagePage = offset + Math.max(0, currentWork.value.images.length - 1);
  const target = index >= 0 ? offset + index : lastImagePage;
  const lastPage = Math.max(0, (pages.value?.length || 1) - 1);
  selectPage(Math.max(0, Math.min(target, Math.min(lastImagePage, lastPage))));
}

function handleDeletePage(index) {
  if (creationMode.value === "gallery") {
    const image = currentWork.value?.images[index - galleryCoverPageOffset()];
    if (image) handleRemoveGalleryImage(image);
    return;
  }
  deletePage(index);
}

function handleMovePage({ fromIndex, toIndex }) {
  if (creationMode.value === "gallery") {
    if (moveImage(fromIndex, toIndex)) selectPage(galleryCoverPageOffset() + toIndex);
    return;
  }
  movePage({ fromIndex, toIndex });
}

function handleGalleryOverlay({ imageId, overlay }) {
  updateImage(imageId, { overlay });
}

// The active gallery page maps straight back to its work image entry, so the
// overlay panel always edits the picture the preview is showing.
const activeGalleryImageIndex = computed(() => {
  if (creationMode.value !== "gallery") return -1;
  const index = selectedPage.value?.gallery?.index;
  return Number.isInteger(index) ? index : -1;
});

const activeGalleryImage = computed(() => {
  if (activeGalleryImageIndex.value < 0) return null;
  return currentWork.value?.images?.[activeGalleryImageIndex.value] || null;
});

// The sequence panel speaks in image indices while preview pages may start with
// a designed cover page, so selecting an image needs that page offset.
function galleryCoverPageOffset() {
  return currentWork.value?.coverDesign ? 1 : 0;
}

function handleGalleryImageSelect(index) {
  const safeIndex = Number.isInteger(index) ? index : 0;
  selectPage(Math.max(0, galleryCoverPageOffset() + safeIndex));
}

function handleSetGalleryCover(image) {
  if (!image?.assetId) return;
  setCover(image.assetId);
  const index = (currentWork.value?.images || []).findIndex((item) => item.id === image.id);
  selectPage(Math.max(0, galleryCoverPageOffset() + Math.max(0, index)));
}

function handleGalleryLayout(patch) {
  setGalleryLayout(patch);
  const background = patch?.background;
  if (background !== "blurred" && background !== "tint") return;
  // Older works predate tint sampling: fill in what is missing so switching the
  // backdrop on never leaves a card with nothing to paint.
  ensureGalleryTints();
}

async function ensureGalleryTints() {
  const work = currentWork.value;
  if (!work) return;
  for (const image of [...work.images]) {
    if (image.tint?.average || image.tint?.backdrop) continue;
    try {
      const source = image.src || (await assetLibrary.getAssetDataUrl(image.assetId));
      if (!tintableSource(source)) continue;
      const tint = await createTint(source);
      if (tint) updateImage(image.id, { tint });
    } catch {
      // A missing source or an unreadable picture keeps the wallpaper fallback.
    }
  }
}

function handleGalleryTitle(title) {
  if (!title) return;
  updateWork({ title });
  if (currentWork.value?.coverDesign) {
    setCoverDesign({ ...currentWork.value.coverDesign, title });
  }
  setDocumentTitle(title);
}

function handleCoverSave(design) {
  if (!design) return;
  setCoverDesign(design);
  updateWork({ title: design.title });
  setDocumentTitle(design.title);
  setCreationMode("gallery");
  selectPage(0);
  closeCoverStudio();
}

function handleRemoveCoverDesign() {
  setCoverDesign(null);
  selectPage(0);
}

const inspectorProps = computed(() => ({
  activePageIndex: activePageIndex.value,
  activePage: selectedPage.value,
  activeTab: activeTab.value,
  exportFormats,
  exportMessage: exportMessage.value,
  isExporting: isExporting.value,
  exportAction: exportAction.value,
  pagesLength: pages.value.length,
  platforms,
  scale: scale.value,
  selectedFormat: selectedFormat.value,
  selectedPlatformName: selectedPlatformName.value,
  selectedPlatform: selectedPlatform.value,
  customWidth: customWidth.value,
  customHeight: customHeight.value,
  paginationMode: paginationMode.value,
  customDelimiter: customDelimiter.value,
  maxPageLength: maxPageLength.value,
  backgroundType: backgroundType.value,
  backgroundValue: backgroundValue.value,
  settingTabs,
  solidBackground: solidBackground.value,
  transparentBackground: transparentBackground.value,
  backgroundColor: backgroundColor.value,
  exportPath: exportPath.value,
  showPageNumber: showPageNumber.value,
  showTopLeft: showTopLeft.value,
  showTopRight: showTopRight.value,
  showBottomLeft: showBottomLeft.value,
  showBottomRight: showBottomRight.value,
  customFonts: customFonts.value,
  selectedFontId: selectedFontId.value,
  customFontRuntimeAvailable: isCustomFontRuntimeAvailable.value,
  customFontLoading: isLoadingCustomFonts.value,
  customFontMessage: customFontError.value,
  creationMode: creationMode.value,
  galleryLayout: galleryLayout.value,
  galleryCount: imageCount.value,
  galleryTitle: workTitle.value,
  galleryImage: activeGalleryImage.value,
  galleryImageIndex: activeGalleryImageIndex.value,
  hasCoverDesign: Boolean(currentWork.value?.coverDesign),
  publish: publishPlan,
}));

const inspectorEvents = {
  export: exportCurrentPage,
  "export-to-library": exportToAssetLibrary,
  "select-format": (value) => {
    selectedFormat.value = value;
  },
  "select-platform": (value) => {
    selectedPlatformName.value = value;
  },
  "set-active-tab": (value) => {
    activeTab.value = value;
  },
  "set-scale": (value) => {
    scale.value = value;
  },
  "toggle-solid-background": () => {
    solidBackground.value = !solidBackground.value;
  },
  "toggle-transparent-background": () => {
    transparentBackground.value = !transparentBackground.value;
  },
  "set-background-color": (value) => {
    backgroundColor.value = value;
  },
  "set-export-path": (value) => {
    exportPath.value = value;
  },
  "set-custom-width": setCustomWidth,
  "set-custom-height": setCustomHeight,
  "set-custom-dimensions": (...args) => setCustomDimensions(...args),
  "swap-dimensions": swapDimensions,
  "set-pagination-mode": setPaginationMode,
  "set-custom-delimiter": setCustomDelimiter,
  "set-max-page-length": setMaxPageLength,
  "set-background-type": setBackgroundType,
  "set-background-value": setBackgroundValue,
  "import-font": importCustomFont,
  "select-font": selectCustomFont,
  "select-gallery-font": selectCustomFont,
  "delete-font": deleteCustomFont,
  "update-global-meta": updateGlobalMeta,
  "update:showPageNumber": (value) => {
    showPageNumber.value = value;
  },
  "update:showTopLeft": (value) => {
    showTopLeft.value = value;
  },
  "update:showTopRight": (value) => {
    showTopRight.value = value;
  },
  "update:showBottomLeft": (value) => {
    showBottomLeft.value = value;
  },
  "update:showBottomRight": (value) => {
    showBottomRight.value = value;
  },
  "update-gallery-layout": handleGalleryLayout,
  "update-gallery-title": handleGalleryTitle,
  "update-gallery-overlay": handleGalleryOverlay,
  "add-gallery-images": openAssetPicker,
  "open-asset-library": openAssetManager,
  "open-cover-studio": openCoverStudio,
  "open-publish-center": () => setWorkspace("publish"),
};

function handleResize() {
  viewportWidth.value = window.innerWidth;
}

function isInputFocused(e) {
  const target = e.target;
  if (!target) return false;
  const tagName = target.tagName?.toUpperCase();
  if (tagName === "INPUT" || tagName === "TEXTAREA" || target.isContentEditable) {
    if (target.classList?.contains("cm-content") || target.closest(".cm-editor")) {
      return true;
    }
    return true;
  }
  return false;
}

function handleGlobalKeydown(e) {
  const isMod = e.metaKey || e.ctrlKey;
  if (!isMod) return;

  const key = e.key.toLowerCase();

  if (["1", "2", "3", "4"].includes(key) && !e.shiftKey && !e.altKey) {
    e.preventDefault();
    setWorkspace({ 1: "create", 2: "publish", 3: "assets", 4: "ops" }[key]);
    return;
  }

  if (key === "z" && !e.shiftKey) {
    if (isInputFocused(e)) return;
    e.preventDefault();
    undo();
    return;
  }

  if ((key === "z" && e.shiftKey) || key === "y") {
    if (isInputFocused(e)) return;
    e.preventDefault();
    redo();
    return;
  }
}

function handleBeforeUnload(event) {
  event.preventDefault();
  event.returnValue = "";
}

function requestApplicationClose() {
  closeDialogOpen.value = true;
}

function cancelApplicationClose() {
  closeDialogOpen.value = false;
}

async function confirmApplicationClose() {
  if (isClosingApplication.value) return;

  isClosingApplication.value = true;
  try {
    await invoke("exit_application");
  } catch (error) {
    console.error("Failed to close the application:", error);
    isClosingApplication.value = false;
  }
}

function openLeftDrawer() {
  rightDrawerOpen.value = false;
  leftDrawerOpen.value = true;
}

function openRightDrawer() {
  leftDrawerOpen.value = false;
  rightDrawerOpen.value = true;
}

watch([leftSidebarDocked, rightSidebarDocked], ([leftDocked, rightDocked]) => {
  if (leftDocked) {
    leftDrawerOpen.value = false;
  }

  if (rightDocked) {
    rightDrawerOpen.value = false;
  }
});

const { checkForUpdates } = useUpdater();

onMounted(async () => {
  handleResize();
  syncGalleryUsage();
  window.addEventListener("resize", handleResize);
  window.addEventListener("keydown", handleGlobalKeydown);

  setTimeout(() => {
    checkForUpdates(true);
  }, 2000);

  if (!isTauri()) {
    window.addEventListener("beforeunload", handleBeforeUnload);
    return;
  }

  const appWindow = getCurrentWindow();
  const [removeCloseRequested, removeExitRequested] = await Promise.all([
    appWindow.onCloseRequested((event) => {
      event.preventDefault();
      requestApplicationClose();
    }),
    appWindow.listen("app-exit-requested", requestApplicationClose),
  ]);

  if (appIsUnmounted) {
    removeCloseRequested();
    removeExitRequested();
    return;
  }

  removeCloseRequestedListener = removeCloseRequested;
  removeExitRequestedListener = removeExitRequested;
});

onBeforeUnmount(() => {
  appIsUnmounted = true;
  if (workSyncTimer) clearTimeout(workSyncTimer);
  window.removeEventListener("resize", handleResize);
  window.removeEventListener("keydown", handleGlobalKeydown);
  window.removeEventListener("beforeunload", handleBeforeUnload);
  removeCloseRequestedListener?.();
  removeExitRequestedListener?.();
});
</script>

<template>
  <div
    class="flex h-screen min-h-0 min-w-0 flex-col overflow-hidden border border-slate-200 dark:border-slate-800 bg-[radial-gradient(circle_at_52%_34%,rgba(255,244,223,0.72),transparent_24rem),linear-gradient(180deg,#fbfcff_0%,#f2f5fb_100%)] dark:bg-[radial-gradient(circle_at_52%_34%,rgba(30,27,75,0.45),transparent_24rem),linear-gradient(180deg,#090d16_0%,#0f172a_100%)] text-slate-900 dark:text-slate-100 transition-colors duration-200">
    <AppTitlebar
      :active-workspace="activeWorkspace"
      @open-settings="settingsDialogOpen = true"
      @select-workspace="setWorkspace"
    />
    <AppToolbar
      :selected-theme="selectedTheme"
      :is-dark-mode="isDarkMode"
      :can-undo="canUndo"
      :can-redo="canRedo"
      :is-exporting="isExporting"
      :export-action="exportAction"
      :active-workspace="activeWorkspace"
      :creation-mode="creationMode"
      @export="exportCurrentPage"
      @new-document="handleNewDocument"
      @open-markdown="openDocumentFromDialog"
      @save-markdown="saveDocument"
      @open-settings="settingsDialogOpen = true"
      @select-theme="selectedTheme = $event"
      @toggle-dark-mode="toggleDarkMode"
      @undo="undo"
      @redo="redo"
      @select-creation-mode="handleSelectCreationMode"
      @open-asset-library="openAssetManager"
      @open-sticker-picker="openStickerPicker"
    />

    <main v-if="activeWorkspace === 'create'" class="relative grid min-h-0 min-w-0 flex-1 overflow-hidden transition-[grid-template-columns] duration-200"
      :style="layoutStyle">
      <MarkdownEditor
        v-if="creationMode === 'write' && leftSidebarDocked"
        class="min-h-0 min-w-0"
        v-model="markdownSource"
        :line-count="lineCount"
        :document-path="sourcePath"
        :is-dirty="isDirty"
        :loading="isLoadingDocument"
        :word-count="wordCount"
        @open-markdown="openDocumentFromDialog"
        @open-markdown-content="loadDocumentFromContent"
        @save-markdown="saveDocument"
        @undo="undo"
        @redo="redo"
      />

      <GallerySequencePanel
        v-else-if="creationMode === 'gallery' && leftSidebarDocked"
        class="min-h-0 min-w-0"
        :work="currentWork"
        :active-index="activeGalleryImageIndex"
        :cover-active="Boolean(currentWork?.coverDesign) && activePageIndex === 0"
        :get-thumb="assetLibrary.getThumbUrl"
        :is-desktop="assetLibrary.isDesktop.value"
        @add-images="openAssetPicker"
        @remove-image="handleRemoveGalleryImage"
        @move-image="handleMovePage"
        @set-cover="handleSetGalleryCover"
        @select-image="handleGalleryImageSelect"
        @open-cover-studio="openCoverStudio"
        @remove-cover="handleRemoveCoverDesign"
      />

      <template v-if="creationMode !== 'poster'">
        <PreviewPanel ref="previewPanelRef" class="min-h-0 min-w-0" :active-page="selectedPage"
          :active-page-index="activePageIndex" :can-go-next="canGoNext" :can-go-previous="canGoPrevious"
          :canvas-ratio="canvasRatio" :selected-platform="selectedPlatform" :pages="pages" :selected-theme-class="selectedThemeClass" :zoom="zoom"
          :transparent-background="transparentBackground" :background-color="backgroundColor"
          :background-type="backgroundType" :background-value="backgroundValue"
          :show-page-number="showPageNumber"
          :show-top-left="showTopLeft"
          :show-top-right="showTopRight"
          :show-bottom-left="showBottomLeft"
          :show-bottom-right="showBottomRight"
          :custom-font-family="customFontFamily"
          @add-page="handleAddPage" @delete-page="handleDeletePage" @move-page="handleMovePage" @next-page="nextPage"
          @previous-page="previousPage" @select-page="selectPage" @set-zoom="setZoom" />

        <InspectorPanel
          v-if="rightSidebarDocked"
          class="min-h-0 min-w-0"
          v-bind="inspectorProps"
          v-on="inspectorEvents"
        />

        <button v-if="showLeftDrawerToggle" type="button" class="sidebar-hint left-sidebar-hint"
          :aria-label="creationMode === 'gallery' ? $t('gallery.title') : $t('editor.title')" @click="openLeftDrawer">
          <span class="sidebar-hint__icon">
            <AppIcon name="panel-left-open" :size="15" />
          </span>
          <span class="sidebar-hint__label">{{ creationMode === "gallery" ? $t("gallery.title") : $t("sidebar.editor") }}</span>
        </button>

        <button v-if="showRightDrawerToggle" type="button" class="sidebar-hint right-sidebar-hint" :aria-label="$t('publish.title')"
          @click="openRightDrawer">
          <span class="sidebar-hint__icon">
            <AppIcon name="panel-right-open" :size="15" />
          </span>
          <span class="sidebar-hint__label">{{ $t("sidebar.publish") }}</span>
        </button>
      </template>

      <CreationModePlaceholder
        v-else
        mode="poster"
        @switch-write="setCreationMode('write')"
      />
    </main>

    <main v-else class="relative flex min-h-0 min-w-0 flex-1 overflow-hidden p-3">
      <PublishWorkspace
        v-if="activeWorkspace === 'publish'"
        :publish="publishPlan"
        :bundle="publishBundle"
        :history="publishHistory"
        :is-tauri="runtimeIsTauri"
        @quick-publish="openPublishDialog"
        @select-channel="publishPlan.selectChannel"
        @goto-create="backToCreation"
        @apply-action="handlePublishAction"
      />
      <AssetsWorkspace
        v-else-if="activeWorkspace === 'assets'"
        :library="assetLibrary"
        :work-title="workTitle"
        @add-to-gallery="handleWorkspaceAddToGallery"
        @insert="handleWorkspaceInsert"
      />
      <OpsWorkspace v-else :library="assetLibrary" :history="publishHistory" />
    </main>

    <teleport to="body">
      <div v-if="leftDrawerOpen && !leftSidebarDocked" class="fixed inset-0 z-40 bg-slate-900/18 backdrop-blur-[2px]"
        @click="leftDrawerOpen = false"></div>
      <div v-if="leftDrawerOpen && !leftSidebarDocked"
        class="fixed inset-y-0 left-0 z-50 h-screen w-[min(386px,88vw)] p-3">
        <MarkdownEditor
          v-if="creationMode === 'write'"
          class="h-full min-h-0 min-w-0"
          v-model="markdownSource"
          :line-count="lineCount"
          :document-path="sourcePath"
          :is-dirty="isDirty"
          :loading="isLoadingDocument"
          :word-count="wordCount"
          @open-markdown="openDocumentFromDialog"
          @open-markdown-content="loadDocumentFromContent"
          @save-markdown="saveDocument"
          @undo="undo"
          @redo="redo"
        />
        <GallerySequencePanel
          v-else
          class="h-full min-h-0 min-w-0"
          :work="currentWork"
          :active-index="activeGalleryImageIndex"
          :cover-active="Boolean(currentWork?.coverDesign) && activePageIndex === 0"
          :get-thumb="assetLibrary.getThumbUrl"
          :is-desktop="assetLibrary.isDesktop.value"
          @add-images="openAssetPicker"
          @remove-image="handleRemoveGalleryImage"
          @move-image="handleMovePage"
          @set-cover="handleSetGalleryCover"
          @select-image="handleGalleryImageSelect"
          @open-cover-studio="openCoverStudio"
          @remove-cover="handleRemoveCoverDesign"
        />
      </div>

      <div v-if="rightDrawerOpen && !rightSidebarDocked" class="fixed inset-0 z-40 bg-slate-900/18 backdrop-blur-[2px]"
        @click="rightDrawerOpen = false"></div>
      <div v-if="rightDrawerOpen && !rightSidebarDocked"
        class="fixed inset-y-0 right-0 z-50 h-screen w-[min(340px,88vw)] p-3">
        <InspectorPanel
          class="h-full min-h-0 min-w-0"
          v-bind="inspectorProps"
          v-on="inspectorEvents"
        />
      </div>
    </teleport>

    <AppCloseConfirmDialog
      :open="closeDialogOpen"
      :closing="isClosingApplication"
      @cancel="cancelApplicationClose"
      @confirm="confirmApplicationClose"
    />
    <AppSettingsDialog :open="settingsDialogOpen" @close="settingsDialogOpen = false" />
    <AssetLibraryBrowser
      v-if="activeWorkspace !== 'assets'"
      :open="assetLibraryOpen"
      :picker-mode="assetPickerMode"
      :library="assetLibrary"
      :work-title="workTitle"
      @close="closeAssetDialog"
      @insert="handleAssetInsert"
      @pick="handleAssetPick"
    />
    <CoverStudioDialog
      :open="coverStudioOpen"
      :work="currentWork"
      :theme-color="coverTheme.color"
      accent-color="#f59e0b"
      :default-subtitle="t('cover.defaultSubtitle')"
      :date="coverDate"
      @close="closeCoverStudio"
      @save="handleCoverSave"
    />
    <PublishDialog
      :open="publishDialogOpen"
      :publish="publishPlan"
      :bundle="publishBundle"
      :history="publishHistory"
      :export-path="exportPath"
      @close="publishDialogOpen = false"
      @switch-canvas="applyChannelCanvas"
      @goto-create="backToCreation"
    />
    <StickerPickerDialog
      :open="stickerPickerOpen"
      :model-value="coverStickerSelection"
      @update:model-value="setCoverStickerSelection"
      @close="closeStickerPicker"
    />
    <AppUpdateDialog />
    <AppStatusbar
      :canvas-size-label="canvasSizeLabel"
      :pages-length="pages.length"
      :asset-count="assetLibrary.activeAssets.value.length"
      :auto-save-status="autoSaveStatus"
      :export-message="exportMessage"
      :is-exporting="isExporting"
    />
  </div>
</template>

<style scoped>
.sidebar-hint {
  position: absolute;
  top: 50%;
  z-index: 20;
  display: inline-flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  min-height: 96px;
  width: 38px;
  padding: 10px 6px;
  border: 1px solid rgba(226, 232, 240, 0.9);
  background: rgba(255, 255, 255, 0.88);
  box-shadow: 0 12px 24px rgba(30, 42, 62, 0.08);
  transform: translateY(-50%);
  transition:
    background 160ms ease,
    box-shadow 160ms ease,
    transform 160ms ease;
}

.sidebar-hint:hover {
  background: rgba(255, 255, 255, 0.98);
  box-shadow: 0 16px 30px rgba(30, 42, 62, 0.12);
}

.dark .sidebar-hint {
  border-color: rgba(51, 65, 85, 0.8);
  background: rgba(30, 41, 59, 0.92);
}

.dark .sidebar-hint:hover {
  background: rgba(51, 65, 85, 0.95);
}

.left-sidebar-hint {
  left: 0;
  border-left: 0;
  border-radius: 0 14px 14px 0;
}

.right-sidebar-hint {
  right: 0;
  border-right: 0;
  border-radius: 14px 0 0 14px;
}

.sidebar-hint__label {
  writing-mode: vertical-rl;
  font-size: 12px;
  font-weight: 600;
  color: #334155;
  white-space: nowrap;
}

.dark .sidebar-hint__label {
  color: #cbd5e1;
}

.sidebar-hint__icon {
  display: inline-grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 10px;
  background: #f8fafc;
  color: #4f46e5;
}

.dark .sidebar-hint__icon {
  background: #0f172a;
  color: #818cf8;
}

@media (max-width: 640px) {
  .sidebar-hint {
    top: auto;
    bottom: 96px;
    min-height: 86px;
    width: 34px;
    padding: 8px 5px;
    transform: none;
  }

  .sidebar-hint__label {
    font-size: 11px;
  }

  .sidebar-hint__icon {
    width: 26px;
    height: 26px;
  }
}
</style>
