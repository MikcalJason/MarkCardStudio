<script setup>
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import AppIcon from "../AppIcon.vue";
import AssetCard from "./AssetCard.vue";
import AssetDetail from "./AssetDetail.vue";
import AssetFolderTree from "./AssetFolderTree.vue";
import AssetThumbnail from "./AssetThumbnail.vue";
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

async function handleArchive(asset) {
  if (asset.deletedAt) {
    props.library.restoreAsset(asset.assetId);
    return;
  }
  let result = await props.library.archiveAsset(asset.assetId);
  if (result.blocked) {
    const confirmed = window.confirm(
      t("assets.archiveBlocked", { count: result.usage?.length || 0 }),
    );
    if (!confirmed) return;
    result = await props.library.archiveAsset(asset.assetId, { force: true });
  }
}

async function handlePurge(asset) {
  let result = await props.library.purgeAsset(asset.assetId);
  if (result.blocked) {
    const confirmed = window.confirm(
      t("assets.purgeBlocked", { count: result.usage?.length || 0 }),
    );
    if (!confirmed) return;
    result = await props.library.purgeAsset(asset.assetId, { force: true });
  }
  if (result.ok) {
    activeId.value = "";
    previewUrl.value = "";
  }
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
            <AssetFolderTree class="min-h-0 flex-1" :library="library" />
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

              <p v-if="library.importMessage.value" class="mt-2 flex items-center gap-1.5 text-xs font-medium text-emerald-700 dark:text-emerald-400">
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
  </Teleport>
</template>
