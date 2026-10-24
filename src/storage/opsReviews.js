const REVIEWS_KEY = "markcard_ops_reviews_v1";
const MAX_REVIEWS = 200;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TEXT_FIELDS = ["highlights", "problems", "hypotheses", "nextSteps"];
const MAX_TEXT_CHARS = 2000;

function isoNow() {
  return new Date().toISOString();
}

function localIsoDate() {
  const now = new Date();
  const offset = now.getTimezoneOffset() * 60_000;
  return new Date(now.getTime() - offset).toISOString().slice(0, 10);
}

function normalizeText(value) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, MAX_TEXT_CHARS);
}

function normalizeReview(raw) {
  if (!raw || typeof raw !== "object") return null;
  const id = typeof raw.id === "string" && raw.id ? raw.id : null;
  if (!id) return null;
  const review = {
    id,
    title: typeof raw.title === "string" ? raw.title.trim().slice(0, 120) : "",
    date: typeof raw.date === "string" && DATE_PATTERN.test(raw.date) ? raw.date : localIsoDate(),
    createdAt: typeof raw.createdAt === "string" && raw.createdAt ? raw.createdAt : isoNow(),
    updatedAt: typeof raw.updatedAt === "string" && raw.updatedAt ? raw.updatedAt : isoNow(),
  };
  for (const field of TEXT_FIELDS) review[field] = normalizeText(raw[field]);
  return review;
}

function sortReviews(reviews) {
  return [...reviews].sort((left, right) => right.date.localeCompare(left.date));
}

function writeReviews(reviews) {
  try {
    localStorage.setItem(REVIEWS_KEY, JSON.stringify(reviews));
  } catch {
    // A review draft the user cannot save is worse than silent loss, but the
    // storage quota is out of our control; keep the in-memory list authoritative.
  }
}

export function readOpsReviews() {
  try {
    const parsed = JSON.parse(localStorage.getItem(REVIEWS_KEY) || "[]");
    if (!Array.isArray(parsed)) return [];
    return sortReviews(parsed.map(normalizeReview).filter(Boolean).slice(0, MAX_REVIEWS));
  } catch {
    return [];
  }
}

export function saveOpsReview(record = {}) {
  const existing = readOpsReviews();
  const previous = record.id ? existing.find((item) => item.id === record.id) : null;
  const normalized = normalizeReview({
    ...record,
    id: record.id || `rev_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    date: record.date || localIsoDate(),
    createdAt: previous?.createdAt || record.createdAt || isoNow(),
    updatedAt: isoNow(),
  });
  if (!normalized) return existing;
  const next = sortReviews([normalized, ...existing.filter((item) => item.id !== normalized.id)]);
  writeReviews(next);
  return next;
}

export function removeOpsReview(id) {
  const next = readOpsReviews().filter((review) => review.id !== id);
  writeReviews(next);
  return next;
}
