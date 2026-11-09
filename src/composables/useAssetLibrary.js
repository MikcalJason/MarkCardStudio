import { computed, reactive, ref } from "vue";
import { invoke, isTauri } from "@tauri-apps/api/core";
import { i18n } from "../i18n/index.js";
import {
  dataUrlByteLength,
  fileNameWithoutExtension,
  formatDimensions,
  mediaTypeFromFileName,
  readFileAsDataUrl,
  readImageDimensions,
  createImageThumbnail,
  sha256DataUrl,
} from "../utils/imageFiles.js";
import {
  deleteBrowserAsset,
  listBrowserAssets,
  saveBrowserAsset,
  saveBrowserAssets,
} from "../storage/assetRepository.js";

const INDEX_SCHEMA_VERSION = 1;
const MAX_IMPORT_BYTES = 25 * 1024 * 1024;
const ROOTS_KEY = "markcard_asset_roots_v1";
const RECENT_ROOTS_KEY = "markcard_asset_recent_roots_v1";
const RECENT_ROOTS_LIMIT = 8;
const SORT_KEY = "markcard_asset_sort_v1";
const SORT_OPTIONS = [
  "newest",
  "oldest",
  "name-asc",
  "name-desc",
  "size-desc",
  "size-asc",
  "usage-desc",
  "usage-asc",
];
const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
// Files are read over IPC, hashed, thumbnailed and written back per image, so a
// vault scan is latency- and CPU-bound per file. A small worker pool overlaps
// those round-trips; the cap keeps only a handful of full data URLs in memory.
const SCAN_CONCURRENCY = 4;
const DEFAULT_FILTERS = {
  kind: "all",
  source: "all",
  usage: "all",
  ai: "all",
  tag: "",
  folder: "",
  trash: false,
};

function t(key, params) {
  return i18n.global.t(key, params);
}

function nowIso() {
  return new Date().toISOString();
}

function createRootId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `root_${crypto.randomUUID()}`;
  }
  return `root_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeRoot(raw) {
  if (!raw || typeof raw !== "object" || typeof raw.rootId !== "string" || !raw.rootId) return null;
  return {
    rootId: raw.rootId,
    path: typeof raw.path === "string" ? raw.path : "",
    label: typeof raw.label === "string" ? raw.label : "",
    lastScanAt: typeof raw.lastScanAt === "string" ? raw.lastScanAt : "",
    imageCount: Number.isFinite(raw.imageCount) ? raw.imageCount : 0,
    missingCount: Number.isFinite(raw.missingCount) ? raw.missingCount : 0,
    truncated: Boolean(raw.truncated),
  };
}

function normalizeFolderEntry(entry) {
  if (!entry || typeof entry !== "object") return null;
  if (typeof entry.rootId !== "string" || !entry.rootId) return null;
  return {
    rootId: entry.rootId,
    relativePath: typeof entry.relativePath === "string" ? entry.relativePath : "",
    absolutePath: typeof entry.absolutePath === "string" ? entry.absolutePath : "",
    lastSeenAt: typeof entry.lastSeenAt === "string" ? entry.lastSeenAt : "",
    missingSince: typeof entry.missingSince === "string" ? entry.missingSince : null,
  };
}

function folderAssetPaths(asset) {
  return Array.isArray(asset?.folders) ? asset.folders : [];
}

function parentDir(relativePath) {
  const index = String(relativePath || "").lastIndexOf("/");
  return index < 0 ? "" : String(relativePath).slice(0, index);
}

function splitFolderKey(key) {
  const index = String(key || "").indexOf("::");
  if (index < 0) return null;
  return { rootId: String(key).slice(0, index), dir: String(key).slice(index + 2) };
}

// A folder node covers its own files and every file below it, and one asset
// counted through two of its own paths still shows once.
function assetInFolder(asset, folder) {
  const paths = new Set();
  for (const entry of folderAssetPaths(asset)) {
    if (entry.rootId !== folder.rootId) continue;
    const dir = parentDir(entry.relativePath);
    if (folder.dir && dir !== folder.dir && !dir.startsWith(`${folder.dir}/`)) continue;
    paths.add(entry.relativePath);
  }
  return paths.size > 0;
}

function folderDisplayName(path) {
  const segments = String(path || "").split(/[\/\\]+/).filter(Boolean);
  return segments[segments.length - 1] || String(path || "");
}

// Scan roots are recorded only in `roots`, so a root can be rebuilt from an
// entry: the root path is the absolute path minus its root-relative part.
// `relativePath` is always "/"-joined while `absolutePath` keeps native
// separators, so compare normalized but slice the original (same length).
function rootPathFromFolderEntry(entry) {
  const absolute = String(entry.absolutePath || "");
  if (!absolute) return "";
  const relative = String(entry.relativePath || "").replace(/\\/g, "/");
  if (relative && absolute.replace(/\\/g, "/").endsWith(`/${relative}`)) {
    return absolute.slice(0, absolute.length - relative.length - 1).replace(/[\\/]+$/, "");
  }
  return absolute.replace(/[\\/][^\\/]+$/, "");
}

// Imported files remember their original absolute path, so the library can
// show a project tree even before any folder is mounted for scanning.
function sourceDirOf(asset) {
  const path = String(asset?.source?.sourcePath || "");
  if (!path) return null;
  return parentDir(path.replace(/\\/g, "/"));
}

// Longest shared directory across imported sources. The tree starts there so
// absolute system paths (/Users/me/...) do not become the first thing users see.
function commonDirPrefix(dirs) {
  if (!dirs.length) return "";
  const first = dirs[0].split("/").filter(Boolean);
  let common = first;
  for (const dir of dirs.slice(1)) {
    const parts = dir.split("/").filter(Boolean);
    let index = 0;
    while (index < common.length && index < parts.length && common[index] === parts[index]) {
      index += 1;
    }
    common = common.slice(0, index);
    if (!common.length) break;
  }
  if (!common.length) return dirs[0].startsWith("/") ? "/" : "";
  const leading = dirs[0].startsWith("/") ? "/" : "";
  return `${leading}${common.join("/")}`;
}

function buildSourceTree(assets) {
  const nodes = new Map();
  const ensure = (dir) => {
    if (nodes.has(dir)) return nodes.get(dir);
    const segments = dir.split("/").filter(Boolean);
    const node = {
      key: `source::${dir}`,
      dir,
      label: segments[segments.length - 1] || "/",
      count: 0,
      children: [],
    };
    nodes.set(dir, node);
    if (segments.length) ensure(parentDir(dir)).children.push(node);
    return node;
  };

  const rootNode = ensure("");
  const counted = new Set();
  const dirs = [];
  for (const asset of assets) {
    if (asset.deletedAt) continue;
    const dir = sourceDirOf(asset);
    if (dir === null) continue;
    if (dir) dirs.push(dir);
    let cursor = dir;
    for (;;) {
      const mark = `${asset.assetId}|${cursor}`;
      if (!counted.has(mark)) {
        counted.add(mark);
        ensure(cursor).count += 1;
      }
      if (!cursor) break;
      cursor = parentDir(cursor);
    }
  }

  const sortNode = (node) => {
    node.children.sort((left, right) => left.label.localeCompare(right.label, "zh-CN"));
    node.children.forEach(sortNode);
  };
  sortNode(rootNode);

  return nodes.get(commonDirPrefix(dirs)) || rootNode;
}

function readStoredRoots(key = ROOTS_KEY) {
  try {
    const parsed = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(parsed) ? parsed.map(normalizeRoot).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function readStoredSort() {
  try {
    const stored = localStorage.getItem(SORT_KEY) || "";
    return SORT_OPTIONS.includes(stored) ? stored : "newest";
  } catch {
    return "newest";
  }
}

function writeStoredRoots(list, key = ROOTS_KEY) {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    // Only the mounted-folder list is lost when storage is unavailable.
  }
}

function everyFolderMissing(asset) {
  const paths = folderAssetPaths(asset);
  return paths.length > 0 && paths.every((entry) => entry.missingSince);
}

// An asset only belongs to one scan folder when none of its paths sit under
// another root, so detaching never archives shared or hand-picked imports.
function assetsExclusiveToRoot(assets, rootId) {
  return assets.filter((asset) => {
    const entries = folderAssetPaths(asset);
    return entries.length > 0 && entries.every((entry) => entry.rootId === rootId);
  });
}

function buildRootTree(root, assets) {
  const nodes = new Map();
  const ensure = (dir) => {
    if (nodes.has(dir)) return nodes.get(dir);
    const segments = dir ? dir.split("/") : [];
    const node = {
      key: `${root.rootId}::${dir}`,
      dir,
      label: segments[segments.length - 1] || root.label || folderDisplayName(root.path),
      count: 0,
      children: [],
    };
    nodes.set(dir, node);
    if (segments.length) ensure(segments.slice(0, -1).join("/")).children.push(node);
    return node;
  };

  const rootNode = ensure("");
  const counted = new Set();
  for (const asset of assets) {
    if (asset.deletedAt) continue;
    for (const entry of folderAssetPaths(asset)) {
      if (entry.rootId !== root.rootId) continue;
      let dir = parentDir(entry.relativePath);
      for (;;) {
        const mark = `${asset.assetId}|${dir}`;
        if (!counted.has(mark)) {
          counted.add(mark);
          ensure(dir).count += 1;
        }
        if (!dir) break;
        dir = parentDir(dir);
      }
    }
  }

  const sortNode = (node) => {
    node.children.sort((left, right) => left.label.localeCompare(right.label, "zh-CN"));
    node.children.forEach(sortNode);
  };
  sortNode(rootNode);
  return rootNode;
}

function formatFromMediaType(mediaType = "") {
  const value = mediaType.split(";")[0];
  return value.startsWith("image/") ? value.slice(6) : "image";
}

function createUsageRef(usage) {
  if (!usage || typeof usage.workId !== "string" || !usage.workId) return null;
  return {
    workId: usage.workId,
    ref: typeof usage.ref === "string" && usage.ref ? usage.ref : "asset",
  };
}

function normalizeAsset(raw) {
  if (!raw || typeof raw !== "object" || typeof raw.assetId !== "string") return null;
  return {
    schemaVersion: INDEX_SCHEMA_VERSION,
    assetId: raw.assetId,
    kind: typeof raw.kind === "string" ? raw.kind : "image",
    path: typeof raw.path === "string" ? raw.path : "",
    thumbPath: typeof raw.thumbPath === "string" ? raw.thumbPath : "",
    fileName: typeof raw.fileName === "string" ? raw.fileName : "",
    name: typeof raw.name === "string" ? raw.name : "",
    mediaType: typeof raw.mediaType === "string" ? raw.mediaType : "image/png",
    format: typeof raw.format === "string" ? raw.format : "image",
    bytes: Number.isFinite(raw.bytes) ? raw.bytes : 0,
    width: Number.isFinite(raw.width) ? raw.width : 0,
    height: Number.isFinite(raw.height) ? raw.height : 0,
    source: raw.source && typeof raw.source === "object"
      ? { kind: "import", ...raw.source }
      : { kind: "import" },
    tags: Array.isArray(raw.tags) ? raw.tags.filter((tag) => typeof tag === "string") : [],
    alt: typeof raw.alt === "string" ? raw.alt : "",
    focal: raw.focal && typeof raw.focal === "object" ? raw.focal : { x: 0.5, y: 0.5 },
    dominantColors: Array.isArray(raw.dominantColors) ? raw.dominantColors.filter((color) => typeof color === "string") : [],
    rights: {
      license: "unknown",
      author: "",
      sourceUrl: "",
      attribution: "",
      ...(raw.rights && typeof raw.rights === "object" ? raw.rights : {}),
    },
    ai: {
      generated: false,
      provider: "",
      model: "",
      promptHash: "",
      label: "",
      ...(raw.ai && typeof raw.ai === "object" ? raw.ai : {}),
    },
    usage: Array.isArray(raw.usage) ? raw.usage.map(createUsageRef).filter(Boolean) : [],
    folders: Array.isArray(raw.folders)
      ? raw.folders.map(normalizeFolderEntry).filter(Boolean)
      : [],
    projectPaths: Array.isArray(raw.projectPaths)
      ? raw.projectPaths.filter((path) => typeof path === "string")
      : [],
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : nowIso(),
    updatedAt: typeof raw.updatedAt === "string" ? raw.updatedAt : nowIso(),
    deletedAt: typeof raw.deletedAt === "string" ? raw.deletedAt : null,
    dataUrl: typeof raw.dataUrl === "string" ? raw.dataUrl : "",
    thumbDataUrl: typeof raw.thumbDataUrl === "string" ? raw.thumbDataUrl : "",
    thumbUrl: typeof raw.thumbUrl === "string" ? raw.thumbUrl : "",
  };
}

function serializableAsset(asset, platform) {
  const { dataUrl, thumbDataUrl, thumbUrl, ...rest } = asset;
  if (platform === "browser") {
    return { ...rest, dataUrl, thumbDataUrl };
  }
  return {
    ...rest,
    usage: rest.usage || [],
    ai: rest.ai || { generated: false },
    rights: rest.rights || { license: "unknown" },
  };
}

/**
 * Asset library state for both Tauri and browser development. Tauri stores the
 * master files and JSON index under the app data directory; browser mode uses
 * IndexedDB so import, dedupe, search, and usage remain testable in `pnpm dev`.
 */
export function useAssetLibrary() {
  const assets = ref([]);
  const roots = ref([]);
  const recentRoots = ref([]);
  const scanProgress = ref({ active: false, label: "", current: 0, total: 0 });
  const query = ref("");
  const filters = reactive({ ...DEFAULT_FILTERS });
  const sort = ref(readStoredSort());
  const selectedIds = ref([]);
  const isLoading = ref(false);
  const isImporting = ref(false);
  const error = ref("");
  const importMessage = ref("");
  const lastImport = ref(null);
  const initialized = ref(false);
  const thumbCache = new Map();
  const sourceCache = new Map();
  const thumbRequests = new Map();
  const sourceRequests = new Map();

  let persistChain = Promise.resolve();
  let persistTimer = null;
  let readyPromise = null;
  // Folder scans hold new assets here and publish them in batches: pushing each
  // one into the reactive list would recompute filters, stats, and the folder
  // tree thousands of times while a vault imports.
  let scanBuffer = null;
  // In-flight creations keyed by asset id, so concurrent bulk imports of the
  // same bytes share one insert instead of racing past the dedupe check.
  const importInFlight = new Map();

  const isDesktop = computed(() => isTauri());

  const activeAssets = computed(() => assets.value.filter((asset) => !asset.deletedAt));
  const trashedAssets = computed(() => assets.value.filter((asset) => asset.deletedAt));

  const filteredAssets = computed(() => {
    const keyword = query.value.trim().toLowerCase();
    const folder = splitFolderKey(filters.folder);
    const smart = String(filters.folder).startsWith("smart:") ? filters.folder.slice(6) : "";
    const list = assets.value.filter((asset) => {
      if (filters.trash ? !asset.deletedAt : Boolean(asset.deletedAt)) return false;
      if (filters.kind !== "all" && asset.kind !== filters.kind) return false;
      if (filters.source !== "all" && asset.source?.kind !== filters.source) return false;
      if (filters.usage === "used" && !asset.usage?.length) return false;
      if (filters.usage === "unused" && asset.usage?.length) return false;
      if (filters.ai === "ai" && !asset.ai?.generated) return false;
      if (filters.ai === "non-ai" && asset.ai?.generated) return false;
      if (filters.tag && !(asset.tags || []).includes(filters.tag)) return false;
      if (smart === "unfiled" && (folderAssetPaths(asset).length || sourceDirOf(asset) !== null)) return false;
      if (smart === "missing" && !everyFolderMissing(asset)) return false;
      if (!smart && folder?.rootId === "source") {
        const dir = sourceDirOf(asset);
        if (dir === null) return false;
        if (folder.dir && dir !== folder.dir && !dir.startsWith(`${folder.dir}/`)) return false;
      } else if (!smart && folder && folder.rootId !== "source" && !assetInFolder(asset, folder)) {
        return false;
      }
      if (!keyword) return true;
      const haystack = [
        asset.name,
        asset.fileName,
        asset.alt,
        asset.assetId,
        asset.source?.kind,
        ...(asset.tags || []),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return haystack.includes(keyword);
    });

    const [sortKey] = sort.value.split("-");
    return [...list].sort((left, right) => {
      if (sortKey === "name" || sortKey === "size" || sortKey === "usage") {
        const direction = sort.value.endsWith("-asc") ? 1 : -1;
        if (sortKey === "name") {
          return direction * (left.name || left.fileName).localeCompare(right.name || right.fileName, "zh-CN");
        }
        if (sortKey === "size") return direction * ((left.bytes || 0) - (right.bytes || 0));
        return direction * ((left.usage?.length || 0) - (right.usage?.length || 0));
      }
      const byTime = String(left.createdAt).localeCompare(String(right.createdAt));
      return sort.value === "oldest" ? byTime : -byTime;
    });
  });

  const stats = computed(() => {
    const active = activeAssets.value;
    return {
      total: active.length,
      visible: filteredAssets.value.length,
      selected: selectedIds.value.length,
      unused: active.filter((asset) => !asset.usage?.length).length,
      used: active.filter((asset) => asset.usage?.length).length,
      aiGenerated: active.filter((asset) => asset.ai?.generated).length,
      trashed: trashedAssets.value.length,
      bytes: active.reduce((total, asset) => total + (asset.bytes || 0), 0),
    };
  });

  const folderTree = computed(() =>
    roots.value
      .filter((root) => root.path)
      .map((root) => ({ root, node: buildRootTree(root, assets.value) })),
  );

  const sourceTree = computed(() => buildSourceTree(assets.value));

  const selectedAssets = computed(() =>
    selectedIds.value
      .map((assetId) => assets.value.find((asset) => asset.assetId === assetId))
      .filter(Boolean),
  );

  const hasAssets = computed(() => assets.value.length > 0);

  const allTags = computed(() => {
    const tags = new Set();
    for (const asset of activeAssets.value) {
      for (const tag of asset.tags || []) tags.add(tag);
    }
    return [...tags].sort((left, right) => left.localeCompare(right, "zh-CN"));
  });

  function findAsset(assetId) {
    if (scanBuffer) {
      const buffered = scanBuffer.find((asset) => asset.assetId === assetId);
      if (buffered) return buffered;
    }
    return assets.value.find((asset) => asset.assetId === assetId) || null;
  }

  function matchesCurrentView(asset) {
    if (!asset) return false;
    return filteredAssets.value.some((item) => item.assetId === asset.assetId);
  }

  function rememberThumb(assetId, url) {
    if (url) thumbCache.set(assetId, url);
    return url;
  }

  function rememberSource(assetId, url) {
    if (url) sourceCache.set(assetId, url);
    return url;
  }

  async function init(force = false) {
    if (initialized.value && !force) return assets.value;
    if (force) initialized.value = false;
    isLoading.value = true;
    error.value = "";
    try {
      const records = isTauri()
        ? await invoke("read_asset_library").then((index) => {
            roots.value = (Array.isArray(index?.roots) ? index.roots : [])
              .map(normalizeRoot)
              .filter(Boolean);
            recentRoots.value = (Array.isArray(index?.recentRoots) ? index.recentRoots : [])
              .map(normalizeRoot)
              .filter(Boolean)
              .slice(0, RECENT_ROOTS_LIMIT);
            return index?.assets || [];
          })
        : await listBrowserAssets().then((records) => {
            roots.value = readStoredRoots();
            recentRoots.value = readStoredRoots(RECENT_ROOTS_KEY).slice(0, RECENT_ROOTS_LIMIT);
            return records;
          });
      const normalized = records.map(normalizeAsset).filter(Boolean);
      const deduped = new Map();
      for (const asset of normalized) {
        const existing = deduped.get(asset.assetId);
        if (!existing || String(asset.updatedAt) > String(existing.updatedAt)) {
          deduped.set(asset.assetId, asset);
        }
      }
      assets.value = [...deduped.values()];
      for (const asset of assets.value) {
        if (asset.thumbDataUrl) rememberThumb(asset.assetId, asset.thumbDataUrl);
        if (asset.dataUrl) rememberSource(asset.assetId, asset.dataUrl);
      }
      const recovered = recoverRootsFromEntries();
      if (recovered.length) {
        roots.value = [...roots.value, ...recovered];
        for (const root of recovered) rememberRecentRoot(root);
        await flushPersist();
      }
      initialized.value = true;
    } catch (err) {
      error.value = err?.message || String(err);
    } finally {
      isLoading.value = false;
    }
    return assets.value;
  }

  function flushPersist() {
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
    }
    error.value = "";
    const platform = isTauri() ? "tauri" : "browser";
    persistChain = persistChain
      .catch(() => undefined)
      .then(async () => {
        // Snapshot at write time, not at call time: a queued write captured
        // before a purge would otherwise land later and resurrect the asset.
        const snapshot = assets.value.map((asset) => serializableAsset(asset, platform));
        if (platform === "tauri") {
          await invoke("write_asset_library", {
            index: {
              schemaVersion: INDEX_SCHEMA_VERSION,
              roots: roots.value,
              recentRoots: recentRoots.value,
              assets: snapshot,
            },
          });
        } else {
          await saveBrowserAssets(snapshot);
          writeStoredRoots(roots.value);
          writeStoredRoots(recentRoots.value, RECENT_ROOTS_KEY);
        }
        error.value = "";
      })
      .catch((err) => {
        error.value = err?.message || String(err);
      });
    return persistChain;
  }

  function persistSoon(delay = 250) {
    if (persistTimer) clearTimeout(persistTimer);
    persistTimer = setTimeout(() => flushPersist(), delay);
  }

  async function persistNow() {
    return flushPersist();
  }

  async function importPaths(paths = []) {
    if (!paths.length) return { added: 0, duplicates: 0, failed: 0 };
    isImporting.value = true;
    error.value = "";
    importMessage.value = "";
    let added = 0;
    let duplicates = 0;
    let failed = 0;

    try {
      for (const path of paths) {
        try {
          const resolved = await invoke("resolve_local_image", {
            path,
            basePath: null,
          });
          if (!resolved?.dataUrl) {
            failed += 1;
            continue;
          }
          const result = await importFromDataUrl({
            dataUrl: resolved.dataUrl,
            fileName: resolved.fileName || "image",
            mediaType: resolved.mediaType || mediaTypeFromFileName(resolved.fileName),
            sourceKind: "import",
            sourcePath: resolved.path || path,
            skipPersist: true,
          });
          if (result.duplicate) duplicates += 1;
          else if (result.asset) added += 1;
          else failed += 1;
        } catch {
          failed += 1;
        }
      }
      await flushPersist();
      lastImport.value = { added, duplicates, failed };
      importMessage.value = t("assets.importResult", { added, duplicates, failed });
    } finally {
      isImporting.value = false;
    }
    return { added, duplicates, failed };
  }

  async function importFiles(files = []) {
    const list = Array.from(files).filter((file) => file?.type?.startsWith("image/") || mediaTypeFromFileName(file.name));
    if (!list.length) return { added: 0, duplicates: 0, failed: 0 };
    isImporting.value = true;
    error.value = "";
    importMessage.value = "";
    let added = 0;
    let duplicates = 0;
    let failed = 0;

    try {
      for (const file of list) {
        try {
          const dataUrl = await readFileAsDataUrl(file);
          const result = await importFromDataUrl({
            dataUrl,
            fileName: file.name,
            mediaType: file.type || mediaTypeFromFileName(file.name),
            sourceKind: "import",
            skipPersist: true,
          });
          if (result.duplicate) duplicates += 1;
          else if (result.asset) added += 1;
          else failed += 1;
        } catch {
          failed += 1;
        }
      }
      await flushPersist();
      lastImport.value = { added, duplicates, failed };
      importMessage.value = t("assets.importResult", { added, duplicates, failed });
    } finally {
      isImporting.value = false;
    }
    return { added, duplicates, failed };
  }

  async function importFromDataUrl({
    dataUrl,
    fileName = "image",
    mediaType = "",
    sourceKind = "import",
    sourcePath = "",
    derivedFrom = "",
    folder = null,
    skipPersist = false,
    skipSourceCache = false,
  } = {}) {
    if (typeof dataUrl !== "string" || !dataUrl.startsWith("data:image/")) {
      throw new Error("Only image data URLs can be imported");
    }
    const bytes = dataUrlByteLength(dataUrl);
    if (!bytes || bytes > MAX_IMPORT_BYTES) {
      throw new Error("Images must be between 1 byte and 25 MB");
    }

    const hash = await sha256DataUrl(dataUrl);
    const assetId = `sha256:${hash}`;
    const existing = findAsset(assetId);
    if (existing) {
      // Same bytes found in another scanned folder: one asset, an extra path.
      if (folder) attachFolder(existing.assetId, folder);
      return { asset: findAsset(assetId), duplicate: true };
    }

    // Concurrent bulk imports can hash two identical files before either has
    // been committed, so the first in-flight creation is shared: later callers
    // await it and land on the dedupe path instead of double-inserting. The
    // resume-to-set block below has no await, so the winner always registers
    // before a loser reads the map.
    const pending = importInFlight.get(assetId);
    if (pending) {
      try {
        await pending;
      } catch {
        // The in-flight attempt failed; fall through and create it ourselves.
      }
      const after = findAsset(assetId);
      if (after) {
        if (folder) attachFolder(after.assetId, folder);
        return { asset: findAsset(assetId), duplicate: true };
      }
    }

    const task = createAssetFromDataUrl({
      dataUrl,
      fileName,
      mediaType,
      sourceKind,
      sourcePath,
      derivedFrom,
      folder,
      assetId,
      bytes,
      skipPersist,
      skipSourceCache,
    });
    importInFlight.set(assetId, task);
    try {
      return await task;
    } finally {
      if (importInFlight.get(assetId) === task) importInFlight.delete(assetId);
    }
  }

  async function createAssetFromDataUrl({
    dataUrl,
    fileName,
    mediaType,
    sourceKind,
    sourcePath,
    derivedFrom,
    folder,
    assetId,
    bytes,
    skipPersist,
    skipSourceCache,
  }) {
    const [dimensions, thumbnail] = await Promise.all([
      readImageDimensions(dataUrl).catch(() => ({ width: 0, height: 0 })),
      createImageThumbnail(dataUrl).catch(() => ""),
    ]);
    const resolvedMediaType = mediaType || mediaTypeFromFileName(fileName) || "image/png";
    const asset = normalizeAsset({
      assetId,
      kind: "image",
      fileName,
      name: fileNameWithoutExtension(fileName),
      mediaType: resolvedMediaType,
      format: formatFromMediaType(resolvedMediaType),
      bytes,
      width: dimensions.width,
      height: dimensions.height,
      source: {
        kind: sourceKind,
        fileName,
        sourcePath,
        derivedFrom,
      },
      rights: { license: "unknown" },
      ai: { generated: false },
      tags: [],
      alt: fileNameWithoutExtension(fileName),
      usage: [],
      projectPaths: [],
      folders: folder ? [normalizeFolderEntry({ ...folder })].filter(Boolean) : [],
      createdAt: nowIso(),
      updatedAt: nowIso(),
      deletedAt: null,
    });

    if (isTauri()) {
      const stored = await invoke("store_asset_file", {
        assetId,
        fileName,
        mediaType: resolvedMediaType,
        dataUrl,
        thumbDataUrl: thumbnail || null,
      });
      asset.path = stored.path;
      asset.thumbPath = stored.thumbPath;
      asset.bytes = stored.bytes;
      rememberThumb(assetId, thumbnail);
      // A folder scan can pull thousands of files; caching every full data URL
      // would pin hundreds of MB, so bulk imports read from disk on demand.
      if (!skipSourceCache) rememberSource(assetId, dataUrl);
    } else {
      asset.dataUrl = dataUrl;
      asset.thumbDataUrl = thumbnail;
      rememberThumb(assetId, thumbnail || dataUrl);
      rememberSource(assetId, dataUrl);
      await saveBrowserAsset(serializableAsset(asset, "browser"));
    }

    if (scanBuffer) scanBuffer.push(asset);
    else assets.value = [asset, ...assets.value];
    if (!skipPersist) await flushPersist();
    return { asset, duplicate: false };
  }

  function commitScanBuffer() {
    if (!scanBuffer) return;
    if (scanBuffer.length) assets.value = [...scanBuffer, ...assets.value];
    // Keep the buffer open so the rest of the scan still batches; only the scan
    // itself closes it.
    scanBuffer.length = 0;
  }

  function attachFolder(assetId, folder) {
    const entry = normalizeFolderEntry(folder);
    const asset = findAsset(assetId);
    if (!entry || !asset) return null;
    const exists = folderAssetPaths(asset).some(
      (item) => item.rootId === entry.rootId && item.relativePath === entry.relativePath,
    );
    // Seen-but-stale bookkeeping happens once per scan, so a rescan of an
    // unchanged folder must not rewrite thousands of assets one by one.
    // A file the scan sees again is not gone any more, so an archive left over
    // from a previous detach is lifted while its paths are re-attached.
    if (exists) {
      if (!asset.deletedAt) return asset;
      if (scanBuffer) {
        asset.deletedAt = null;
        asset.updatedAt = nowIso();
        return asset;
      }
      return updateAsset(assetId, { deletedAt: null });
    }
    const folders = [...folderAssetPaths(asset), { ...entry, missingSince: null }];
    // During a scan, mutate in place: rebuilding the whole array per asset is
    // what made re-importing a previously detached vault cost O(n²).
    if (scanBuffer) {
      asset.folders = folders;
      asset.deletedAt = null;
      asset.updatedAt = nowIso();
      return asset;
    }
    return updateAsset(assetId, { folders, deletedAt: null });
  }

  // One array rebuild for the whole folder refresh, so a rescan of a large vault
  // costs a single reactive update instead of one per asset.
  function applyFolderRefresh(rootId, scanAt, seenPaths) {
    let changed = false;
    const nextAssets = assets.value.map((asset) => {
      const entries = folderAssetPaths(asset);
      if (!entries.some((entry) => entry.rootId === rootId)) return asset;
      let assetChanged = false;
      const nextEntries = entries.map((entry) => {
        if (entry.rootId !== rootId) return entry;
        const isSeen = seenPaths.has(String(entry.relativePath).toLowerCase());
        const missingSince = isSeen ? null : entry.missingSince || scanAt;
        const lastSeenAt = isSeen ? scanAt : entry.lastSeenAt;
        if (entry.missingSince === missingSince && entry.lastSeenAt === lastSeenAt) return entry;
        assetChanged = true;
        return { ...entry, missingSince, lastSeenAt };
      });
      if (!assetChanged) return asset;
      changed = true;
      return { ...asset, folders: nextEntries, updatedAt: nowIso() };
    });
    if (changed) assets.value = nextAssets;
    return changed;
  }

  function missingUnderRoot(rootId) {
    let count = 0;
    for (const asset of assets.value) {
      count += folderAssetPaths(asset).filter((entry) => entry.rootId === rootId && entry.missingSince).length;
    }
    return count;
  }

  // Folder entries outliving their root record hides the whole mounted-folder
  // rail, including rescan and detach, with no way back, so rebuild the missing
  // roots from the entries. Losing them usually means the same folder was
  // mounted again, so entries resolving to one path fold into the most recently
  // scanned root instead of becoming duplicate sections.
  function recoverRootsFromEntries() {
    const known = new Set(roots.value.map((root) => root.rootId));
    const groups = new Map();
    for (const asset of assets.value) {
      for (const entry of folderAssetPaths(asset)) {
        if (known.has(entry.rootId)) continue;
        const path = rootPathFromFolderEntry(entry);
        if (!path) continue;
        const group = groups.get(entry.rootId) || { path, pathCount: 0, paths: new Map(), lastScanAt: "" };
        const count = (group.paths.get(path) || 0) + 1;
        group.paths.set(path, count);
        if (count > group.pathCount) {
          group.path = path;
          group.pathCount = count;
        }
        if (String(entry.lastSeenAt) > group.lastScanAt) group.lastScanAt = String(entry.lastSeenAt);
        groups.set(entry.rootId, group);
      }
    }

    const mergeTarget = new Map();
    const winners = new Map();
    for (const [rootId, group] of groups) {
      const current = winners.get(group.path);
      if (current && current.lastScanAt >= group.lastScanAt) {
        mergeTarget.set(rootId, current.rootId);
      } else {
        if (current) mergeTarget.set(current.rootId, rootId);
        winners.set(group.path, { rootId, path: group.path, lastScanAt: group.lastScanAt });
      }
    }

    // Chains form when a middle root wins then loses, so resolve to the end.
    const resolveRootId = (rootId) => {
      let target = rootId;
      while (mergeTarget.has(target)) target = mergeTarget.get(target);
      return target;
    };

    if (mergeTarget.size) {
      assets.value = assets.value.map((asset) => {
        const entries = folderAssetPaths(asset);
        if (!entries.some((entry) => mergeTarget.has(entry.rootId))) return asset;
        const merged = new Map();
        for (const entry of entries) {
          const rootId = resolveRootId(entry.rootId);
          const next = rootId === entry.rootId ? entry : { ...entry, rootId };
          const key = `${rootId}::${String(entry.relativePath).toLowerCase()}`;
          const previous = merged.get(key);
          if (previous && String(previous.lastSeenAt) >= String(next.lastSeenAt)) continue;
          merged.set(key, next);
        }
        return { ...asset, folders: [...merged.values()], updatedAt: nowIso() };
      });
    }

    const counts = new Map();
    for (const asset of assets.value) {
      for (const entry of folderAssetPaths(asset)) {
        if (known.has(entry.rootId)) continue;
        counts.set(entry.rootId, (counts.get(entry.rootId) || 0) + 1);
      }
    }

    return [...winners.values()]
      .map(({ rootId, path, lastScanAt }) =>
        normalizeRoot({
          rootId,
          path,
          label: folderDisplayName(path),
          lastScanAt,
          imageCount: counts.get(rootId) || 0,
          missingCount: missingUnderRoot(rootId),
        }),
      )
      .filter(Boolean);
  }

  async function runFolderScan(rootPath, existingRoot = null) {
    if (!isTauri()) {
      error.value = t("assets.scanDesktopOnly");
      return null;
    }
    // Two overlapping scans would share the import buffer and progress state.
    if (isImporting.value) return null;
    const known = normalizeRoot(existingRoot || {});
    const root = {
      rootId: known?.rootId || createRootId(),
      path: rootPath,
      label: known?.label || folderDisplayName(rootPath),
      lastScanAt: "",
      imageCount: 0,
      missingCount: 0,
      truncated: false,
    };
    let added = 0;
    let duplicates = 0;
    let failed = 0;

    isImporting.value = true;
    error.value = "";
    importMessage.value = "";
    scanProgress.value = { active: true, label: root.label, current: 0, total: 0 };

    try {
      const scanned = await invoke("scan_image_folder", { rootPath });
      const images = Array.isArray(scanned?.images) ? scanned.images : [];
      const scanAt = nowIso();
      root.truncated = Boolean(scanned?.truncated);
      scanProgress.value = { active: true, label: root.label, current: 0, total: images.length };
      scanBuffer = [];

      const total = images.length;
      const concurrency = Math.max(1, Math.min(SCAN_CONCURRENCY, total));
      let cursor = 0;
      let processed = 0;
      let lastProgressAt = 0;

      // Progress is a reactive object rebuilt per file; throttle it so a large
      // vault does not churn filters, stats, and the folder tree on every image.
      const publishProgress = (force = false) => {
        const now = Date.now();
        if (!force && now - lastProgressAt < 120) return;
        lastProgressAt = now;
        scanProgress.value = { active: true, label: root.label, current: processed, total };
      };

      const scanWorker = async () => {
        while (cursor < total) {
          const index = cursor;
          cursor += 1;
          const image = images[index];
          try {
            const resolved = await invoke("resolve_local_image", {
              path: image.absolutePath,
              basePath: null,
            });
            if (!resolved?.dataUrl) {
              failed += 1;
            } else {
              const result = await importFromDataUrl({
                dataUrl: resolved.dataUrl,
                fileName: image.fileName || resolved.fileName || "image",
                mediaType: image.mediaType || resolved.mediaType || "",
                sourceKind: "import",
                sourcePath: image.absolutePath,
                folder: {
                  rootId: root.rootId,
                  relativePath: image.relativePath,
                  absolutePath: image.absolutePath,
                  lastSeenAt: scanAt,
                },
                skipPersist: true,
                skipSourceCache: true,
              });
              if (result.duplicate) duplicates += 1;
              else if (result.asset) added += 1;
              else failed += 1;
            }
          } catch {
            failed += 1;
          }
          processed += 1;
          publishProgress();
          if (processed % 200 === 0) {
            commitScanBuffer();
            await flushPersist();
          }
        }
      };

      await Promise.all(Array.from({ length: concurrency }, scanWorker));
      publishProgress(true);

      // Anything previously scanned under this root that the walk no longer sees
      // is marked missing, never deleted: the user's folder stays authoritative.
      commitScanBuffer();
      const seen = new Set(images.map((image) => String(image.relativePath).toLowerCase()));
      applyFolderRefresh(root.rootId, scanAt, seen);

      root.imageCount = images.length;
      root.missingCount = missingUnderRoot(root.rootId);
      root.lastScanAt = scanAt;
      roots.value = [root, ...roots.value.filter((item) => item.rootId !== root.rootId)];
      rememberRecentRoot(root);
      await flushPersist();
      lastImport.value = { added, duplicates, failed };
      importMessage.value = t("assets.scanResult", {
        added,
        duplicates,
        failed,
        missing: root.missingCount,
      });
    } catch (err) {
      error.value = err?.message || String(err);
    } finally {
      // An aborted scan still publishes what it already imported.
      commitScanBuffer();
      scanBuffer = null;
      scanProgress.value = { active: false, label: "", current: 0, total: 0 };
      isImporting.value = false;
    }

    return { added, duplicates, failed };
  }

  async function scanFolder() {
    if (!isTauri()) {
      error.value = t("assets.scanDesktopOnly");
      return null;
    }
    try {
      const picked = await invoke("pick_asset_folder");
      if (!picked) return null;
      const known = roots.value.find((root) => root.path === picked) || null;
      return await runFolderScan(picked, known);
    } catch (err) {
      error.value = err?.message || String(err);
      return null;
    }
  }

  async function rescanRoot(rootId) {
    const root = roots.value.find((item) => item.rootId === rootId);
    if (!root?.path) return null;
    return runFolderScan(root.path, root);
  }

  // A moved or renamed vault keeps its relative paths, so relocating reuses the
  // same rootId: entries that survived the move relink instead of duplicating.
  async function relocateRoot(rootId) {
    if (!isTauri()) {
      error.value = t("assets.scanDesktopOnly");
      return null;
    }
    const root = roots.value.find((item) => item.rootId === rootId);
    if (!root) return null;
    try {
      const picked = await invoke("pick_asset_folder");
      if (!picked) return null;
      return runFolderScan(picked, { ...root, label: folderDisplayName(picked) });
    } catch (err) {
      error.value = err?.message || String(err);
      return null;
    }
  }

  async function rescanAllRoots() {
    const summary = { added: 0, duplicates: 0, failed: 0, scanned: 0 };
    for (const root of roots.value.filter((item) => item.path)) {
      const result = await runFolderScan(root.path, root);
      if (!result) continue;
      summary.scanned += 1;
      summary.added += result.added;
      summary.duplicates += result.duplicates;
      summary.failed += result.failed;
    }
    return summary;
  }

  const staleRoots = computed(() =>
    roots.value.filter((root) => {
      if (!root.path) return false;
      if (root.missingCount) return true;
      const last = Date.parse(root.lastScanAt);
      return !Number.isFinite(last) || Date.now() - last > STALE_AFTER_MS;
    }),
  );

  // A detached scan folder would otherwise only come back through the native
  // picker, so scanned roots stay listed for a one-click re-import.
  function rememberRecentRoot(root) {
    const entry = normalizeRoot(root);
    if (!entry?.path) return;
    const rest = recentRoots.value.filter(
      (item) => item.path !== entry.path && item.rootId !== entry.rootId,
    );
    recentRoots.value = [entry, ...rest].slice(0, RECENT_ROOTS_LIMIT);
  }

  // What the detach dialog has to promise up front: how many assets belong to
  // this folder alone, and how many of those a document still references.
  function assetsUnderRoot(rootId) {
    const exclusive = assetsExclusiveToRoot(
      assets.value.filter((asset) => !asset.deletedAt),
      rootId,
    );
    return {
      total: exclusive.length,
      inUse: exclusive.filter((asset) => asset.usage?.length).length,
    };
  }

  async function remountRoot(rootId) {
    const remembered = recentRoots.value.find((root) => root.rootId === rootId);
    if (!remembered?.path) return null;
    return runFolderScan(remembered.path, remembered);
  }

  // Dropping the shortcut is not detaching: the assets stay in the library and
  // the folder can still be scanned again through the native picker. Only a
  // mounted root is refused, because forgetting it would leave its section
  // without the rescan and detach controls.
  function forgetRoot(rootId) {
    if (roots.value.some((root) => root.rootId === rootId)) return false;
    const next = recentRoots.value.filter((root) => root.rootId !== rootId);
    if (next.length === recentRoots.value.length) return false;
    recentRoots.value = next;
    flushPersist();
    return true;
  }

  function detachRoot(rootId, { archive = false } = {}) {
    const detached = roots.value.find((root) => root.rootId === rootId) || null;
    roots.value = roots.value.filter((root) => root.rootId !== rootId);
    if (detached) rememberRecentRoot(detached);
    const archiveIds = new Set();
    let keptInUse = 0;
    if (archive) {
      for (const asset of assetsExclusiveToRoot(assets.value, rootId)) {
        if (asset.deletedAt) continue;
        if (asset.usage?.length) {
          keptInUse += 1;
          continue;
        }
        archiveIds.add(asset.assetId);
      }
    }
    // One array rebuild and one write for the whole detach: stripping entries
    // per asset leaves the root gone while its entries survive, which is how a
    // mounted folder ends up orphaned.
    const stamp = nowIso();
    let changed = false;
    const nextAssets = assets.value.map((asset) => {
      const entries = folderAssetPaths(asset);
      const hasRoot = entries.some((entry) => entry.rootId === rootId);
      const toArchive = archiveIds.has(asset.assetId);
      if (!hasRoot && !toArchive) return asset;
      const folders = hasRoot ? entries.filter((entry) => entry.rootId !== rootId) : entries;
      const deletedAt = toArchive ? stamp : asset.deletedAt;
      if (folders.length === entries.length && deletedAt === asset.deletedAt) return asset;
      changed = true;
      return { ...asset, folders, deletedAt, updatedAt: stamp };
    });
    if (changed) assets.value = nextAssets;
    if (splitFolderKey(filters.folder)?.rootId === rootId) filters.folder = "";
    selectedIds.value = selectedIds.value.filter((id) => !archiveIds.has(id));
    flushPersist();
    return { archived: archiveIds.size, keptInUse };
  }

  async function getThumbUrl(assetId) {
    if (!initialized.value && readyPromise) await readyPromise;
    const asset = findAsset(assetId);
    if (!asset) return "";
    if (thumbCache.has(assetId)) return thumbCache.get(assetId);
    if (asset.thumbDataUrl) return rememberThumb(assetId, asset.thumbDataUrl);
    if (asset.dataUrl) return rememberThumb(assetId, asset.dataUrl);
    if (!asset.thumbPath && isTauri()) {
      return getAssetDataUrl(assetId);
    }
    if (!isTauri()) return "";
    if (thumbRequests.has(assetId)) return thumbRequests.get(assetId);
    const request = invoke("read_asset_file", { assetId, variant: "thumb" })
      .then((result) => rememberThumb(assetId, result?.dataUrl || ""))
      .catch(() => "")
      .finally(() => thumbRequests.delete(assetId));
    thumbRequests.set(assetId, request);
    return request;
  }

  async function getAssetDataUrl(assetId) {
    if (!initialized.value && readyPromise) await readyPromise;
    const asset = findAsset(assetId);
    if (!asset) return "";
    if (sourceCache.has(assetId)) return sourceCache.get(assetId);
    if (asset.dataUrl) return rememberSource(assetId, asset.dataUrl);
    if (!isTauri()) return "";
    if (sourceRequests.has(assetId)) return sourceRequests.get(assetId);
    const request = invoke("read_asset_file", { assetId, variant: null })
      .then((result) => rememberSource(assetId, result?.dataUrl || ""))
      .catch(() => "")
      .finally(() => sourceRequests.delete(assetId));
    sourceRequests.set(assetId, request);
    return request;
  }

  async function getAssetBlob(assetId) {
    const dataUrl = await getAssetDataUrl(assetId);
    if (!dataUrl) return null;
    const response = await fetch(dataUrl);
    return response.blob();
  }

  function updateAsset(assetId, patch = {}) {
    const index = assets.value.findIndex((asset) => asset.assetId === assetId);
    if (index < 0) return null;
    const current = assets.value[index];
    const next = {
      ...current,
      ...patch,
      rights: patch.rights ? { ...current.rights, ...patch.rights } : current.rights,
      ai: patch.ai ? { ...current.ai, ...patch.ai } : current.ai,
      source: patch.source ? { ...current.source, ...patch.source } : current.source,
      tags: patch.tags
        ? patch.tags.map((tag) => String(tag).trim()).filter(Boolean).slice(0, 30)
        : current.tags,
      updatedAt: nowIso(),
    };
    assets.value = assets.value.map((asset, itemIndex) => (itemIndex === index ? next : asset));
    persistSoon();
    return next;
  }

  function setTags(assetId, tags) {
    return updateAsset(assetId, { tags });
  }

  function setAlt(assetId, alt) {
    return updateAsset(assetId, { alt: String(alt || "").slice(0, 500) });
  }

  function setRights(assetId, rights) {
    return updateAsset(assetId, { rights });
  }

  function addUsage(assetId, usage) {
    const ref = createUsageRef(usage);
    const asset = findAsset(assetId);
    if (!asset || !ref) return false;
    if (asset.usage.some((item) => item.workId === ref.workId && item.ref === ref.ref)) return false;
    updateAsset(assetId, { usage: [...asset.usage, ref] });
    flushPersist();
    return true;
  }

  function removeUsage(assetId, usage) {
    const asset = findAsset(assetId);
    if (!asset) return false;
    const nextUsage = asset.usage.filter(
      (item) => item.workId !== usage?.workId || item.ref !== usage?.ref,
    );
    if (nextUsage.length === asset.usage.length) return false;
    updateAsset(assetId, { usage: nextUsage });
    flushPersist();
    return true;
  }

  function usageFor(assetId) {
    return findAsset(assetId)?.usage || [];
  }

  async function ensureMirror(assetId, documentPath) {
    const asset = findAsset(assetId);
    if (!asset || !documentPath || !isTauri()) return null;
    try {
      const result = await invoke("mirror_asset", {
        assetId,
        documentPath,
      });
      if (result?.relativePath && !asset.projectPaths.includes(result.relativePath)) {
        updateAsset(assetId, { projectPaths: [...asset.projectPaths, result.relativePath] });
      }
      return result?.relativePath || null;
    } catch (err) {
      error.value = err?.message || String(err);
      return null;
    }
  }

  async function buildMarkdownSnippet(assetId, documentPath, altText = "") {
    const asset = findAsset(assetId);
    if (!asset) return null;
    let source = "";
    let mirrored = false;
    if (documentPath) {
      const relativePath = await ensureMirror(assetId, documentPath);
      if (relativePath) {
        source = relativePath;
        mirrored = true;
      }
    }
    if (!source) {
      source = await getAssetDataUrl(assetId);
    }
    if (!source) return null;
    const alt = String(altText || asset.alt || asset.name || "").replace(/[\[\]]/g, "");
    return {
      markdown: `![${alt}](${source})`,
      source,
      mirrored,
    };
  }

  async function archiveAsset(assetId, { force = false } = {}) {
    const asset = findAsset(assetId);
    if (!asset) return { ok: false, blocked: false };
    if (asset.usage.length && !force) {
      return { ok: false, blocked: true, usage: asset.usage };
    }
    updateAsset(assetId, { deletedAt: nowIso() });
    selectedIds.value = selectedIds.value.filter((id) => id !== assetId);
    await flushPersist();
    return { ok: true, blocked: false };
  }

  function restoreAsset(assetId) {
    const asset = findAsset(assetId);
    if (!asset) return null;
    return updateAsset(assetId, { deletedAt: null });
  }

  async function purgeAsset(assetId, { force = false } = {}) {
    const asset = findAsset(assetId);
    if (!asset) return { ok: false, blocked: false };
    if (asset.usage.length && !force) {
      return { ok: false, blocked: true, usage: asset.usage };
    }
    try {
      if (isTauri()) {
        await invoke("delete_asset_file", { assetId });
      } else {
        await deleteBrowserAsset(assetId);
      }
    } catch (err) {
      error.value = err?.message || String(err);
      return { ok: false, blocked: false, error: error.value };
    }
    assets.value = assets.value.filter((item) => item.assetId !== assetId);
    selectedIds.value = selectedIds.value.filter((id) => id !== assetId);
    thumbCache.delete(assetId);
    sourceCache.delete(assetId);
    await flushPersist();
    return { ok: true, blocked: false };
  }

  // Batch mutations rebuild the assets array once and persist once, because
  // every flushPersist re-serializes the whole index.
  function addTagsToAssets(assetIds, tags) {
    const idSet = new Set(assetIds);
    const additions = (tags || []).map((tag) => String(tag).trim()).filter(Boolean);
    if (!idSet.size || !additions.length) return 0;
    let changed = 0;
    assets.value = assets.value.map((asset) => {
      if (!idSet.has(asset.assetId) || asset.deletedAt) return asset;
      const merged = [...new Set([...(asset.tags || []), ...additions])].slice(0, 30);
      if (merged.length === (asset.tags || []).length) return asset;
      changed += 1;
      return { ...asset, tags: merged, updatedAt: nowIso() };
    });
    if (changed) flushPersist();
    return changed;
  }

  function countUsedAmong(assetIds) {
    const idSet = new Set(assetIds);
    return assets.value.filter((asset) => idSet.has(asset.assetId) && asset.usage?.length).length;
  }

  async function archiveAssets(assetIds, { force = false } = {}) {
    const idSet = new Set(assetIds);
    if (!idSet.size) return { ok: false, blocked: false, count: 0 };
    const blocked = countUsedAmong(assetIds);
    if (blocked && !force) return { ok: false, blocked: true, count: blocked };
    const stamp = nowIso();
    let archived = 0;
    assets.value = assets.value.map((asset) => {
      if (!idSet.has(asset.assetId) || asset.deletedAt) return asset;
      archived += 1;
      return { ...asset, deletedAt: stamp, updatedAt: stamp };
    });
    selectedIds.value = selectedIds.value.filter((id) => !idSet.has(id));
    await flushPersist();
    return { ok: true, blocked: false, count: archived };
  }

  function restoreAssets(assetIds) {
    const idSet = new Set(assetIds);
    let restored = 0;
    assets.value = assets.value.map((asset) => {
      if (!idSet.has(asset.assetId) || !asset.deletedAt) return asset;
      restored += 1;
      return { ...asset, deletedAt: null, updatedAt: nowIso() };
    });
    if (restored) {
      selectedIds.value = selectedIds.value.filter((id) => !idSet.has(id));
      flushPersist();
    }
    return restored;
  }

  async function purgeAssets(assetIds, { force = false } = {}) {
    const idSet = new Set(assetIds);
    if (!idSet.size) return { ok: false, blocked: false, count: 0 };
    const blocked = countUsedAmong(assetIds);
    if (blocked && !force) return { ok: false, blocked: true, count: blocked };
    try {
      for (const assetId of idSet) {
        if (isTauri()) await invoke("delete_asset_file", { assetId });
        else await deleteBrowserAsset(assetId);
        thumbCache.delete(assetId);
        sourceCache.delete(assetId);
      }
    } catch (err) {
      error.value = err?.message || String(err);
      return { ok: false, blocked: false, count: 0, error: error.value };
    }
    const purged = assets.value.filter((asset) => idSet.has(asset.assetId)).length;
    assets.value = assets.value.filter((asset) => !idSet.has(asset.assetId));
    selectedIds.value = selectedIds.value.filter((id) => !idSet.has(id));
    await flushPersist();
    return { ok: true, blocked: false, count: purged };
  }

  function toggleSelection(assetId) {
    selectedIds.value = selectedIds.value.includes(assetId)
      ? selectedIds.value.filter((id) => id !== assetId)
      : [...selectedIds.value, assetId];
  }

  function selectOnly(assetId) {
    selectedIds.value = assetId ? [assetId] : [];
  }

  function selectAllVisible() {
    selectedIds.value = filteredAssets.value.map((asset) => asset.assetId);
  }

  function clearSelection() {
    selectedIds.value = [];
  }

  function setFilter(key, value) {
    if (!(key in filters)) return;
    filters[key] = value;
    selectedIds.value = [];
  }

  function setSort(value) {
    if (!SORT_OPTIONS.includes(value)) return;
    sort.value = value;
    selectedIds.value = [];
    try {
      localStorage.setItem(SORT_KEY, value);
    } catch {
      // The chosen sort is optional; the in-memory value still applies.
    }
  }

  function resetFilters() {
    Object.assign(filters, DEFAULT_FILTERS);
    query.value = "";
    setSort("newest");
  }

  function openNativePicker() {
    if (!isTauri()) return Promise.resolve({ needsBrowserPicker: true });
    return invoke("pick_asset_files").then((paths) => {
      if (!paths?.length) return { added: 0, duplicates: 0, failed: 0, cancelled: true };
      return importPaths(paths);
    });
  }

  readyPromise = init();

  return {
    assets,
    activeAssets,
    trashedAssets,
    filteredAssets,
    selectedIds,
    selectedAssets,
    stats,
    query,
    filters,
    sort,
    sortOptions: SORT_OPTIONS,
    setSort,
    isLoading,
    isImporting,
    error,
    importMessage,
    lastImport,
    hasAssets,
    isDesktop,
    roots,
    recentRoots,
    folderTree,
    sourceTree,
    staleRoots,
    scanProgress,
    scanFolder,
    rescanRoot,
    rescanAllRoots,
    relocateRoot,
    remountRoot,
    forgetRoot,
    assetsUnderRoot,
    detachRoot,
    filteredCount: computed(() => filteredAssets.value.length),
    init,
    refresh: () => init(true),
    importPaths,
    importFiles,
    importFromDataUrl,
    openNativePicker,
    getThumbUrl,
    getAssetDataUrl,
    getAssetBlob,
    getAsset: findAsset,
    updateAsset,
    setTags,
    setAlt,
    setRights,
    addUsage,
    removeUsage,
    usageFor,
    ensureMirror,
    buildMarkdownSnippet,
    archiveAsset,
    restoreAsset,
    purgeAsset,
    allTags,
    addTagsToAssets,
    archiveAssets,
    restoreAssets,
    purgeAssets,
    toggleSelection,
    selectOnly,
    selectAllVisible,
    clearSelection,
    setFilter,
    resetFilters,
    formatDimensions,
    persistNow,
  };
}
