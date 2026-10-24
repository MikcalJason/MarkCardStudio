<script setup>
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import AppIcon from "../AppIcon.vue";
import { PUBLISH_CHANNELS } from "../../config/publishChannels.js";
import { useOps } from "../../composables/useOps.js";
import { parseImportText } from "../../utils/opsImport.js";

const props = defineProps({
  library: {
    type: Object,
    default: null,
  },
  history: {
    type: Object,
    default: null,
  },
});

const { t, locale } = useI18n();
const ops = useOps({ history: props.history });

const tabs = [
  { id: "overview", labelKey: "ops.tabs.overview", icon: "bar-chart-3" },
  { id: "calendar", labelKey: "ops.tabs.calendar", icon: "calendar" },
  { id: "reviews", labelKey: "ops.tabs.reviews", icon: "file-text" },
];
const activeTab = ref("overview");

const numberFormat = computed(() => new Intl.NumberFormat(locale.value));
const dateFormat = computed(
  () => new Intl.DateTimeFormat(locale.value, { year: "numeric", month: "long", timeZone: "UTC" }),
);
const weekdayKeys = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

function fmt(value) {
  return numberFormat.value.format(Number(value) || 0);
}

function channelLabel(channelId) {
  const channel = PUBLISH_CHANNELS.find((item) => item.id === channelId);
  return channel ? t(channel.labelKey) : channelId;
}

const topAssets = computed(() => {
  const assets = props.library?.assets?.value || [];
  return [...assets]
    .filter((asset) => asset.usage?.length)
    .sort((left, right) => right.usage.length - left.usage.length)
    .slice(0, 5);
});

const maxChannelCount = computed(() =>
  ops.channelBreakdown.value.reduce((max, item) => Math.max(max, item.count), 0),
);

// Calendar
const observed = new Date();
const monthCursor = ref(new Date(Date.UTC(observed.getFullYear(), observed.getMonth(), 1)));
const selectedDate = ref(ops.today);

const monthLabel = computed(() => dateFormat.value.format(monthCursor.value));
const calendarCells = computed(() => {
  const year = monthCursor.value.getUTCFullYear();
  const month = monthCursor.value.getUTCMonth();
  const offset = (new Date(Date.UTC(year, month, 1)).getUTCDay() + 6) % 7;
  const start = Date.UTC(year, month, 1 - offset);
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start + index * 86_400_000);
    const iso = date.toISOString().slice(0, 10);
    const summary = ops.daySummary(iso);
    return {
      iso,
      day: date.getUTCDate(),
      inMonth: date.getUTCMonth() === month,
      isToday: iso === ops.today,
      publishes: summary.publishes,
      metrics: summary.metrics,
    };
  });
});
const monthPublishCount = computed(() =>
  calendarCells.value
    .filter((cell) => cell.inMonth)
    .reduce((total, cell) => total + cell.publishes.length, 0),
);
const selectedSummary = computed(() => ops.daySummary(selectedDate.value));

function shiftMonth(delta) {
  const cursor = monthCursor.value;
  monthCursor.value = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + delta, 1));
}

// Import dialog
const importOpen = ref(false);
const importChannel = ref(PUBLISH_CHANNELS[0].id);
const importFileName = ref("");
const importDraft = ref("");
const importMessage = ref("");
const importError = ref("");

const preview = computed(() => (importDraft.value.trim() ? parseImportText(importDraft.value) : null));
const previewError = computed(() => {
  const result = preview.value;
  return result?.error ? t(`ops.import.errors.${result.error}`) : "";
});

function openImport() {
  importOpen.value = true;
  importDraft.value = "";
  importFileName.value = "";
  importError.value = "";
}

async function readImportFile(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  try {
    importDraft.value = await file.text();
    importFileName.value = file.name;
    importError.value = "";
  } catch (err) {
    importError.value = String(err?.message || err);
  }
}

function confirmImport() {
  if (!preview.value || preview.value.error) return;
  const result = ops.importText({
    channel: importChannel.value,
    fileName: importFileName.value,
    text: importDraft.value,
  });
  if (result.error) {
    importError.value = t(`ops.import.errors.${result.error}`);
    return;
  }
  importOpen.value = false;
  importMessage.value = t("ops.import.done", { count: result.affected });
}

function clearMetrics() {
  if (!window.confirm(t("ops.import.clearConfirm"))) return;
  ops.clearMetrics();
  importMessage.value = t("ops.import.cleared");
}

// Reviews
const editingId = ref("");
const reviewError = ref("");
const reviewDraft = ref(emptyReview());

function emptyReview() {
  return {
    id: "",
    title: "",
    date: ops.today,
    highlights: "",
    problems: "",
    hypotheses: "",
    nextSteps: "",
  };
}

function startNewReview() {
  editingId.value = "new";
  reviewDraft.value = emptyReview();
  reviewError.value = "";
}

function startEditReview(review) {
  editingId.value = review.id;
  reviewDraft.value = { ...review };
  reviewError.value = "";
}

function cancelReview() {
  editingId.value = "";
  reviewError.value = "";
}

function saveReview() {
  const draft = reviewDraft.value;
  const hasBody = ["highlights", "problems", "hypotheses", "nextSteps"].some((field) =>
    String(draft[field] || "").trim(),
  );
  if (!draft.title.trim()) {
    reviewError.value = t("ops.reviews.titleRequired");
    return;
  }
  if (!hasBody) {
    reviewError.value = t("ops.reviews.bodyRequired");
    return;
  }
  ops.saveReview({ ...draft, id: draft.id || undefined });
  editingId.value = "";
  reviewError.value = "";
}

function deleteReview(review) {
  if (!window.confirm(t("ops.reviews.deleteConfirm"))) return;
  ops.removeReview(review.id);
  if (editingId.value === review.id) editingId.value = "";
}
</script>

<template>
  <section class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
    <header class="flex shrink-0 flex-wrap items-center gap-3 rounded-2xl border border-slate-200/80 bg-white/85 px-4 py-3 shadow-sm dark:border-slate-700/80 dark:bg-slate-900/80">
      <div class="flex min-w-0 items-center gap-2.5">
        <span class="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-violet-50 text-violet-600 dark:bg-violet-950/50 dark:text-violet-300">
          <AppIcon name="bar-chart-3" :size="17" />
        </span>
        <div class="min-w-0">
          <h1 class="text-sm font-extrabold tracking-tight text-slate-800 dark:text-slate-100">{{ t("workspace.opsTitle") }}</h1>
          <p class="truncate text-[11px] text-slate-500 dark:text-slate-400">{{ t("ops.subtitle") }}</p>
        </div>
      </div>

      <div class="inline-flex h-8 items-center rounded-lg border border-slate-200 bg-slate-100/80 p-0.5 dark:border-slate-700 dark:bg-slate-800" role="tablist">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          type="button"
          role="tab"
          :aria-selected="activeTab === tab.id"
          class="inline-flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold transition-colors cursor-pointer"
          :class="activeTab === tab.id
            ? 'bg-white text-blue-600 shadow-sm dark:bg-slate-700 dark:text-blue-300'
            : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'"
          @click="activeTab = tab.id"
        >
          <AppIcon :name="tab.icon" :size="13" />
          {{ t(tab.labelKey) }}
        </button>
      </div>

      <button
        type="button"
        class="ml-auto inline-flex h-8 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-xs font-bold text-white transition-colors hover:bg-blue-700 cursor-pointer"
        @click="openImport"
      >
        <AppIcon name="upload" :size="14" />
        {{ t("ops.import.button") }}
      </button>
    </header>

    <div class="mt-3 min-h-0 flex-1 overflow-y-auto pr-0.5">
      <p
        v-if="importMessage"
        class="mb-2 flex items-center gap-2 rounded-xl border border-emerald-200/80 bg-emerald-50/70 px-3 py-2 text-[11px] font-semibold text-emerald-700 dark:border-emerald-900/70 dark:bg-emerald-950/40 dark:text-emerald-300"
      >
        <AppIcon name="check-circle" :size="14" />
        <span class="min-w-0 flex-1">{{ importMessage }}</span>
        <button type="button" class="shrink-0 opacity-70 hover:opacity-100 cursor-pointer" @click="importMessage = ''">
          <AppIcon name="x" :size="13" />
        </button>
      </p>

      <!-- Overview -->
      <div v-if="activeTab === 'overview'" class="space-y-3">
        <div class="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          <article
            v-for="kpi in [
              { key: 'publishes', value: ops.publishedInWindow.value.length, icon: 'send' },
              { key: 'reads', value: ops.totals.value.reads, icon: 'eye' },
              { key: 'shares', value: ops.totals.value.shares, icon: 'share-2' },
              { key: 'followers', value: ops.totals.value.netFollowers, icon: 'users' },
            ]"
            :key="kpi.key"
            class="rounded-2xl border border-slate-200/80 bg-white/85 p-3.5 shadow-sm dark:border-slate-700/80 dark:bg-slate-900/80"
          >
            <div class="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
              <AppIcon :name="kpi.icon" :size="13" />
              {{ t(`ops.kpi.${kpi.key}`) }}
            </div>
            <p class="mt-1.5 text-xl font-extrabold tabular-nums text-slate-800 dark:text-slate-100">{{ fmt(kpi.value) }}</p>
            <p class="text-[10px] text-slate-400 dark:text-slate-500">{{ t("ops.kpi.window") }}</p>
          </article>
        </div>

        <div class="grid gap-3 lg:grid-cols-2">
          <section class="rounded-2xl border border-slate-200/80 bg-white/85 p-4 shadow-sm dark:border-slate-700/80 dark:bg-slate-900/80">
            <div class="flex items-center justify-between gap-2">
              <h2 class="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{{ t("ops.pace.title") }}</h2>
              <span class="text-[10px] text-slate-400 dark:text-slate-500">{{ t("ops.pace.hint") }}</span>
            </div>
            <div class="mt-3 flex h-28 items-end gap-1.5">
              <div v-for="week in ops.pace.value" :key="week.start" class="flex min-w-0 flex-1 flex-col items-center gap-1.5">
                <span class="text-[10px] font-semibold tabular-nums text-slate-500 dark:text-slate-400">{{ week.count }}</span>
                <div class="flex h-20 w-full items-end rounded-md bg-slate-100/80 dark:bg-slate-800/60">
                  <div
                    class="w-full rounded-md bg-blue-500/80 transition-[height] duration-300 dark:bg-blue-400/70"
                    :style="{ height: `${Math.max(week.count ? 8 : 0, Math.round(week.ratio * 80))}px` }"
                  ></div>
                </div>
                <span class="text-[9px] tabular-nums text-slate-400 dark:text-slate-500">{{ week.start.slice(5) }}</span>
              </div>
            </div>
          </section>

          <section class="rounded-2xl border border-slate-200/80 bg-white/85 p-4 shadow-sm dark:border-slate-700/80 dark:bg-slate-900/80">
            <h2 class="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{{ t("ops.channels.title") }}</h2>
            <p v-if="!ops.channelBreakdown.value.length" class="mt-3 text-[11px] text-slate-400 dark:text-slate-500">
              {{ t("ops.channels.empty") }}
            </p>
            <ul v-else class="mt-3 space-y-2">
              <li v-for="item in ops.channelBreakdown.value" :key="item.channelId">
                <div class="flex items-baseline justify-between gap-2 text-[11px]">
                  <span class="min-w-0 truncate font-semibold text-slate-600 dark:text-slate-300">{{ channelLabel(item.channelId) }}</span>
                  <span class="shrink-0 tabular-nums text-slate-500 dark:text-slate-400">{{ t("ops.channels.times", { count: item.count }) }}</span>
                </div>
                <div class="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                  <div
                    class="h-full rounded-full bg-violet-500/70"
                    :style="{ width: `${Math.round((item.count / Math.max(1, maxChannelCount)) * 100)}%` }"
                  ></div>
                </div>
              </li>
            </ul>
          </section>
        </div>

        <div class="grid gap-3 lg:grid-cols-2">
          <section class="rounded-2xl border border-slate-200/80 bg-white/85 p-4 shadow-sm dark:border-slate-700/80 dark:bg-slate-900/80">
            <h2 class="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{{ t("ops.assets.title") }}</h2>
            <p v-if="!topAssets.length" class="mt-3 text-[11px] text-slate-400 dark:text-slate-500">{{ t("ops.assets.empty") }}</p>
            <ul v-else class="mt-2.5 space-y-1.5">
              <li v-for="asset in topAssets" :key="asset.assetId" class="flex items-center justify-between gap-2 text-[11px]">
                <span class="min-w-0 truncate text-slate-600 dark:text-slate-300">{{ asset.fileName }}</span>
                <span class="shrink-0 rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                  {{ t("ops.assets.usage", { count: asset.usage.length }) }}
                </span>
              </li>
            </ul>
          </section>

          <section class="rounded-2xl border border-slate-200/80 bg-white/85 p-4 shadow-sm dark:border-slate-700/80 dark:bg-slate-900/80">
            <div class="flex items-center justify-between gap-2">
              <h2 class="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">{{ t("ops.import.sourceTitle") }}</h2>
              <button
                v-if="ops.metrics.value.days.length"
                type="button"
                class="text-[10px] font-semibold text-slate-400 hover:text-rose-600 dark:text-slate-500 dark:hover:text-rose-300 cursor-pointer"
                @click="clearMetrics"
              >
                {{ t("ops.import.clear") }}
              </button>
            </div>
            <template v-if="ops.lastImport.value">
              <p class="mt-2.5 text-[11px] text-slate-600 dark:text-slate-300">
                {{ t("ops.import.lastImport", {
                  channel: channelLabel(ops.lastImport.value.channel),
                  count: ops.lastImport.value.rowCount,
                  date: ops.lastImport.value.at.slice(0, 10),
                }) }}
              </p>
              <p class="mt-1 text-[10px] text-slate-400 dark:text-slate-500">
                {{ t("ops.import.importedDays", { count: ops.metrics.value.days.length }) }}
              </p>
            </template>
            <p v-else class="mt-2.5 text-[11px] leading-5 text-slate-500 dark:text-slate-400">
              {{ t("ops.import.noneYet") }}
            </p>
            <p class="mt-2 rounded-lg bg-slate-50/80 px-2.5 py-2 text-[10px] leading-4 text-slate-500 dark:bg-slate-800/50 dark:text-slate-400">
              {{ t("ops.import.hint") }}
            </p>
          </section>
        </div>
      </div>

      <!-- Calendar -->
      <div v-else-if="activeTab === 'calendar'" class="space-y-3">
        <section class="rounded-2xl border border-slate-200/80 bg-white/85 p-4 shadow-sm dark:border-slate-700/80 dark:bg-slate-900/80">
          <div class="flex flex-wrap items-center gap-2">
            <button
              type="button"
              class="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 text-slate-500 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 cursor-pointer"
              :aria-label="t('ops.calendar.previous')"
              @click="shiftMonth(-1)"
            >
              <AppIcon name="chevron-left" :size="15" />
            </button>
            <button
              type="button"
              class="grid h-8 w-8 place-items-center rounded-lg border border-slate-200 text-slate-500 transition-colors hover:bg-slate-50 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 cursor-pointer"
              :aria-label="t('ops.calendar.next')"
              @click="shiftMonth(1)"
            >
              <AppIcon name="chevron-right" :size="15" />
            </button>
            <h2 class="text-sm font-bold text-slate-700 dark:text-slate-200">{{ monthLabel }}</h2>
            <span class="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-bold text-blue-600 dark:bg-blue-950/50 dark:text-blue-300">
              {{ t("ops.calendar.monthPublishes", { count: monthPublishCount }) }}
            </span>
          </div>

          <div class="mt-3 grid grid-cols-7 gap-1 text-center text-[10px] font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500">
            <span v-for="key in weekdayKeys" :key="key">{{ t(`ops.calendar.weekdays.${key}`) }}</span>
          </div>

          <div class="mt-1 grid grid-cols-7 gap-1">
            <button
              v-for="cell in calendarCells"
              :key="cell.iso"
              type="button"
              class="flex h-16 flex-col gap-1 rounded-lg border p-1.5 text-left transition-colors cursor-pointer"
              :class="[
                cell.inMonth
                  ? 'border-slate-200/90 bg-white text-slate-700 hover:border-blue-300 dark:border-slate-700/80 dark:bg-slate-900 dark:text-slate-200'
                  : 'border-transparent bg-slate-50/60 text-slate-400 dark:bg-slate-800/30 dark:text-slate-500',
                selectedDate === cell.iso ? 'ring-2 ring-blue-400 ring-offset-1 ring-offset-white dark:ring-offset-slate-900' : '',
              ]"
              @click="selectedDate = cell.iso"
            >
              <span
                class="text-[11px] font-bold tabular-nums"
                :class="cell.isToday ? 'grid h-4 w-4 place-items-center rounded-full bg-blue-600 text-white' : ''"
              >{{ cell.day }}</span>
              <span class="flex flex-wrap items-center gap-1">
                <span
                  v-if="cell.publishes.length"
                  class="inline-flex items-center gap-0.5 rounded-full bg-blue-50 px-1 text-[9px] font-bold tabular-nums text-blue-600 dark:bg-blue-950/50 dark:text-blue-300"
                >
                  <AppIcon name="send" :size="8" />
                  {{ cell.publishes.length }}
                </span>
                <span v-if="cell.metrics.reads" class="text-[9px] tabular-nums text-emerald-600 dark:text-emerald-400">
                  {{ fmt(cell.metrics.reads) }}
                </span>
              </span>
            </button>
          </div>
        </section>

        <section class="rounded-2xl border border-slate-200/80 bg-white/85 p-4 shadow-sm dark:border-slate-700/80 dark:bg-slate-900/80">
          <div class="flex flex-wrap items-baseline justify-between gap-2">
            <h2 class="text-sm font-bold text-slate-700 dark:text-slate-200">{{ selectedDate }}</h2>
            <div class="flex flex-wrap items-center gap-3 text-[10px] font-semibold text-slate-500 dark:text-slate-400">
              <span>{{ t("ops.calendar.reads", { count: fmt(selectedSummary.metrics.reads) }) }}</span>
              <span>{{ t("ops.calendar.shares", { count: fmt(selectedSummary.metrics.shares) }) }}</span>
              <span>{{ t("ops.calendar.netFollowers", { count: fmt(Math.max(0, selectedSummary.metrics.newFollowers - selectedSummary.metrics.lostFollowers)) }) }}</span>
            </div>
          </div>

          <p v-if="!selectedSummary.publishes.length" class="mt-2 text-[11px] text-slate-400 dark:text-slate-500">
            {{ t("ops.calendar.emptyDay") }}
          </p>
          <ul v-else class="mt-2.5 space-y-1.5">
            <li
              v-for="record in selectedSummary.publishes"
              :key="record.id"
              class="flex items-center justify-between gap-2 rounded-lg border border-slate-200/70 px-2.5 py-1.5 dark:border-slate-700/70"
            >
              <span class="min-w-0 truncate text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                {{ record.title || t("workspace.untitled") }}
              </span>
              <span class="shrink-0 text-[10px] text-slate-400 dark:text-slate-500">
                {{ channelLabel(record.channelId) }} · {{ t("ops.calendar.images", { count: record.imageCount }) }}
              </span>
            </li>
          </ul>
        </section>
      </div>

      <!-- Reviews -->
      <div v-else class="space-y-3">
        <div v-if="editingId" class="rounded-2xl border border-blue-200/80 bg-white p-4 shadow-sm dark:border-blue-900/60 dark:bg-slate-900">
          <h2 class="text-sm font-bold text-slate-700 dark:text-slate-200">
            {{ editingId === "new" ? t("ops.reviews.new") : t("ops.reviews.edit") }}
          </h2>
          <div class="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_130px]">
            <label class="grid gap-1">
              <span class="text-[11px] font-semibold text-slate-500 dark:text-slate-400">{{ t("ops.reviews.titleField") }}</span>
              <input
                v-model="reviewDraft.title"
                type="text"
                class="h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-800 outline-none focus:border-blue-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                :placeholder="t('ops.reviews.titlePlaceholder')"
              />
            </label>
            <label class="grid gap-1">
              <span class="text-[11px] font-semibold text-slate-500 dark:text-slate-400">{{ t("ops.reviews.date") }}</span>
              <input
                v-model="reviewDraft.date"
                type="date"
                class="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none focus:border-blue-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
              />
            </label>
          </div>
          <div class="mt-2 grid gap-2 sm:grid-cols-2">
            <label v-for="field in ['highlights', 'problems', 'hypotheses', 'nextSteps']" :key="field" class="grid gap-1">
              <span class="text-[11px] font-semibold text-slate-500 dark:text-slate-400">{{ t(`ops.reviews.fields.${field}`) }}</span>
              <textarea
                v-model="reviewDraft[field]"
                rows="3"
                class="resize-y rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs leading-5 text-slate-700 outline-none focus:border-blue-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                :placeholder="t(`ops.reviews.placeholders.${field}`)"
              ></textarea>
            </label>
          </div>
          <p v-if="reviewError" class="mt-2 text-[11px] font-semibold text-rose-600 dark:text-rose-300">{{ reviewError }}</p>
          <div class="mt-3 flex items-center gap-2">
            <button
              type="button"
              class="inline-flex h-8 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-xs font-bold text-white transition-colors hover:bg-blue-700 cursor-pointer"
              @click="saveReview"
            >
              <AppIcon name="save" :size="14" />
              {{ t("ops.reviews.save") }}
            </button>
            <button
              type="button"
              class="inline-flex h-8 items-center rounded-lg px-2.5 text-xs font-semibold text-slate-500 transition-colors hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800 cursor-pointer"
              @click="cancelReview"
            >
              {{ t("ops.reviews.cancel") }}
            </button>
          </div>
        </div>

        <div v-else class="flex flex-wrap items-center justify-between gap-2">
          <p class="text-[11px] text-slate-500 dark:text-slate-400">{{ t("ops.reviews.count", { count: ops.reviews.value.length }) }}</p>
          <button
            type="button"
            class="inline-flex h-8 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-xs font-bold text-white transition-colors hover:bg-blue-700 cursor-pointer"
            @click="startNewReview"
          >
            <AppIcon name="plus" :size="14" />
            {{ t("ops.reviews.new") }}
          </button>
        </div>

        <p
          v-if="!editingId && !ops.reviews.value.length"
          class="rounded-2xl border border-dashed border-slate-200/90 px-4 py-6 text-center text-[11px] text-slate-500 dark:border-slate-700/80 dark:text-slate-400"
        >
          {{ t("ops.reviews.empty") }}
        </p>

        <article
          v-for="review in ops.reviews.value"
          :key="review.id"
          class="rounded-2xl border border-slate-200/80 bg-white/85 p-4 shadow-sm dark:border-slate-700/80 dark:bg-slate-900/80"
        >
          <div class="flex flex-wrap items-start justify-between gap-2">
            <div class="min-w-0">
              <h3 class="truncate text-sm font-bold text-slate-700 dark:text-slate-200">{{ review.title }}</h3>
              <p class="mt-0.5 text-[10px] text-slate-400 dark:text-slate-500">{{ review.date }}</p>
            </div>
            <div class="flex items-center gap-1">
              <button
                type="button"
                class="grid h-7 w-7 place-items-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200 cursor-pointer"
                :aria-label="t('ops.reviews.edit')"
                @click="startEditReview(review)"
              >
                <AppIcon name="pencil" :size="13" />
              </button>
              <button
                type="button"
                class="grid h-7 w-7 place-items-center rounded-lg text-slate-400 transition-colors hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40 dark:hover:text-rose-300 cursor-pointer"
                :aria-label="t('ops.reviews.delete')"
                @click="deleteReview(review)"
              >
                <AppIcon name="trash-2" :size="13" />
              </button>
            </div>
          </div>
          <dl class="mt-2 grid gap-1.5 sm:grid-cols-2">
            <div v-for="field in ['highlights', 'problems', 'hypotheses', 'nextSteps']" :key="field" class="min-w-0">
              <dt class="text-[10px] font-bold uppercase tracking-wide text-slate-400 dark:text-slate-500">{{ t(`ops.reviews.fields.${field}`) }}</dt>
              <dd class="whitespace-pre-line text-[11px] leading-5 text-slate-600 dark:text-slate-300">{{ review[field] || "—" }}</dd>
            </div>
          </dl>
        </article>
      </div>
    </div>

    <!-- Import dialog -->
    <Teleport to="body">
      <div
        v-if="importOpen"
        class="fixed inset-0 z-dialog-raised grid place-items-center bg-slate-950/40 p-4 backdrop-blur-sm"
        @mousedown.self="importOpen = false"
      >
        <section
          role="dialog"
          aria-modal="true"
          :aria-label="t('ops.import.title')"
          class="flex max-h-[min(620px,calc(100vh-2rem))] w-[min(640px,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
        >
          <header class="flex shrink-0 items-center justify-between border-b border-slate-200/80 px-5 py-3.5 dark:border-slate-800">
            <div>
              <h2 class="text-sm font-bold text-slate-800 dark:text-slate-100">{{ t("ops.import.title") }}</h2>
              <p class="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">{{ t("ops.import.desc") }}</p>
            </div>
            <button
              type="button"
              class="grid h-8 w-8 place-items-center rounded-lg text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200 cursor-pointer"
              :aria-label="t('ops.import.cancel')"
              @click="importOpen = false"
            >
              <AppIcon name="x" :size="15" />
            </button>
          </header>

          <div class="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
            <div class="grid gap-2 sm:grid-cols-2">
              <label class="grid gap-1">
                <span class="text-[11px] font-semibold text-slate-500 dark:text-slate-400">{{ t("ops.import.channel") }}</span>
                <select
                  v-model="importChannel"
                  class="h-8 rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-700 outline-none focus:border-blue-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                >
                  <option v-for="channel in PUBLISH_CHANNELS" :key="channel.id" :value="channel.id">{{ t(channel.labelKey) }}</option>
                </select>
              </label>
              <label class="grid gap-1">
                <span class="text-[11px] font-semibold text-slate-500 dark:text-slate-400">{{ t("ops.import.file") }}</span>
                <input
                  type="file"
                  accept=".csv,.tsv,.txt,text/csv,text/plain"
                  class="h-8 w-full rounded-lg border border-slate-200 bg-white px-2 text-[11px] text-slate-500 file:mr-2 file:h-6 file:rounded-md file:border-0 file:bg-slate-100 file:px-2 file:text-[11px] file:font-semibold file:text-slate-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:file:bg-slate-700 dark:file:text-slate-200"
                  @change="readImportFile"
                />
              </label>
            </div>

            <label class="grid gap-1">
              <span class="text-[11px] font-semibold text-slate-500 dark:text-slate-400">{{ t("ops.import.paste") }}</span>
              <textarea
                v-model="importDraft"
                rows="6"
                spellcheck="false"
                class="resize-y rounded-lg border border-slate-200 bg-white px-2.5 py-2 font-mono text-[11px] leading-5 text-slate-700 outline-none focus:border-blue-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                :placeholder="t('ops.import.pastePlaceholder')"
              ></textarea>
            </label>

            <p v-if="importError" class="text-[11px] font-semibold text-rose-600 dark:text-rose-300">{{ importError }}</p>

            <div v-if="preview" class="rounded-xl border border-slate-200/80 bg-slate-50/70 px-3 py-2.5 dark:border-slate-700/80 dark:bg-slate-800/50">
              <p v-if="previewError || preview.error" class="text-[11px] font-semibold text-rose-600 dark:text-rose-300">
                {{ previewError || importError }}
              </p>
              <template v-else>
                <p class="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                  {{ t("ops.import.previewRows", { count: preview.records.length }) }}
                  <span v-if="preview.skipped" class="font-normal text-slate-400 dark:text-slate-500">
                    · {{ t("ops.import.previewSkipped", { count: preview.skipped }) }}
                  </span>
                </p>
                <div class="mt-1.5 flex flex-wrap gap-1">
                  <span
                    v-for="(label, field) in preview.mappedLabels"
                    :key="field"
                    class="rounded-full bg-white px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 shadow-sm dark:bg-slate-900 dark:text-slate-400"
                  >
                    {{ t(`ops.import.fields.${field}`) }} ← {{ label }}
                  </span>
                </div>
              </template>
            </div>

            <p class="text-[10px] leading-4 text-slate-400 dark:text-slate-500">{{ t("ops.import.note") }}</p>
          </div>

          <footer class="flex shrink-0 items-center justify-end gap-2 border-t border-slate-200/80 px-5 py-3 dark:border-slate-800">
            <button
              type="button"
              class="inline-flex h-8 items-center rounded-lg px-3 text-xs font-semibold text-slate-500 transition-colors hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800 cursor-pointer"
              @click="importOpen = false"
            >
              {{ t("ops.import.cancel") }}
            </button>
            <button
              type="button"
              class="inline-flex h-8 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-xs font-bold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              :disabled="!preview || Boolean(preview.error)"
              @click="confirmImport"
            >
              <AppIcon name="upload" :size="14" />
              {{ t("ops.import.confirm") }}
            </button>
          </footer>
        </section>
      </div>
    </Teleport>
  </section>
</template>
