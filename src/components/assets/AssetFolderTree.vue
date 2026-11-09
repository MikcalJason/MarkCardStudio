<script setup>
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import AppIcon from "../AppIcon.vue";
import AssetFolderRows from "./AssetFolderRows.vue";

const props = defineProps({
  library: {
    type: Object,
    required: true,
  },
});

const emit = defineEmits(["detach-request"]);

const { t } = useI18n();
const collapsedFolders = ref({});

const library = props.library;
const scanProgress = computed(() => library.scanProgress.value);

function collectFolderRows(node, depth, rows) {
  for (const child of node.children) {
    rows.push({
      key: child.key,
      label: child.label,
      count: child.count,
      depth,
      hasChildren: child.children.length > 0,
    });
    if (!collapsedFolders.value[child.key]) collectFolderRows(child, depth + 1, rows);
  }
  return rows;
}

const folderNav = computed(() =>
  library.folderTree.value.map(({ root, node }) => ({
    root,
    key: node.key,
    hasChildren: node.children.length > 0,
    collapsed: Boolean(collapsedFolders.value[node.key]),
    rows: collapsedFolders.value[node.key] ? [] : collectFolderRows(node, 1, []),
  })),
);

const smartCounts = computed(() => {
  let unfiled = 0;
  let missing = 0;
  for (const asset of library.assets.value) {
    if (asset.deletedAt) continue;
    const folders = Array.isArray(asset.folders) ? asset.folders : [];
    const hasSource = Boolean(asset.source?.sourcePath);
    if (!folders.length && !hasSource) {
      unfiled += 1;
      continue;
    }
    if (folders.length && folders.every((entry) => entry.missingSince)) missing += 1;
  }
  return { unfiled, missing };
});

const sourceTree = computed(() => library.sourceTree.value);
const sourceRows = computed(() =>
  collapsedFolders.value[sourceTree.value.key] ? [] : collectFolderRows(sourceTree.value, 1, []),
);

function toggleFolder(key) {
  collapsedFolders.value = { ...collapsedFolders.value, [key]: !collapsedFolders.value[key] };
}

function selectFolder(key) {
  library.setFilter("folder", key);
}

async function handleRescan(rootId) {
  await library.rescanRoot(rootId);
}

async function handleRelocate(rootId) {
  await library.relocateRoot(rootId);
}

function handleDetachRoot(root) {
  emit("detach-request", { root, ...library.assetsUnderRoot(root.rootId) });
}

// Scanned folders the user detached stay here so re-importing is one click
// instead of another trip through the native folder picker.
const unmountedRoots = computed(() => {
  const mounted = new Set(library.roots.value.map((root) => root.rootId));
  const mountedPaths = new Set(library.roots.value.map((root) => root.path));
  return library.recentRoots.value.filter(
    (root) => root.path && !mounted.has(root.rootId) && !mountedPaths.has(root.path),
  );
});

async function handleRemount(rootId) {
  await library.remountRoot(rootId);
}

function handleForget(rootId) {
  library.forgetRoot(rootId);
}
</script>

<template>
  <nav class="flex flex-col overflow-y-auto" :aria-label="t('assets.folderNav')">
    <p class="mb-1 px-2 text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
      {{ t("assets.folderNav") }}
    </p>

    <p
      v-if="scanProgress.active"
      class="mt-2 rounded-lg bg-blue-50 px-2 py-2 text-[11px] font-semibold text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"
    >
      {{ t("assets.scanning", { label: scanProgress.label }) }}
      <span class="mt-1 block h-1 overflow-hidden rounded-full bg-blue-200/70 dark:bg-blue-900/60">
        <span
          class="block h-full rounded-full bg-blue-600 transition-all"
          :style="{ width: `${scanProgress.total ? (scanProgress.current / scanProgress.total) * 100 : 0}%` }"
        ></span>
      </span>
      <span class="mt-0.5 block tabular-nums">{{ scanProgress.current }}/{{ scanProgress.total }}</span>
    </p>

    <button
      v-for="node in [
        { key: '', icon: 'layers', labelKey: 'assets.folderAll', count: library.stats.value.total, tone: 'text-slate-400' },
        { key: 'smart:unfiled', icon: 'archive', labelKey: 'assets.folderUnfiled', count: smartCounts.unfiled, tone: 'text-slate-400' },
        { key: 'smart:missing', icon: 'alert-circle', labelKey: 'assets.folderMissing', count: smartCounts.missing, tone: 'text-amber-500 dark:text-amber-400' },
      ]"
      :key="node.key"
      type="button"
      class="mt-0.5 flex min-h-7 items-center gap-1.5 rounded-md px-2 text-xs transition-colors"
      :class="library.filters.folder === node.key
        ? 'bg-blue-50 font-semibold text-blue-700 dark:bg-blue-950/40 dark:text-blue-300'
        : 'font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'"
      :aria-current="library.filters.folder === node.key ? 'true' : undefined"
      @click="selectFolder(node.key)"
    >
      <AppIcon :name="node.icon" :size="13" class="shrink-0" :class="node.tone" />
      <span class="truncate">{{ t(node.labelKey) }}</span>
      <span
        class="ml-auto shrink-0 text-[10px] font-semibold tabular-nums"
        :class="library.filters.folder === node.key ? 'text-blue-600/80 dark:text-blue-300/80' : 'text-slate-500'"
      >{{ node.count }}</span>
    </button>

    <section v-for="entry in folderNav" :key="entry.root.rootId" class="mt-3">
      <div class="flex items-center gap-0.5">
        <button
          v-if="entry.hasChildren"
          type="button"
          class="grid h-7 w-6 shrink-0 place-items-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          :aria-label="t('assets.toggleFolder')"
          :aria-expanded="!entry.collapsed"
          @click="toggleFolder(entry.key)"
        >
          <AppIcon :name="entry.collapsed ? 'chevron-right' : 'chevron-down'" :size="12" />
        </button>
        <button
          type="button"
          class="flex min-h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 text-xs transition-colors"
          :class="library.filters.folder === entry.key
            ? 'bg-blue-50 font-semibold text-blue-700 dark:bg-blue-950/40 dark:text-blue-300'
            : 'font-bold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800'"
          :title="entry.root.path"
          :aria-current="library.filters.folder === entry.key ? 'true' : undefined"
          @click="selectFolder(entry.key)"
        >
          <AppIcon
            name="folder-open"
            :size="13"
            class="shrink-0"
            :class="library.filters.folder === entry.key ? 'text-blue-500 dark:text-blue-300' : 'text-slate-400'"
          />
          <span class="truncate">{{ entry.root.label }}</span>
          <span
            class="ml-auto shrink-0 text-[10px] font-semibold tabular-nums"
            :class="library.filters.folder === entry.key ? 'text-blue-600/80 dark:text-blue-300/80' : 'text-slate-500'"
          >{{ entry.root.imageCount }}</span>
        </button>
      </div>

      <p
        v-if="entry.root.missingCount"
        class="mt-1 flex items-center gap-1 px-2 text-[11px] font-semibold text-amber-700 dark:text-amber-300"
      >
        <AppIcon name="alert-circle" :size="11" class="shrink-0" />
        {{ t("assets.missingSources", { count: entry.root.missingCount }) }}
      </p>

      <AssetFolderRows
        :rows="entry.rows"
        :active-key="library.filters.folder"
        :collapsed="collapsedFolders"
        @select="selectFolder"
        @toggle="toggleFolder"
      />

      <div class="mt-1 flex flex-wrap items-center gap-1 pl-2">
        <button
          type="button"
          class="inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-[11px] font-semibold text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          :disabled="library.isImporting.value"
          :title="entry.root.lastScanAt ? t('assets.lastScan', { time: new Date(entry.root.lastScanAt).toLocaleString() }) : t('assets.rescan')"
          @click="handleRescan(entry.root.rootId)"
        >
          <AppIcon :name="library.isImporting.value ? 'loader' : 'refresh-cw'" :size="12" :class="{ 'animate-spin': library.isImporting.value }" />
          {{ t("assets.rescan") }}
        </button>
        <button
          v-if="entry.root.missingCount"
          type="button"
          class="inline-flex h-7 items-center gap-1 rounded-md border border-amber-300/80 px-1.5 text-[11px] font-semibold text-amber-700 transition-colors hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-40 dark:border-amber-800/80 dark:text-amber-300 dark:hover:bg-amber-950/40"
          :disabled="library.isImporting.value"
          :title="t('assets.relocateHint')"
          @click="handleRelocate(entry.root.rootId)"
        >
          <AppIcon name="folder-open" :size="12" />
          {{ t("assets.relocate") }}
        </button>
        <span v-if="entry.root.truncated" class="text-[10px] font-semibold text-amber-700 dark:text-amber-300">
          {{ t("assets.scanTruncated") }}
        </span>
        <button
          type="button"
          class="ml-auto grid h-7 w-7 place-items-center rounded-md text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40 dark:hover:text-rose-300"
          :aria-label="t('assets.detach')"
          :title="t('assets.detachHint')"
          @click="handleDetachRoot(entry.root)"
        >
          <AppIcon name="trash-2" :size="12" />
        </button>
      </div>
    </section>

    <section v-if="unmountedRoots.length" class="mt-3">
      <p class="px-2 text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
        {{ t("assets.recentFolders") }}
      </p>
      <div v-for="root in unmountedRoots" :key="root.rootId" class="mt-1 flex items-center gap-1 pl-2">
        <button
          type="button"
          class="flex min-h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 text-xs font-medium text-slate-600 transition-colors hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          :title="root.path"
          @click="handleRemount(root.rootId)"
        >
          <AppIcon name="folder" :size="13" class="shrink-0 text-slate-400" />
          <span class="truncate">{{ root.label }}</span>
          <span class="ml-auto shrink-0 text-[10px] font-semibold tabular-nums text-slate-500">
            {{ root.imageCount }}
          </span>
        </button>
        <button
          type="button"
          class="inline-flex h-7 items-center gap-1 rounded-md px-1.5 text-[11px] font-semibold text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-40 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          :disabled="library.isImporting.value"
          :title="t('assets.remountHint')"
          @click="handleRemount(root.rootId)"
        >
          <AppIcon :name="library.isImporting.value ? 'loader' : 'refresh-cw'" :size="12" :class="{ 'animate-spin': library.isImporting.value }" />
          {{ t("assets.remount") }}
        </button>
        <button
          type="button"
          class="grid h-7 w-7 place-items-center rounded-md text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40 dark:hover:text-rose-300"
          :aria-label="t('assets.forgetRoot')"
          :title="t('assets.forgetRootHint')"
          @click="handleForget(root.rootId)"
        >
          <AppIcon name="x" :size="12" />
        </button>
      </div>
    </section>

    <section v-if="sourceTree.count" class="mt-3">
      <div class="flex items-center gap-0.5">
        <button
          v-if="sourceTree.children.length"
          type="button"
          class="grid h-7 w-6 shrink-0 place-items-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
          :aria-label="t('assets.toggleFolder')"
          :aria-expanded="!collapsedFolders[sourceTree.key]"
          @click="toggleFolder(sourceTree.key)"
        >
          <AppIcon :name="collapsedFolders[sourceTree.key] ? 'chevron-right' : 'chevron-down'" :size="12" />
        </button>
        <span v-else class="w-6 shrink-0"></span>
        <button
          type="button"
          class="flex min-h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 text-xs transition-colors"
          :class="library.filters.folder === sourceTree.key
            ? 'bg-blue-50 font-semibold text-blue-700 dark:bg-blue-950/40 dark:text-blue-300'
            : 'font-bold text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800'"
          :title="t('assets.sourceTreeHint')"
          :aria-current="library.filters.folder === sourceTree.key ? 'true' : undefined"
          @click="selectFolder(sourceTree.key)"
        >
          <AppIcon
            name="image"
            :size="13"
            class="shrink-0"
            :class="library.filters.folder === sourceTree.key ? 'text-blue-500 dark:text-blue-300' : 'text-slate-400'"
          />
          <span class="truncate">{{ t("assets.sourceTree") }}</span>
          <span
            class="ml-auto shrink-0 text-[10px] font-semibold tabular-nums"
            :class="library.filters.folder === sourceTree.key ? 'text-blue-600/80 dark:text-blue-300/80' : 'text-slate-500'"
          >{{ sourceTree.count }}</span>
        </button>
      </div>

      <AssetFolderRows
        :rows="sourceRows"
        :active-key="library.filters.folder"
        :collapsed="collapsedFolders"
        @select="selectFolder"
        @toggle="toggleFolder"
      />
      <p
        v-if="sourceTree.key !== 'source::'"
        class="mt-1 truncate px-2 text-[10px] text-slate-500 dark:text-slate-400"
        :title="sourceTree.key.replace('source::', '')"
      >
        {{ sourceTree.key.replace("source::", "") }}
      </p>
    </section>

    <p
      v-if="!folderNav.length && !unmountedRoots.length && !sourceTree.count"
      class="mt-3 px-2 text-[11px] leading-5 text-slate-500 dark:text-slate-400"
    >
      {{ t("assets.emptyTree") }}
    </p>
  </nav>
</template>
