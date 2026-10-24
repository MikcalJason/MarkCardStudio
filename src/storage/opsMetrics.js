import { PUBLISH_CHANNELS } from "../config/publishChannels.js";

// Imported platform numbers live next to the local publish log, never in it:
// the log describes what this app produced, metrics describe how it performed.
const METRICS_KEY = "markcard_ops_metrics_v1";
const MAX_IMPORTS = 40;
const CHANNEL_IDS = PUBLISH_CHANNELS.map((channel) => channel.id);
const NUMERIC_FIELDS = ["reads", "shares", "favorites", "newFollowers", "lostFollowers"];
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function isoNow() {
  return new Date().toISOString();
}

function normalizeCount(value) {
  return Number.isFinite(value) && value > 0 ? Math.round(value) : 0;
}

function normalizeDay(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (!CHANNEL_IDS.includes(raw.channel)) return null;
  if (typeof raw.date !== "string" || !DATE_PATTERN.test(raw.date)) return null;
  const day = { channel: raw.channel, date: raw.date };
  for (const field of NUMERIC_FIELDS) day[field] = normalizeCount(raw[field]);
  return day;
}

function normalizeImport(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = typeof raw.id === "string" && raw.id ? raw.id : null;
  if (!id) return null;
  return {
    id,
    at: typeof raw.at === "string" ? raw.at : isoNow(),
    channel: CHANNEL_IDS.includes(raw.channel) ? raw.channel : "",
    fileName: typeof raw.fileName === "string" ? raw.fileName.slice(0, 120) : "",
    rowCount: normalizeCount(raw.rowCount),
    skipped: normalizeCount(raw.skipped),
    fields: Array.isArray(raw.fields)
      ? raw.fields.filter((field) => NUMERIC_FIELDS.includes(field))
      : [],
  };
}

function writeMetrics(days, imports) {
  try {
    localStorage.setItem(METRICS_KEY, JSON.stringify({ days, imports }));
  } catch {
    // Metrics are re-importable; a full quota must not break the workspace.
  }
}

export function readOpsMetrics() {
  try {
    const parsed = JSON.parse(localStorage.getItem(METRICS_KEY) || "{}");
    const days = Array.isArray(parsed?.days)
      ? parsed.days.map(normalizeDay).filter(Boolean)
      : [];
    const imports = Array.isArray(parsed?.imports)
      ? parsed.imports.map(normalizeImport).filter(Boolean).slice(0, MAX_IMPORTS)
      : [];
    return { days, imports };
  } catch {
    return { days: [], imports: [] };
  }
}

export function mergeOpsRows({ channel, fileName = "", records = [], skipped = 0, fields = [] }) {
  const existing = readOpsMetrics();
  const imported = fields.filter((field) => NUMERIC_FIELDS.includes(field));
  const byKey = new Map(existing.days.map((day) => [`${day.channel}:${day.date}`, day]));
  let affected = 0;
  for (const record of records) {
    const day = normalizeDay({ ...record, channel });
    if (!day) continue;
    const key = `${day.channel}:${day.date}`;
    const previous = byKey.get(key);
    if (!previous) {
      byKey.set(key, day);
      affected += 1;
      continue;
    }
    // Reports cover different columns (articles vs followers), so a re-import
    // replaces only the columns it carries instead of resetting the whole day.
    const merged = { ...previous };
    for (const field of imported) merged[field] = day[field];
    byKey.set(key, merged);
    affected += 1;
  }
  if (!affected) return { ...existing, affected: 0 };
  const days = [...byKey.values()].sort(
    (left, right) => left.date.localeCompare(right.date) || left.channel.localeCompare(right.channel),
  );
  const entry = {
    id: `imp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    at: isoNow(),
    channel,
    fileName,
    rowCount: affected,
    skipped: normalizeCount(skipped),
    fields,
  };
  const imports = [entry, ...existing.imports].slice(0, MAX_IMPORTS);
  writeMetrics(days, imports);
  return { days, imports, affected };
}

export function clearOpsMetrics() {
  try {
    localStorage.removeItem(METRICS_KEY);
  } catch {
    // Nothing to do; the in-memory state is reset by the caller.
  }
  return { days: [], imports: [] };
}
