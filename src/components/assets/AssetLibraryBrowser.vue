<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import AppIcon from "../AppIcon.vue";
import AssetCard from "./AssetCard.vue";
import AssetDetail from "./AssetDetail.vue";
import AssetFolderTree from "./AssetFolderTree.vue";
import AssetThumbnail from "./AssetThumbnail.vue";
import ConfirmDialog from "../ConfirmDialog.vue";
import ImageEditorDialog from "./ImageEditorDialog.vue";
import LibrarySelect from "./LibrarySelect.vue";
import { formatBytes } from "../../utils/imageFiles.js";

const PAGE_SIZE = 96;

const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
  pickerMode: {
    type: Boolean,
    default: false,
  },
  embedded: {
    type: Boolean,
    default: false,
  },
  library: {
    type: Object,
    required: true,
  },
  workTitle: {
    type: String,
    default: "",
  },
});

const emit = defineEmits(["close", "insert", "pick", "add-to-gallery"]);
const { t } = useI18n();

const viewMode = ref("grid");
const activeId = ref("");
const previewUrl = ref("");
const browserInput = ref(null);
const editingAsset = ref(null);
const sentinel = ref(null);
// Rendering every card costs DOM and an IntersectionObserver each, so long
// folders load as the user scrolls instead of all at once.
const visibleCount = ref(PAGE_SIZE);
let previewRequest = 0;

const activeAsset = computed(() =>
  props.library.assets.value.find((asset) => asset.assetId === activeId.value) || null,
);
const selectedAssets = computed(() => props.library.selectedAssets.value);
const filterSources = ["all", "import", "generated", "export"];
const usageOptions = computed(() => [
  { value: "all", label: t("assets.filters.usageAll") },
  { value: "used", label: t("assets.filters.used") },
  { value: "unused", label: t("assets.filters.unused") },
]);
const sourceOptions = computed(() =>
  filterSources.map((source) => ({
    value: source,
    label: source === "all" ? t("assets.filters.sourceAll") : t(`assets.sources.${source}`),
  })),
);
const tagOptions = computed(() => [
  { value: "", label: t("assets.filters.tagAll") },
  ...props.library.allTags.value.map((tag) => ({ value: tag, label: tag })),
]);
const staleRoots = computed(() => props.library.staleRoots.value);
const visibleAssets = computed(() => props.library.filteredAssets.value.slice(0, visibleCount.value));
// The management surface sends either the explicit selection or whatever card is
// open, so the primary action is never dead after a single click.
const galleryTarget = computed(() => {
  if (selectedAssets.value.length) return selectedAssets.value;
  return activeAsset.value && !activeAsset.value.deletedAt ? [activeAsset.value] : [];
});

const sortKey = computed(() => {
  const value = props.library.sort.value;
  return value === "newest" || value === "oldest" ? "time" : value.split("-")[0];
});
const sortAscending = computed(() => {
  const value = props.library.sort.value;
  if (value === "oldest") return true;
  if (value === "newest") return false;
  return value.endsWith("-asc");
});
const hasActiveFilters = computed(() =>
  Boolean(
    props.library.query.value.trim()
    || props.library.filters.usage !== "all"
    || props.library.filters.source !== "all"
    || props.library.filters.tag
    || props.library.filters.folder
    || props.library.filters.trash,
  ),
);

const filteredCount = computed(() => props.library.filteredAssets.value.length);
const selectedSet = computed(() => new Set(props.library.selectedIds.value));
const selectedInFilter = computed(() =>
  props.library.filteredAssets.value.reduce(
    (count, asset) => count + (selectedSet.value.has(asset.assetId) ? 1 : 0),
    0,
  ),
);
const allFilteredSelected = computed(
  () => filteredCount.value > 0 && selectedInFilter.value === filteredCount.value,
);
const someFilteredSelected = computed(
  () => selectedInFilter.value > 0 && !allFilteredSelected.value,
);

function toggleSelectAll() {
  if (allFilteredSelected.value) props.library.clearSelection();
  else props.library.selectAllVisible();
}

function changeSortKey(key) {
  if (key === "time") props.library.setSort("newest");
  else if (key === "name") props.library.setSort("name-asc");
  else props.library.setSort(`${key}-desc`);
}

function toggleSortDirection() {
  const key = sortKey.value;
  if (key === "time") {
    props.library.setSort(props.library.sort.value === "newest" ? "oldest" : "newest");
    return;
  }
  props.library.setSort(`${key}-${sortAscending.value ? "desc" : "asc"}`);
}

function clearFilters() {
  props.library.resetFilters();
}

async function handleRescanAll() {
  await props.library.rescanAllRoots();
}

async function handleScanFolder() {
  await props.library.scanFolder();
}

function openDialog() {
  props.library.error.value = "";
  const first = props.library.selectedAssets.value[0] || props.library.filteredAssets.value[0];
  if (!first) return;
  if (props.pickerMode) previewAsset(first);
  else selectAsset(first);
}

watch(
  () => props.open,
  (open) => {
    if (open) openDialog();
    else previewUrl.value = "";
  },
  // The embedded surface mounts already open, so it still needs its first
  // selection instead of waiting for the filtered set to change.
  { immediate: true },
);

watch(
  () => props.library.filteredAssets.value.map((asset) => asset.assetId).join(","),
  () => {
    visibleCount.value = PAGE_SIZE;
    const activeIsVisible = props.library.filteredAssets.value.some(
      (asset) => asset.assetId === activeId.value,
    );
    if (activeIsVisible) return;
    const first = props.library.filteredAssets.value[0];
    if (first) {
      previewAsset(first);
    } else {
      activeId.value = "";
      previewUrl.value = "";
    }
  },
);

let sentinelObserver = null;

function loadMore() {
  visibleCount.value += PAGE_SIZE;
}

watch(sentinel, (node) => {
  sentinelObserver?.disconnect();
  sentinelObserver = null;
  if (!node || typeof IntersectionObserver === "undefined") return;
  sentinelObserver = new IntersectionObserver((entries) => {
    if (!entries.some((entry) => entry.isIntersecting)) return;
    loadMore();
  });
  sentinelObserver.observe(node);
});

onBeforeUnmount(() => sentinelObserver?.disconnect());

async function previewAsset(asset) {
  if (!asset) return;
  activeId.value = asset.assetId;
  await loadPreview(asset.assetId);
}

async function selectAsset(asset) {
  if (!asset) return;
  props.library.selectOnly(asset.assetId);
  await previewAsset(asset);
}

async function loadPreview(assetId) {
  const version = ++previewRequest;
  previewUrl.value = "";
  const url = await props.library.getAssetDataUrl(assetId);
  if (version === previewRequest) previewUrl.value = url;
}

async function refreshPreview() {
  if (activeAsset.value) await loadPreview(activeAsset.value.assetId);
}

function handleToggle(asset) {
  props.library.toggleSelection(asset.assetId);
  if (props.library.selectedIds.value.includes(asset.assetId)) {
    activeId.value = asset.assetId;
    loadPreview(asset.assetId);
  }
}

function handlePick(assetOrAssets) {
  const list = Array.isArray(assetOrAssets) ? assetOrAssets : [assetOrAssets];
  if (!list.length) return;
  emit("pick", list.filter(Boolean));
}

function pickSelected() {
  handlePick(selectedAssets.value);
}

async function handleImport() {
  try {
    if (props.library.isDesktop.value) {
      await props.library.openNativePicker();
    } else {
      browserInput.value?.click();
    }
  } catch (error) {
    props.library.error.value = error?.message || String(error);
  }
}

async function handleBrowserFiles(event) {
  const files = event.target.files;
  try {
    if (files?.length) await props.library.importFiles(files);
  } catch (error) {
    props.library.error.value = error?.message || String(error);
  } finally {
    event.target.value = "";
  }
}

const confirmRequest = ref(null);
const confirmBusy = ref(false);
const actionMessage = ref("");
const detachRequest = ref(null);
const detachArchive = ref(false);
const detachBusy = ref(false);
const batchTagsOpen = ref(false);
const batchTagsInput = ref("");

const batchTagSuggestions = computed(() => {
  const typed = new Set(
    batchTagsInput.value
      .split(/[,，]/)
      .map((tag) => tag.trim())
      .filter(Boolean),
  );
  return props.library.allTags.value.filter((tag) => !typed.has(tag)).slice(0, 12);
});

function askConfirm(options) {
  confirmRequest.value = options;
}

async function runConfirm() {
  const request = confirmRequest.value;
  if (!request) return;
  confirmBusy.value = true;
  try {
    await request.run();
  } finally {
    confirmBusy.value = false;
    // A blocked action replaces the request with its force-confirm follow-up;
    // only close the dialog when nothing re-opened it.
    if (confirmRequest.value === request) confirmRequest.value = null;
  }
}

function flashActionMessage(message) {
  actionMessage.value = message;
  props.library.importMessage.value = "";
}

function handleDetachRequest(payload) {
  detachArchive.value = false;
  detachRequest.value = payload;
}

function runDetach() {
  const request = detachRequest.value;
  if (!request) return;
  detachBusy.value = true;
  try {
    const result = props.library.detachRoot(request.root.rootId, { archive: detachArchive.value });
    const parts = [t("assets.detachDone", { label: request.root.label })];
    if (result.archived) parts.push(t("assets.detachArchived", { count: result.archived }));
    if (result.keptInUse) parts.push(t("assets.detachKeptInUse", { count: result.keptInUse }));
    flashActionMessage(parts.join(" · "));
    detachRequest.value = null;
  } finally {
    detachBusy.value = false;
  }
}

async function handleArchive(asset) {
  if (asset.deletedAt) {
    props.library.restoreAsset(asset.assetId);
    return;
  }
  const result = await props.library.archiveAsset(asset.assetId);
  if (!result.blocked) return;
  askConfirm({
    title: t("assets.archive"),
    description: t("assets.archiveBlocked", { count: result.usage?.length || 0 }),
    confirmLabel: t("assets.archive"),
    tone: "danger",
    icon: "trash-2",
    run: () => props.library.archiveAsset(asset.assetId, { force: true }),
  });
}

async function handlePurge(asset) {
  const result = await props.library.purgeAsset(asset.assetId);
  if (result.blocked) {
    askConfirm({
      title: t("assets.deleteForever"),
      description: t("assets.purgeBlocked", { count: result.usage?.length || 0 }),
      confirmLabel: t("assets.deleteForever"),
      tone: "danger",
      icon: "trash-2",
      run: async () => {
        const forced = await props.library.purgeAsset(asset.assetId, { force: true });
        if (forced.ok) {
          activeId.value = "";
          previewUrl.value = "";
        }
      },
    });
    return;
  }
  if (result.ok) {
    activeId.value = "";
    previewUrl.value = "";
  }
}

function openBatchTags() {
  batchTagsInput.value = "";
  batchTagsOpen.value = true;
}

function applyBatchTags() {
  const tags = batchTagsInput.value
    .split(/[,，]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
  if (!tags.length) return;
  const count = props.library.addTagsToAssets(
    selectedAssets.value.map((asset) => asset.assetId),
    tags,
  );
  batchTagsOpen.value = false;
  flashActionMessage(t("assets.batchTagsDone", { count }));
}

function handleBatchArchive() {
  const ids = selectedAssets.value.map((asset) => asset.assetId);
  askConfirm({
    title: t("assets.batchArchiveTitle", { count: ids.length }),
    description: t("assets.batchArchiveDesc"),
    confirmLabel: t("assets.archive"),
    tone: "danger",
    icon: "trash-2",
    run: async () => {
      let result = await props.library.archiveAssets(ids);
      if (result.blocked) {
        askConfirm({
          title: t("assets.batchArchiveTitle", { count: ids.length }),
          description: t("assets.batchArchiveBlocked", { count: result.count }),
          confirmLabel: t("assets.archive"),
          tone: "danger",
          icon: "trash-2",
          run: async () => {
            const forced = await props.library.archiveAssets(ids, { force: true });
            flashActionMessage(t("assets.batchArchived", { count: forced.count }));
          },
        });
        return;
      }
      flashActionMessage(t("assets.batchArchived", { count: result.count }));
    },
  });
}

function handleBatchRestore() {
  const count = props.library.restoreAssets(
    selectedAssets.value.map((asset) => asset.assetId),
  );
  flashActionMessage(t("assets.batchRestored", { count }));
}

function handleBatchPurge() {
  const ids = selectedAssets.value.map((asset) => asset.assetId);
  askConfirm({
    title: t("assets.batchPurgeTitle", { count: ids.length }),
    description: t("assets.batchPurgeDesc"),
    confirmLabel: t("assets.deleteForever"),
    tone: "danger",
    icon: "trash-2",
    run: async () => {
      let result = await props.library.purgeAssets(ids);
      if (result.blocked) {
        askConfirm({
          title: t("assets.batchPurgeTitle", { count: ids.length }),
          description: t("assets.batchPurgeBlocked", { count: result.count }),
          confirmLabel: t("assets.deleteForever"),
          tone: "danger",
          icon: "trash-2",
          run: async () => {
            const forced = await props.library.purgeAssets(ids, { force: true });
            if (forced.ok) {
              activeId.value = "";
              previewUrl.value = "";
            }
            flashActionMessage(t("assets.batchPurged", { count: forced.count }));
          },
        });
        return;
      }
      if (result.ok) {
        activeId.value = "";
        previewUrl.value = "";
      }
      flashActionMessage(t("assets.batchPurged", { count: result.count }));
    },
  });
}

function openImageEditor(asset) {
  if (!asset?.assetId) return;
  editingAsset.value = asset;
}

async function handleImageEditorSave(payload) {
  if (!payload?.dataUrl) return;
  try {
    const result = await props.library.importFromDataUrl({
      dataUrl: payload.dataUrl,
      fileName: payload.fileName || "edited-image.png",
      mediaType: payload.mediaType || "image/png",
      sourceKind: "edited",
      derivedFrom: payload.derivedFrom || "",
    });
    editingAsset.value = null;
    if (result.asset) {
      activeId.value = result.asset.assetId;
      props.library.selectOnly(result.asset.assetId);
      await loadPreview(result.asset.assetId);
    }
  } catch (error) {
    props.library.error.value = error?.message || String(error);
  }
}

function handleKeydown(event) {
  if (props.embedded || !props.open || editingAsset.value) return;
  if (event.key === "Escape") {
    event.preventDefault();
    emit("close");
  }
}

onMounted(() => window.addEventListener("keydown", handleKeydown));
onBeforeUnmount(() => window.removeEventListener("keydown", handleKeydown));
</script>

<template>
  <Teleport to="body" :disabled="embedded">
    <div
      v-if="open"
      class="min-h-0 min-w-0"
      :class="embedded
        ? 'flex h-full w-full'
        : 'fixed inset-0 z-dialog flex items-center justify-center bg-slate-900/40 p-3 backdrop-blur-sm sm:p-5'"
      :role="embedded ? null : 'dialog'"
      :aria-modal="embedded ? null : 'true'"
      :aria-label="embedded ? null : t('assets.title')"
      @click.self="embedded ? null : $emit('close')"
    >
      <div
        class="flex min-w-0 flex-col overflow-hidden bg-white dark:bg-slate-900"
        :class="embedded
          ? 'panel-surface h-full w-full rounded-xl'
          : 'h-[min(92vh,940px)] w-[min(97vw,1500px)] rounded-2xl border border-slate-200/90 shadow-2xl dark:border-slate-700/80'"
      >
        <header class="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200/80 px-4 py-3 dark:border-slate-800 sm:px-5">
          <div class="flex min-w-0 items-center gap-2.5">
            <span class="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-300">
              <AppIcon name="image" :size="16" />
            </span>
            <div class="min-w-0">
              <h2 class="truncate text-[15px] font-bold dark:text-slate-100">
                {{ pickerMode ? t("assets.pickerTitle") : t("assets.title") }}
              </h2>
              <p class="truncate text-xs text-slate-500 dark:text-slate-400">
                {{ t("assets.stats", {
                  total: library.stats.value.total,
                  unused: library.stats.value.unused,
                  bytes: formatBytes(library.stats.value.bytes),
                }) }}
              </p>
            </div>
          </div>

          <div class="flex shrink-0 items-center gap-2">
            <input
              ref="browserInput"
              type="file"
              accept="image/*"
              multiple
              class="file-input"
              @change="handleBrowserFiles"
            />
            <button
              v-if="library.isDesktop.value"
              type="button"
              class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
              :disabled="library.isImporting.value"
              :title="t('assets.scanFolderHint')"
              @click="handleScanFolder"
            >
              <AppIcon name="folder-open" :size="14" />
              <span class="hidden 2xl:inline">{{ t("assets.scanFolder") }}</span>
            </button>
            <button
              type="button"
              class="inline-flex h-8 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-xs font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
              :disabled="library.isImporting.value"
              @click="handleImport"
            >
              <AppIcon :name="library.isImporting.value ? 'loader' : 'image-plus'" :size="14" :class="{ 'animate-spin': library.isImporting.value }" />
              <span class="hidden sm:inline">{{ library.isImporting.value ? t("assets.importing") : t("assets.import") }}</span>
            </button>
            <button
              v-if="!embedded"
              type="button"
              class="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
              :aria-label="t('assets.close')"
              :title="t('assets.close')"
              @click="$emit('close')"
            >
              <AppIcon name="x" :size="16" />
            </button>
          </div>
        </header>

        <div class="flex min-h-0 flex-1">
          <aside
            v-if="library.hasAssets.value || library.folderTree.value.length"
            class="w-60 shrink-0 flex-col border-r border-slate-200/80 px-2 py-3 dark:border-slate-800"
            :class="embedded ? 'flex' : 'hidden lg:flex'"
          >
            <AssetFolderTree
              class="min-h-0 flex-1"
              :library="library"
              @detach-request="handleDetachRequest"
            />
          </aside>

          <div class="flex min-w-0 flex-1 flex-col">
            <div class="shrink-0 border-b border-slate-200/80 px-4 py-2.5 dark:border-slate-800">
              <div class="flex flex-wrap items-center gap-2">
                <label class="relative min-w-[190px] flex-1">
                  <AppIcon name="search" :size="14" class="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    v-model="library.query.value"
                    type="search"
                    class="h-8 w-full rounded-lg border border-slate-200 bg-white pl-8 pr-2.5 text-xs text-slate-800 outline-none transition-colors placeholder:text-slate-400 hover:border-slate-300 focus:border-blue-400 focus:ring-2 focus:ring-blue-500/15 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500 dark:hover:border-slate-600"
                    :placeholder="t('assets.searchPlaceholder')"
                  />
                </label>

                <div class="inline-flex h-8 items-center overflow-hidden rounded-lg border border-slate-200 bg-white transition-colors hover:border-slate-300 dark:border-slate-700 dark:bg-slate-800 dark:hover:border-slate-600">
                  <select
                    :value="sortKey"
                    class="h-full cursor-pointer appearance-none bg-transparent pl-2.5 pr-1 text-xs font-medium text-slate-600 outline-none dark:text-slate-300"
                    :aria-label="t('assets.sortBy')"
                    @change="changeSortKey($event.target.value)"
                  >
                    <option value="time">{{ t("assets.sorts.time") }}</option>
                    <option value="name">{{ t("assets.sorts.name") }}</option>
                    <option value="size">{{ t("assets.sorts.size") }}</option>
                    <option value="usage">{{ t("assets.sorts.usage") }}</option>
                  </select>
                  <button
                    type="button"
                    class="grid h-full w-7 place-items-center border-l border-slate-200 text-slate-500 transition-colors hover:bg-slate-50 hover:text-slate-700 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-slate-200"
                    :aria-label="sortAscending ? t('assets.sortDesc') : t('assets.sortAsc')"
                    :title="sortAscending ? t('assets.sortDesc') : t('assets.sortAsc')"
                    @click="toggleSortDirection"
                  >
                    <AppIcon :name="sortAscending ? 'arrow-up' : 'arrow-down'" :size="14" />
                  </button>
                </div>

                <LibrarySelect
                  :model-value="library.filters.usage"
                  :options="usageOptions"
                  :aria-label="t('assets.filterUsage')"
                  @update:model-value="library.setFilter('usage', $event)"
                />

                <span class="hidden sm:inline-flex">
                  <LibrarySelect
                    :model-value="library.filters.source"
                    :options="sourceOptions"
                    :aria-label="t('assets.filterSource')"
                    @update:model-value="library.setFilter('source', $event)"
                  />
                </span>

                <LibrarySelect
                  v-if="library.allTags.value.length"
                  :model-value="library.filters.tag"
                  :options="tagOptions"
                  :aria-label="t('assets.filterTag')"
                  @update:model-value="library.setFilter('tag', $event)"
                />

                <button
                  type="button"
                  class="inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition-colors"
                  :class="library.filters.trash
                    ? 'border-blue-300 bg-blue-50 text-blue-700 dark:border-blue-500/60 dark:bg-blue-950/40 dark:text-blue-300'
                    : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'"
                  :aria-pressed="library.filters.trash"
                  @click="library.setFilter('trash', !library.filters.trash)"
                >
                  <AppIcon name="trash-2" :size="13" />
                  {{ t("assets.trash") }}
                </button>

                <label
                  class="ml-auto inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                  :class="{ 'cursor-not-allowed opacity-50': !filteredCount }"
                  :title="t('assets.selectAllHint')"
                >
                  <input
                    type="checkbox"
                    class="h-3.5 w-3.5 accent-blue-600"
                    :checked="allFilteredSelected"
                    :indeterminate.prop="someFilteredSelected"
                    :disabled="!filteredCount"
                    @change="toggleSelectAll"
                  />
                  {{ t("assets.selectAll") }}
                </label>

                <div class="inline-flex h-8 items-center rounded-lg border border-slate-200 bg-slate-100/80 p-0.5 dark:border-slate-700 dark:bg-slate-800">
                  <button
                    type="button"
                    class="grid h-7 w-7 place-items-center rounded-md transition-colors"
                    :class="viewMode === 'grid' ? 'bg-white text-blue-600 shadow-sm dark:bg-slate-700 dark:text-blue-300' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'"
                    :aria-label="t('assets.gridView')"
                    :aria-pressed="viewMode === 'grid'"
                    @click="viewMode = 'grid'"
                  >
                    <AppIcon name="layout-grid" :size="14" />
                  </button>
                  <button
                    type="button"
                    class="grid h-7 w-7 place-items-center rounded-md transition-colors"
                    :class="viewMode === 'list' ? 'bg-white text-blue-600 shadow-sm dark:bg-slate-700 dark:text-blue-300' : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'"
                    :aria-label="t('assets.listView')"
                    :aria-pressed="viewMode === 'list'"
                    @click="viewMode = 'list'"
                  >
                    <AppIcon name="list" :size="14" />
                  </button>
                </div>
              </div>

              <p v-if="actionMessage" class="mt-2 flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                <AppIcon name="check-circle" :size="13" class="shrink-0" />
                {{ actionMessage }}
              </p>
              <p v-else-if="library.importMessage.value" class="mt-2 flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
                <AppIcon name="check-circle" :size="13" class="shrink-0" />
                {{ library.importMessage.value }}
              </p>
              <p v-else-if="library.error.value" class="mt-2 flex items-center gap-1.5 text-xs font-medium text-rose-700 dark:text-rose-400">
                <AppIcon name="alert-circle" :size="13" class="shrink-0" />
                {{ library.error.value }}
              </p>

              <div
                v-if="staleRoots.length && !library.isImporting.value"
                class="mt-2 flex flex-wrap items-center gap-2 rounded-lg border border-amber-200/90 bg-amber-50/70 px-2.5 py-2 text-xs font-semibold text-amber-800 dark:border-amber-900/70 dark:bg-amber-950/40 dark:text-amber-300"
              >
                <AppIcon name="refresh-cw" :size="13" class="shrink-0" />
                <span>{{ t("assets.staleBar", { count: staleRoots.length }) }}</span>
                <button
                  type="button"
                  class="ml-auto inline-flex h-7 items-center gap-1.5 rounded-md bg-amber-600 px-2.5 text-[11px] font-bold text-white transition-colors hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50"
                  :disabled="!library.isDesktop.value || library.isImporting.value"
                  :title="library.isDesktop.value ? t('assets.rescanAllHint') : t('assets.scanDesktopOnly')"
                  @click="handleRescanAll"
                >
                  {{ t("assets.rescanAll") }}
                </button>
              </div>
            </div>

            <div class="min-h-0 flex-1 overflow-y-auto p-4">
              <div v-if="library.isLoading.value" class="grid place-items-center py-20 text-slate-400">
                <AppIcon name="loader" :size="24" class="animate-spin" />
              </div>

              <div
                v-else-if="!library.filteredAssets.value.length"
                class="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-300/80 bg-slate-50/60 px-6 py-16 text-center dark:border-slate-700/80 dark:bg-slate-800/30"
              >
                <span class="grid h-12 w-12 place-items-center rounded-2xl bg-white text-slate-400 shadow-sm dark:bg-slate-800 dark:text-slate-500">
                  <AppIcon name="image" :size="22" />
                </span>
                <h3 class="mt-3 text-sm font-bold dark:text-slate-100">
                  {{ library.filters.trash
                    ? t("assets.emptyTrash")
                    : hasActiveFilters ? t("assets.emptyFilteredTitle") : t("assets.emptyTitle") }}
                </h3>
                <p class="mt-1 max-w-sm text-xs leading-5 text-slate-500 dark:text-slate-400">
                  {{ library.filters.trash
                    ? t("assets.emptyTrashDesc")
                    : hasActiveFilters ? t("assets.emptyFilteredDesc") : t("assets.emptyDesc") }}
                </p>
                <button
                  v-if="!library.filters.trash && hasActiveFilters"
                  type="button"
                  class="mt-4 inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-bold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                  @click="clearFilters"
                >
                  <AppIcon name="x" :size="14" />
                  {{ t("assets.clearFilters") }}
                </button>
                <button
                  v-else-if="!library.filters.trash"
                  type="button"
                  class="mt-4 inline-flex h-8 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-xs font-bold text-white hover:bg-blue-700"
                  @click="handleImport"
                >
                  <AppIcon name="image-plus" :size="14" />
                  {{ t("assets.import") }}
                </button>
              </div>

              <div v-else-if="viewMode === 'grid'" class="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                <AssetCard
                  v-for="asset in visibleAssets"
                  :key="asset.assetId"
                  :asset="asset"
                  :selected="library.selectedIds.value.includes(asset.assetId)"
                  :picker="pickerMode"
                  :get-thumb="library.getThumbUrl"
                  @open="selectAsset"
                  @toggle="handleToggle"
                  @pick="handlePick"
                />
              </div>

              <div v-else class="overflow-hidden rounded-xl border border-slate-200/90 dark:border-slate-700/80">
                <div class="grid grid-cols-[minmax(0,1fr)_100px_90px_90px_80px] gap-3 border-b border-slate-200/80 bg-slate-50 px-3 py-2 text-[10px] font-bold uppercase tracking-wide text-slate-500 dark:border-slate-700/80 dark:bg-slate-800/60 dark:text-slate-400">
                  <span>{{ t("assets.name") }}</span>
                  <span>{{ t("assets.dimensions") }}</span>
                  <span>{{ t("assets.size") }}</span>
                  <span>{{ t("assets.usage") }}</span>
                  <span></span>
                </div>
                <button
                  v-for="asset in visibleAssets"
                  :key="asset.assetId"
                  type="button"
                  class="grid w-full grid-cols-[minmax(0,1fr)_100px_90px_90px_80px] items-center gap-3 border-b border-slate-100 px-3 py-2 text-left transition hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/60"
                  :class="activeId === asset.assetId ? 'bg-blue-50/60 dark:bg-blue-950/20' : ''"
                  @click="selectAsset(asset)"
                  @dblclick="handlePick(asset)"
                >
                  <span class="flex min-w-0 items-center gap-2">
                    <span class="h-9 w-9 shrink-0 overflow-hidden rounded-md">
                      <AssetThumbnail :asset="asset" :get-thumb="library.getThumbUrl" />
                    </span>
                    <span class="min-w-0">
                      <span class="block truncate text-xs font-semibold text-slate-700 dark:text-slate-200">{{ asset.name || asset.fileName }}</span>
                      <span class="block truncate text-[10px] text-slate-400">{{ asset.fileName }}</span>
                    </span>
                  </span>
                  <span class="text-[11px] text-slate-500 dark:text-slate-400">{{ library.formatDimensions(asset) || "—" }}</span>
                  <span class="text-[11px] text-slate-500 dark:text-slate-400">{{ ((asset.bytes || 0) / 1024).toFixed(0) }} KB</span>
                  <span class="text-[11px] text-slate-500 dark:text-slate-400">{{ asset.usage?.length || 0 }}</span>
                  <span class="flex justify-end">
                    <input
                      type="checkbox"
                      class="h-3.5 w-3.5 accent-blue-600"
                      :checked="library.selectedIds.value.includes(asset.assetId)"
                      @click.stop
                      @change="handleToggle(asset)"
                    />
                  </span>
                </button>
              </div>

              <button
                v-if="visibleAssets.length < library.filteredAssets.value.length"
                ref="sentinel"
                type="button"
                class="grid h-9 place-items-center rounded-lg text-[11px] font-semibold text-slate-500 transition hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
                @click="loadMore"
              >
                {{ t("assets.loadingMore", { count: library.filteredAssets.value.length - visibleAssets.length }) }}
              </button>
            </div>

            <footer class="flex shrink-0 flex-wrap items-center gap-1.5 border-t border-slate-200/80 px-4 py-2.5 dark:border-slate-800">
              <span class="text-xs font-medium text-slate-500 dark:text-slate-400">
                {{ t("assets.selectionSummary", { count: selectedAssets.length, total: library.filteredAssets.value.length }) }}
              </span>
              <button
                v-if="selectedAssets.length"
                type="button"
                class="h-7 rounded-md px-2 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-800 dark:text-slate-300 dark:hover:bg-slate-800 dark:hover:text-slate-100"
                @click="library.clearSelection()"
              >
                {{ t("assets.clearSelection") }}
              </button>

              <template v-if="!pickerMode && selectedAssets.length">
                <button
                  v-if="!library.filters.trash"
                  type="button"
                  class="inline-flex h-7 items-center gap-1.5 rounded-md border border-slate-200 px-2 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                  @click="openBatchTags"
                >
                  <AppIcon name="tag" :size="12" />
                  {{ t("assets.batchTags") }}
                </button>
                <button
                  v-if="!library.filters.trash"
                  type="button"
                  class="inline-flex h-7 items-center gap-1.5 rounded-md border border-slate-200 px-2 text-xs font-semibold text-slate-600 transition-colors hover:bg-red-50 hover:text-red-700 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-red-950/40 dark:hover:text-red-300"
                  @click="handleBatchArchive"
                >
                  <AppIcon name="trash-2" :size="12" />
                  {{ t("assets.archive") }}
                </button>
                <button
                  v-if="library.filters.trash"
                  type="button"
                  class="inline-flex h-7 items-center gap-1.5 rounded-md border border-slate-200 px-2 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                  @click="handleBatchRestore"
                >
                  <AppIcon name="rotate-ccw" :size="12" />
                  {{ t("assets.restore") }}
                </button>
                <button
                  v-if="library.filters.trash"
                  type="button"
                  class="inline-flex h-7 items-center gap-1.5 rounded-md border border-slate-200 px-2 text-xs font-semibold text-slate-600 transition-colors hover:bg-red-50 hover:text-red-700 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-red-950/40 dark:hover:text-red-300"
                  @click="handleBatchPurge"
                >
                  <AppIcon name="trash-2" :size="12" />
                  {{ t("assets.deleteForever") }}
                </button>
              </template>
              <button
                v-if="pickerMode"
                type="button"
                class="ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-xs font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="!selectedAssets.length"
                @click="pickSelected"
              >
                <AppIcon name="plus" :size="14" />
                {{ t("assets.addSelected", { count: selectedAssets.length }) }}
              </button>
              <button
                v-else-if="activeAsset && !activeAsset.deletedAt"
                type="button"
                class="ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 xl:hidden"
                @click="openImageEditor(activeAsset)"
              >
                <AppIcon name="sliders" :size="14" />
                {{ t("assets.editImage") }}
              </button>
              <button
                v-if="!pickerMode && galleryTarget.length"
                type="button"
                class="ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-xs font-bold text-white hover:bg-blue-700"
                :title="t('assets.addToGalleryHint')"
                @click="$emit('add-to-gallery', galleryTarget)"
              >
                <AppIcon name="image-plus" :size="14" />
                {{ t("assets.addToGallery") }}
              </button>
              <button
                v-if="!pickerMode && activeAsset && !activeAsset.deletedAt"
                type="button"
                class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800 xl:hidden"
                @click="$emit('insert', activeAsset)"
              >
                <AppIcon name="file-text" :size="14" />
                {{ t("assets.insertMarkdown") }}
              </button>
            </footer>
          </div>

          <div class="hidden w-[320px] shrink-0 xl:block">
            <AssetDetail
              :asset="activeAsset"
              :preview-url="previewUrl"
              :picker="pickerMode"
              :is-desktop="library.isDesktop.value"
              :work-title="workTitle"
              @insert="$emit('insert', $event)"
              @pick="handlePick"
              @archive="handleArchive"
              @restore="library.restoreAsset($event.assetId)"
              @purge="handlePurge"
              @update-alt="library.setAlt"
              @update-tags="library.setTags"
              @update-rights="library.setRights"
              @refresh-preview="refreshPreview"
              @edit-image="openImageEditor"
            />
          </div>
        </div>
      </div>
    </div>

    <ImageEditorDialog
      :open="Boolean(editingAsset)"
      :asset="editingAsset"
      :get-source="library.getAssetDataUrl"
      @close="editingAsset = null"
      @save="handleImageEditorSave"
    />

    <ConfirmDialog
      :open="Boolean(detachRequest)"
      :title="t('assets.detach')"
      :description="t('assets.detachConfirm')"
      :confirm-label="t('assets.detach')"
      :cancel-label="t('common.cancel')"
      icon="trash-2"
      tone="danger"
      :busy="detachBusy"
      @cancel="detachRequest = null"
      @confirm="runDetach"
    >
      <div v-if="detachRequest" class="mt-3 space-y-2">
        <label class="flex items-start gap-2 text-xs text-slate-600 dark:text-slate-300">
          <input
            v-model="detachArchive"
            type="checkbox"
            class="mt-0.5 h-3.5 w-3.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500/30 dark:border-slate-600 dark:bg-slate-800"
            :disabled="!detachRequest.total"
          />
          <span>
            <span class="font-semibold">
              {{ t("assets.detachArchiveOption", { count: detachRequest.total }) }}
            </span>
            <span class="mt-0.5 block text-[11px] text-slate-500 dark:text-slate-400">
              {{ t("assets.detachArchiveHint") }}
            </span>
            <span v-if="detachRequest.inUse" class="mt-0.5 block text-[11px] text-amber-600 dark:text-amber-400">
              {{ t("assets.detachInUseNote", { count: detachRequest.inUse }) }}
            </span>
          </span>
        </label>
        <p class="truncate text-[10px] text-slate-500 dark:text-slate-400" :title="detachRequest.root.path">
          {{ detachRequest.root.path }}
        </p>
      </div>
    </ConfirmDialog>

    <ConfirmDialog
      :open="Boolean(confirmRequest)"
      :title="confirmRequest?.title || ''"
      :description="confirmRequest?.description || ''"
      :confirm-label="confirmRequest?.confirmLabel || t('common.confirm')"
      :cancel-label="t('common.cancel')"
      :icon="confirmRequest?.icon || 'alert-circle'"
      :tone="confirmRequest?.tone || 'danger'"
      :busy="confirmBusy"
      @cancel="confirmRequest = null"
      @confirm="runConfirm"
    />

    <ConfirmDialog
      :open="batchTagsOpen"
      :title="t('assets.batchTagsTitle', { count: selectedAssets.length })"
      :description="t('assets.batchTagsDesc')"
      :confirm-label="t('assets.batchTagsConfirm')"
      :cancel-label="t('common.cancel')"
      icon="tag"
      tone="default"
      :confirm-disabled="!batchTagsInput.trim()"
      @cancel="batchTagsOpen = false"
      @confirm="applyBatchTags"
    >
      <div class="mt-3 space-y-2">
        <input
          v-model="batchTagsInput"
          type="text"
          class="h-9 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-sm text-slate-800 outline-none transition-colors placeholder:text-slate-400 focus:border-blue-400 focus:ring-2 focus:ring-blue-500/15 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100 dark:placeholder:text-slate-500"
          :placeholder="t('assets.tagsPlaceholder')"
          @keydown.enter.prevent="applyBatchTags"
        />
        <div v-if="batchTagSuggestions.length" class="flex flex-wrap gap-1.5">
          <button
            v-for="tag in batchTagSuggestions"
            :key="tag"
            type="button"
            class="h-6 rounded-full border border-slate-200 px-2.5 text-[11px] font-medium text-slate-600 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700 dark:border-slate-700 dark:text-slate-300 dark:hover:border-blue-500/60 dark:hover:bg-blue-950/40 dark:hover:text-blue-300"
            @click="batchTagsInput = batchTagsInput ? `${batchTagsInput.replace(/[,，]$/, '')}, ${tag}` : tag"
          >
            {{ tag }}
          </button>
        </div>
        <p class="text-[10px] text-slate-500 dark:text-slate-400">{{ t("assets.tagsHint") }}</p>
      </div>
    </ConfirmDialog>
  </Teleport>
</template>
