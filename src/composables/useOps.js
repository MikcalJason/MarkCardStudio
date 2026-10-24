import { computed, ref } from "vue";
import { clearOpsMetrics, mergeOpsRows, readOpsMetrics } from "../storage/opsMetrics.js";
import { readOpsReviews, removeOpsReview, saveOpsReview } from "../storage/opsReviews.js";
import { parseImportText } from "../utils/opsImport.js";

const NUMERIC_FIELDS = ["reads", "shares", "favorites", "newFollowers", "lostFollowers"];
const PACE_WEEKS = 8;

function isoFromDate(date) {
  return date.toISOString().slice(0, 10);
}

function dateFromIso(iso) {
  return new Date(`${iso}T00:00:00Z`);
}

export function localIsoDate(date = new Date()) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 10);
}

function shiftDays(iso, delta) {
  const date = dateFromIso(iso);
  date.setUTCDate(date.getUTCDate() + delta);
  return isoFromDate(date);
}

function weekStartOf(iso) {
  const date = dateFromIso(iso);
  const weekday = (date.getUTCDay() + 6) % 7;
  date.setUTCDate(date.getUTCDate() - weekday);
  return isoFromDate(date);
}

function emptyTotals() {
  return Object.fromEntries(NUMERIC_FIELDS.map((field) => [field, 0]));
}

export function useOps({ history } = {}) {
  const metrics = ref(readOpsMetrics());
  const reviews = ref(readOpsReviews());

  const records = computed(() => history?.records?.value || []);
  const published = computed(() => records.value.filter((record) => record.status !== "failed"));

  const today = localIsoDate();
  const windowStart = shiftDays(today, -29);

  const windowDays = computed(() =>
    metrics.value.days.filter((day) => day.date >= windowStart),
  );

  const totals = computed(() => {
    const sum = emptyTotals();
    for (const day of windowDays.value) {
      for (const field of NUMERIC_FIELDS) sum[field] += day[field] || 0;
    }
    sum.netFollowers = Math.max(0, sum.newFollowers - sum.lostFollowers);
    return sum;
  });

  const publishedInWindow = computed(() =>
    published.value.filter((record) => String(record.createdAt || "").slice(0, 10) >= windowStart),
  );

  const pace = computed(() => {
    const buckets = new Map();
    let cursor = weekStartOf(today);
    for (let index = 0; index < PACE_WEEKS; index += 1) {
      buckets.set(cursor, 0);
      cursor = shiftDays(cursor, -7);
    }
    for (const record of published.value) {
      const key = weekStartOf(String(record.createdAt || "").slice(0, 10));
      if (buckets.has(key)) buckets.set(key, buckets.get(key) + 1);
    }
    const weeks = [...buckets.entries()]
      .map(([start, count]) => ({ start, count }))
      .sort((left, right) => left.start.localeCompare(right.start));
    const peak = weeks.reduce((max, week) => Math.max(max, week.count), 0);
    return weeks.map((week) => ({ ...week, ratio: peak ? week.count / peak : 0 }));
  });

  const channelBreakdown = computed(() => {
    const counts = new Map();
    for (const record of published.value) {
      const id = String(record.channelId || "unknown");
      counts.set(id, (counts.get(id) || 0) + 1);
    }
    return [...counts.entries()]
      .map(([channelId, count]) => ({ channelId, count }))
      .sort((left, right) => right.count - left.count);
  });

  const publishByDate = computed(() => {
    const map = new Map();
    for (const record of published.value) {
      const date = String(record.createdAt || "").slice(0, 10);
      if (!date) continue;
      if (!map.has(date)) map.set(date, []);
      map.get(date).push(record);
    }
    return map;
  });

  const metricsByDate = computed(() => {
    const map = new Map();
    for (const day of metrics.value.days) {
      const entry = map.get(day.date) || emptyTotals();
      for (const field of NUMERIC_FIELDS) entry[field] += day[field] || 0;
      map.set(day.date, entry);
    }
    return map;
  });

  function daySummary(date) {
    return {
      publishes: publishByDate.value.get(date) || [],
      metrics: metricsByDate.value.get(date) || emptyTotals(),
    };
  }

  function importText({ channel, fileName = "", text = "" }) {
    const parsed = parseImportText(text);
    if (parsed.error) return parsed;
    const merged = mergeOpsRows({
      channel,
      fileName,
      records: parsed.records,
      skipped: parsed.skipped,
      fields: parsed.fields,
    });
    metrics.value = { days: merged.days, imports: merged.imports };
    return { ...parsed, affected: merged.affected };
  }

  function clearMetrics() {
    metrics.value = clearOpsMetrics();
  }

  function saveReview(record) {
    reviews.value = saveOpsReview(record);
  }

  function removeReview(id) {
    reviews.value = removeOpsReview(id);
  }

  function refresh() {
    metrics.value = readOpsMetrics();
    reviews.value = readOpsReviews();
  }

  return {
    channelBreakdown,
    clearMetrics,
    daySummary,
    importText,
    lastImport: computed(() => metrics.value.imports[0] || null),
    metrics,
    pace,
    publishByDate,
    published,
    publishedInWindow,
    refresh,
    removeReview,
    reviews,
    saveReview,
    today,
    totals,
    windowDays,
    windowStart,
  };
}
