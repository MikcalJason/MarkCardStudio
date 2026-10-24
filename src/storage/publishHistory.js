const HISTORY_KEY = "markcard_publish_history_v1";
const MAX_RECORDS = 120;
const STATUSES = ["bundle", "assisted", "draft", "published", "failed"];

function isoNow() {
  return new Date().toISOString();
}

function normalizeRecord(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = typeof raw.id === "string" && raw.id ? raw.id : null;
  const channelId = typeof raw.channelId === "string" && raw.channelId ? raw.channelId : "";
  if (!id || !channelId) return null;
  return {
    id,
    schemaVersion: 1,
    workId: typeof raw.workId === "string" ? raw.workId : "",
    channelId,
    status: STATUSES.includes(raw.status) ? raw.status : "failed",
    mode: raw.mode === "publish" ? "publish" : "draft",
    title: typeof raw.title === "string" ? raw.title.slice(0, 200) : "",
    contentHash: typeof raw.contentHash === "string" ? raw.contentHash : "",
    bundlePath: typeof raw.bundlePath === "string" ? raw.bundlePath : "",
    remoteId: typeof raw.remoteId === "string" ? raw.remoteId : "",
    error: typeof raw.error === "string" ? raw.error.slice(0, 400) : "",
    imageCount: Number.isFinite(raw.imageCount) ? raw.imageCount : 0,
    createdAt: typeof raw.createdAt === "string" ? raw.createdAt : isoNow(),
  };
}

function writeHistory(records) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(records));
  } catch {
    // History is a convenience log; keep the in-memory list when storage is full.
  }
}

export function readPublishHistory() {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeRecord).filter(Boolean).slice(0, MAX_RECORDS);
  } catch {
    return [];
  }
}

export function appendPublishRecord(record = {}) {
  const normalized = normalizeRecord({
    ...record,
    id: record.id || `pub_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    createdAt: record.createdAt || isoNow(),
  });
  if (!normalized) return readPublishHistory();
  const next = [normalized, ...readPublishHistory().filter((item) => item.id !== normalized.id)];
  const trimmed = next.slice(0, MAX_RECORDS);
  writeHistory(trimmed);
  return trimmed;
}

export function removePublishRecord(id) {
  const next = readPublishHistory().filter((record) => record.id !== id);
  writeHistory(next);
  return next;
}

export function findPublishRecord({ channelId = "", contentHash = "" } = {}) {
  if (!channelId || !contentHash) return null;
  return (
    readPublishHistory().find(
      (record) => record.channelId === channelId && record.contentHash === contentHash,
    ) || null
  );
}
