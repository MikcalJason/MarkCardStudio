<script setup>
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import AppIcon from "../AppIcon.vue";
import PublishChecklist from "../publish/PublishChecklist.vue";
import { countCodePoints, getPublishChannel } from "../../config/publishChannels.js";

const props = defineProps({
  publish: {
    type: Object,
    required: true,
  },
  bundle: {
    type: Object,
    required: true,
  },
  history: {
    type: Object,
    required: true,
  },
  isTauri: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(["quick-publish", "select-channel", "goto-create", "apply-action"]);

const { t } = useI18n();

const plan = computed(() => props.publish.plan.value);
const channel = computed(() => props.publish.channel.value);
const preflight = computed(() => props.publish.preflight.value);
const readiness = computed(() => props.publish.readiness.value);
const records = computed(() => props.history.records.value);
const variantRows = computed(() =>
  props.publish.channels.map((item) => {
    const variant = props.publish.variants.value.find((entry) => entry.channelId === item.id);
    return {
      channel: item,
      variant: variant || null,
      overrideCount: variant
        ? Object.entries(variant.overrides).filter(
            ([key, value]) =>
              key !== "mode" && (Array.isArray(value) ? value.length > 0 : Boolean(value)),
          ).length
        : 0,
    };
  }),
);
const bodyLength = computed(() => countCodePoints(plan.value.content.body));
const titleLength = computed(() => countCodePoints(plan.value.content.title));
const copyTitle = computed(() => plan.value.content.title || t("workspace.untitled"));
const copyBody = computed(() => plan.value.content.body);
const copyTags = computed(() => plan.value.content.tags);
// A 13-page channel is the norm; capping keeps a 100-page gallery from decoding
// every full-size image just to fill the strip.
const previewLimit = 24;

function resetVariant(channelId) {
  if (!window.confirm(t("publishFlow.variantResetConfirm"))) return;
  props.publish.resetVariantOverrides(channelId);
}

function statusLabel(status) {
  return t(`publishFlow.status.${status}`);
}

function channelLabel(channelId) {
  return t(getPublishChannel(channelId).labelKey);
}

function formatTime(value) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

async function openRecordFolder(record) {
  if (!record.bundlePath) return;
  await props.bundle.openBundleFolder(record.bundlePath);
}
</script>

<template>
  <section class="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-6 sm:py-5">
    <div class="mx-auto flex w-full max-w-6xl flex-col gap-4">
      <header class="flex flex-wrap items-start gap-3 rounded-2xl border border-slate-200/80 bg-white/85 p-5 shadow-sm backdrop-blur-xl dark:border-slate-700/80 dark:bg-slate-900/80">
        <span class="inline-grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-300">
          <AppIcon name="upload" :size="22" />
        </span>
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2">
            <h1 class="text-lg font-extrabold tracking-tight dark:text-slate-100">
              {{ t("workspace.publishTitle") }}
            </h1>
            <span
              class="rounded-full px-2 py-0.5 text-[10px] font-bold"
              :class="{
                'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-300': readiness.tone === 'ready',
                'bg-amber-50 text-amber-600 dark:bg-amber-950/50 dark:text-amber-300': readiness.tone === 'warning',
                'bg-rose-50 text-rose-600 dark:bg-rose-950/50 dark:text-rose-300': readiness.tone === 'blocker',
              }"
            >
              {{ t(readiness.labelKey) }}
            </span>
          </div>
          <p class="mt-1.5 max-w-2xl text-sm leading-6 text-slate-500 dark:text-slate-400">
            {{ t("workspace.publishDesc", {
              title: plan.meta.documentTitle || t("workspace.untitled"),
              count: plan.images.length,
              channel: t(channel.labelKey),
            }) }}
          </p>
        </div>
        <button
          type="button"
          class="h-9 shrink-0 rounded-xl bg-blue-600 px-4 text-[12px] font-bold text-white transition hover:bg-blue-700"
          @click="emit('quick-publish')"
        >
          {{ t("publishFlow.quick.title") }}
        </button>
      </header>

      <section class="rounded-2xl border border-slate-200/80 bg-white/85 p-4 shadow-sm dark:border-slate-700/80 dark:bg-slate-900/80">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <h2 class="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {{ t("publishFlow.previewTitle") }}
          </h2>
          <div class="flex items-center gap-3 text-[11px] text-slate-500 dark:text-slate-400">
            <span class="tabular-nums">
              {{ plan.canvas.width }}×{{ plan.canvas.height }} · {{ plan.images.length }}/{{ channel.limits.images.max }}
            </span>
          </div>
        </div>

        <ol v-if="plan.images.length" class="mt-3 flex gap-2 overflow-x-auto pb-1">
          <li v-for="(image, index) in plan.images.slice(0, previewLimit)" :key="image.pageIndex" class="w-[78px] shrink-0">
            <button
              type="button"
              class="group block w-full overflow-hidden rounded-lg border border-slate-200/90 text-left transition-colors hover:border-blue-300 dark:border-slate-700/80 dark:hover:border-blue-500/60"
              :title="`${image.label} · ${t(`publishFlow.imageKinds.${image.kind}`)}`"
              @click="emit('quick-publish')"
            >
              <span class="relative block aspect-[3/4] bg-slate-100 dark:bg-slate-800">
                <img
                  v-if="image.src"
                  :src="image.src"
                  :alt="image.label"
                  class="h-full w-full object-cover"
                  loading="lazy"
                />
                <span v-else class="grid h-full place-items-center text-slate-400">
                  <AppIcon name="file-text" :size="18" />
                </span>
                <span class="absolute left-1 top-1 rounded bg-slate-900/70 px-1 text-[10px] font-bold tabular-nums text-white">
                  {{ String(index + 1).padStart(2, "0") }}
                </span>
                <span
                  v-if="image.role === 'cover'"
                  class="absolute right-1 top-1 rounded bg-blue-600 px-1 text-[10px] font-bold text-white"
                >
                  {{ t("publishFlow.images.cover") }}
                </span>
                <span
                  v-if="image.missing"
                  class="absolute inset-x-0 bottom-0 bg-rose-600/90 px-1 py-0.5 text-center text-[9px] font-bold text-white"
                >
                  {{ t("publishFlow.previewMissing") }}
                </span>
              </span>
              <span class="block truncate px-1 py-1 text-[10px] text-slate-500 dark:text-slate-400">
                {{ image.label }}
              </span>
            </button>
          </li>
          <li v-if="plan.images.length > previewLimit" class="w-[78px] shrink-0">
            <button
              type="button"
              class="grid aspect-[3/4] w-full place-items-center rounded-lg border border-dashed border-slate-200/90 text-[11px] font-semibold tabular-nums text-slate-500 transition-colors hover:border-blue-300 hover:text-blue-600 dark:border-slate-700/80 dark:text-slate-400"
              @click="emit('quick-publish')"
            >
              +{{ plan.images.length - previewLimit }}
            </button>
          </li>
        </ol>
        <p
          v-else
          class="mt-3 rounded-xl border border-dashed border-slate-200/90 px-3 py-4 text-xs text-slate-500 dark:border-slate-700/80 dark:text-slate-400"
        >
          {{ t("publishFlow.previewEmpty") }}
        </p>
      </section>

      <div class="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
        <section class="rounded-2xl border border-slate-200/80 bg-white/85 p-4 shadow-sm dark:border-slate-700/80 dark:bg-slate-900/80">
          <h2 class="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {{ t("publishFlow.variants") }}
          </h2>
          <ul class="mt-2.5 space-y-2">
            <li
              v-for="row in variantRows"
              :key="row.channel.id"
              class="flex items-start gap-1 rounded-xl border py-2.5 pl-3 pr-1.5 transition-colors"
              :class="channel.id === row.channel.id
                ? 'border-blue-300 bg-blue-50/60 dark:border-blue-500/60 dark:bg-blue-950/30'
                : 'border-slate-200/80 bg-white/60 dark:border-slate-700/70 dark:bg-slate-800/40'"
            >
              <button type="button" class="flex min-w-0 flex-1 items-start gap-2.5 text-left" @click="emit('select-channel', row.channel.id)">
                <AppIcon :name="row.channel.icon" :size="16" class="mt-0.5 shrink-0 text-slate-500 dark:text-slate-400" />
                <span class="min-w-0 flex-1">
                  <span class="flex flex-wrap items-center gap-1.5">
                    <span class="text-[12px] font-bold dark:text-slate-100">{{ t(row.channel.labelKey) }}</span>
                    <span class="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                      {{ t(`publishFlow.modes.${row.channel.mode}`) }}
                    </span>
                    <span
                      v-if="row.variant"
                      class="rounded-full px-1.5 py-0.5 text-[10px] font-semibold"
                      :class="row.variant.status === 'published'
                        ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-300'
                        : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'"
                    >
                      {{ statusLabel(row.variant.status) }}
                    </span>
                    <span v-else class="text-[10px] text-slate-500 dark:text-slate-400">
                      {{ t("publishFlow.variantEmpty") }}
                    </span>
                  </span>
                  <span class="mt-1 block truncate text-xs text-slate-500 dark:text-slate-400">
                    {{ row.variant && row.overrideCount
                      ? t("publishFlow.variantOverrides", { count: row.overrideCount })
                      : t("publishFlow.variantFollows") }}
                  </span>
                </span>
              </button>
              <button
                v-if="row.overrideCount"
                type="button"
                class="mt-0.5 shrink-0 rounded-md px-1.5 py-1 text-[10px] font-semibold text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                :title="t('publishFlow.variantResetConfirm')"
                @click="resetVariant(row.channel.id)"
              >
                {{ t("publishFlow.variantReset") }}
              </button>
            </li>
          </ul>

          <div class="mt-3 rounded-xl border border-slate-200/80 p-3 dark:border-slate-700/70">
            <div class="flex items-baseline justify-between gap-2">
              <span class="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                {{ t("publishFlow.fields.title") }}
              </span>
              <span
                class="text-[10px] font-semibold tabular-nums"
                :class="titleLength > channel.limits.title.max ? 'text-rose-600 dark:text-rose-300' : 'text-slate-500 dark:text-slate-400'"
              >
                {{ titleLength }}/{{ channel.limits.title.max }}
              </span>
            </div>
            <p class="mt-0.5 truncate text-[13px] font-bold dark:text-slate-100">{{ copyTitle }}</p>

            <div class="mt-2.5 flex items-baseline justify-between gap-2">
              <span class="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                {{ t("publishFlow.fields.body") }}
              </span>
              <span
                class="text-[10px] font-semibold tabular-nums"
                :class="bodyLength > channel.limits.body.max ? 'text-rose-600 dark:text-rose-300' : 'text-slate-500 dark:text-slate-400'"
              >
                {{ bodyLength }}/{{ channel.limits.body.max }}
              </span>
            </div>
            <p class="mt-0.5 line-clamp-3 whitespace-pre-wrap text-xs leading-5 text-slate-600 dark:text-slate-300">
              {{ copyBody || "—" }}
            </p>

            <div v-if="copyTags.length" class="mt-2 flex flex-wrap gap-1">
              <span
                v-for="tag in copyTags"
                :key="tag"
                class="rounded-full bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-blue-700 dark:bg-blue-950/40 dark:text-blue-300"
              >
                #{{ tag }}
              </span>
            </div>
          </div>
        </section>

        <section class="flex max-h-[520px] flex-col rounded-2xl border border-slate-200/80 bg-white/85 p-4 shadow-sm dark:border-slate-700/80 dark:bg-slate-900/80">
          <h2 class="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {{ t("publishFlow.checklist.title") }}
          </h2>
          <div class="mt-2.5 min-h-0 flex-1">
            <PublishChecklist :preflight="preflight" @apply-action="(issue) => emit('apply-action', issue)" />
          </div>
        </section>
      </div>

      <section class="rounded-2xl border border-slate-200/80 bg-white/85 p-4 shadow-sm dark:border-slate-700/80 dark:bg-slate-900/80">
        <div class="flex items-center justify-between gap-2">
          <h2 class="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
            {{ t("publishFlow.history.title") }}
          </h2>
          <span class="text-[11px] text-slate-500 dark:text-slate-400">
            {{ t("publishFlow.history.count", { count: records.length }) }}
          </span>
        </div>

        <p
          v-if="!records.length"
          class="mt-2.5 rounded-xl border border-dashed border-slate-200/90 px-3 py-4 text-[12px] text-slate-500 dark:border-slate-700/80 dark:text-slate-400"
        >
          {{ t("publishFlow.history.empty") }}
        </p>
        <ul v-else class="mt-2.5 divide-y divide-slate-100 dark:divide-slate-800">
          <li v-for="record in records.slice(0, 12)" :key="record.id" class="flex items-center gap-2.5 py-2">
            <AppIcon name="clock" :size="14" class="shrink-0 text-slate-400" />
            <span class="min-w-0 flex-1">
              <span class="flex flex-wrap items-center gap-1.5">
                <span class="text-[12px] font-semibold dark:text-slate-100">
                  {{ record.title || t("workspace.untitled") }}
                </span>
                <span
                  class="rounded-full px-1.5 py-0.5 text-[10px] font-bold"
                  :class="record.status === 'published'
                    ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-300'
                    : record.status === 'failed'
                      ? 'bg-rose-50 text-rose-600 dark:bg-rose-950/50 dark:text-rose-300'
                      : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'"
                >
                  {{ statusLabel(record.status) }}
                </span>
                <span class="text-[10px] text-slate-500 dark:text-slate-400">
                  {{ channelLabel(record.channelId) }}
                </span>
              </span>
              <span class="mt-0.5 block truncate text-[11px] text-slate-500 dark:text-slate-400">
                {{ formatTime(record.createdAt) }} · {{ t("publishFlow.history.imageCount", { count: record.imageCount }) }}
                <template v-if="record.error"> · {{ record.error }}</template>
              </span>
            </span>
            <button
              v-if="record.bundlePath && isTauri"
              type="button"
              class="shrink-0 rounded-lg border border-slate-200/90 px-2 py-1 text-[11px] font-semibold text-slate-600 transition hover:text-blue-600 dark:border-slate-700 dark:text-slate-300"
              @click="openRecordFolder(record)"
            >
              {{ t("publishFlow.actions.openFolder") }}
            </button>
            <button
              type="button"
              class="shrink-0 rounded-lg px-1.5 py-1 text-[11px] font-semibold text-slate-400 transition hover:text-rose-600 dark:text-slate-500"
              :aria-label="t('publishFlow.history.remove')"
              @click="history.remove(record.id)"
            >
              <AppIcon name="trash-2" :size="14" />
            </button>
          </li>
        </ul>
      </section>

      <p class="flex items-center gap-2 rounded-xl border border-dashed border-slate-200/90 px-4 py-3 text-[11px] text-slate-500 dark:border-slate-700/80 dark:text-slate-400">
        <AppIcon name="info" :size="15" />
        <span>{{ t("workspace.publishHint") }}</span>
      </p>
    </div>
  </section>
</template>
