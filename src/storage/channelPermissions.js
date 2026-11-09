// Cached results of the read-only interface-permission probe. Only interface
// keys and verdicts are stored here; error text can carry the account's egress
// IP, so it never reaches local storage.
const PERMISSIONS_KEY = "markcard_channel_permissions_v1";
const STATUSES = ["allowed", "unauthorized", "blockedIp", "invalidCredentials", "busy", "unknown"];
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function normalizeItems(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const items = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const key = typeof entry.key === "string" ? entry.key.trim() : "";
    if (!key || seen.has(key)) continue;
    seen.add(key);
    items.push({ key, status: STATUSES.includes(entry.status) ? entry.status : "unknown" });
  }
  return items;
}

function readAll() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PERMISSIONS_KEY) || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function writeAll(records) {
  try {
    localStorage.setItem(PERMISSIONS_KEY, JSON.stringify(records));
  } catch {
    // The cache only decorates the publish UI, so a full quota is not an error.
  }
}

export function readChannelPermissions(channel) {
  if (typeof channel !== "string" || !channel) return null;
  const record = readAll()[channel];
  if (!record || typeof record !== "object") return null;
  const items = normalizeItems(record.items);
  if (!items.length) return null;
  const probedAt = typeof record.probedAt === "string" ? Date.parse(record.probedAt) : NaN;
  if (!Number.isFinite(probedAt) || Date.now() - probedAt > MAX_AGE_MS) return null;
  return { channel, probedAt, items };
}

export function writeChannelPermissions(channel, items) {
  const normalized = normalizeItems(items);
  const all = readAll();
  if (!channel || !normalized.length) {
    if (channel && all[channel]) {
      delete all[channel];
      writeAll(all);
    }
    return null;
  }
  all[channel] = { probedAt: new Date().toISOString(), items: normalized };
  writeAll(all);
  return readChannelPermissions(channel);
}

export function clearChannelPermissions(channel) {
  return writeChannelPermissions(channel, []);
}

// The publish flow needs more than a yes/no: a whitelist miss and a dead token
// both read as "never checked" if they collapse to unknown, and then the user
// has nothing to act on.
const DRAFT_VERDICTS = {
  allowed: "allowed",
  unauthorized: "denied",
  blockedIp: "blocked",
  invalidCredentials: "invalid",
  busy: "retry",
};

export function draftProbeVerdict(channel) {
  if (typeof channel !== "string" || !channel) return "missing";
  const draft = readChannelPermissions(channel)
    ?.items.find((item) => item.key === "draft");
  if (!draft) return "missing";
  return DRAFT_VERDICTS[draft.status] || "unknown";
}
