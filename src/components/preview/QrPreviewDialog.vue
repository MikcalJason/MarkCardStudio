<script setup>
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import AppIcon from "../AppIcon.vue";
import AppIconButton from "../AppIconButton.vue";

const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
  status: {
    type: String,
    default: "idle",
  },
  progressText: {
    type: String,
    default: "",
  },
  errorText: {
    type: String,
    default: "",
  },
  url: {
    type: String,
    default: "",
  },
  reachable: {
    type: Boolean,
    default: false,
  },
  qrSvg: {
    type: String,
    default: "",
  },
  pageCount: {
    type: Number,
    default: 0,
  },
  sizeLabel: {
    type: String,
    default: "",
  },
  formatLabel: {
    type: String,
    default: "",
  },
  remainingSecs: {
    type: Number,
    default: 0,
  },
  phoneOpened: {
    type: Boolean,
    default: false,
  },
  thumbs: {
    type: Array,
    default: () => [],
  },
});

const emit = defineEmits(["close", "regenerate"]);
const { t } = useI18n();

const copied = ref(false);
let copiedTimer = null;

const isLive = computed(() => props.status === "ready" && props.remainingSecs > 0);
const isExpired = computed(() => props.status === "expired" || (props.status === "ready" && props.remainingSecs <= 0));
const remainingLabel = computed(() => {
  const total = Math.max(0, props.remainingSecs);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
});
const metaLabel = computed(() => {
  const parts = [];
  if (props.formatLabel) parts.push(props.formatLabel);
  if (props.pageCount > 0) parts.push(t("qrPreview.pageCount", { count: props.pageCount }));
  if (props.sizeLabel) parts.push(props.sizeLabel);
  return parts.join(" · ");
});
const extraThumbCount = computed(() => Math.max(0, props.pageCount - props.thumbs.length));

watch(
  () => props.url,
  () => {
    copied.value = false;
    if (copiedTimer) {
      clearTimeout(copiedTimer);
      copiedTimer = null;
    }
  },
);

async function copyUrl() {
  if (!props.url || isExpired.value) return;
  try {
    await navigator.clipboard.writeText(props.url);
    copied.value = true;
    if (copiedTimer) clearTimeout(copiedTimer);
    copiedTimer = setTimeout(() => {
      copied.value = false;
      copiedTimer = null;
    }, 2000);
  } catch {
    // Clipboard may be blocked; the URL stays selectable as a fallback.
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-dialog flex items-center justify-center bg-slate-950/55 p-3 backdrop-blur-sm sm:p-5"
      role="dialog"
      aria-modal="true"
      :aria-label="t('qrPreview.title')"
      @click.self="emit('close')"
    >
      <div
        class="flex max-h-[min(92vh,760px)] w-[min(96vw,560px)] min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-2xl dark:border-slate-700/80 dark:bg-slate-900"
      >
        <header
          class="flex items-start justify-between gap-4 border-b border-slate-200/80 px-5 py-3.5 dark:border-slate-700/70"
        >
          <div class="min-w-0">
            <h2 class="flex items-center gap-2 text-sm font-bold text-slate-900 dark:text-slate-50">
              <AppIcon name="qrcode" :size="16" class="text-blue-600 dark:text-blue-400" />
              {{ t("qrPreview.title") }}
            </h2>
            <p class="mt-1 text-xs text-slate-500 dark:text-slate-400">
              {{ t("qrPreview.subtitle") }}
            </p>
          </div>
          <AppIconButton small :aria-label="t('common.close')" :title="t('common.close')" @click="emit('close')">
            <AppIcon name="x" :size="16" />
          </AppIconButton>
        </header>

        <div class="min-h-0 flex-1 overflow-y-auto p-5">
          <!-- Desktop-only notice -->
          <div v-if="status === 'unsupported'" class="flex flex-col items-center gap-3 py-10 text-center">
            <AppIcon name="smartphone" :size="28" class="text-slate-400" />
            <p class="max-w-sm text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              {{ t("qrPreview.desktopOnly") }}
            </p>
            <button
              type="button"
              class="h-8 rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white transition hover:bg-blue-700"
              @click="emit('close')"
            >
              {{ t("qrPreview.understood") }}
            </button>
          </div>

          <!-- Rendering / retrying -->
          <div v-else-if="status === 'rendering' || status === 'idle'" class="flex flex-col items-center gap-4 py-12 text-center">
            <AppIcon name="loader" :size="26" class="animate-spin text-blue-600 dark:text-blue-400" />
            <p class="text-xs text-slate-500 dark:text-slate-400">
              {{ progressText || t("qrPreview.preparing") }}
            </p>
          </div>

          <!-- Failure -->
          <div v-else-if="status === 'failed'" class="flex flex-col items-center gap-3 py-8 text-center">
            <AppIcon name="alert-circle" :size="26" class="text-amber-500" />
            <p class="max-w-sm break-all text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              {{ errorText || t("qrPreview.failed") }}
            </p>
            <button
              type="button"
              class="h-8 rounded-lg bg-blue-600 px-3 text-xs font-semibold text-white transition hover:bg-blue-700"
              @click="emit('regenerate')"
            >
              {{ t("qrPreview.retry") }}
            </button>
          </div>

          <template v-else>
            <!-- Ready / expired -->
            <div class="flex flex-col items-center gap-5 sm:flex-row sm:items-stretch">
              <div class="relative shrink-0">
                <div
                  class="qr-box w-48 rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-700"
                  :class="{ 'opacity-40 grayscale': isExpired }"
                  v-html="qrSvg"
                ></div>
                <div
                  v-if="isExpired"
                  class="absolute inset-0 grid place-items-center rounded-xl text-[11px] font-semibold text-slate-700 dark:text-slate-200"
                >
                  {{ t("qrPreview.expired") }}
                </div>
              </div>

              <div class="flex min-w-0 flex-1 flex-col gap-2.5">
                <div class="flex flex-wrap items-center gap-1.5">
                  <span
                    v-if="isLive"
                    class="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                  >
                    <AppIcon name="clock" :size="12" />
                    {{ t("qrPreview.remaining", { time: remainingLabel }) }}
                  </span>
                  <span
                    v-if="phoneOpened && !isExpired"
                    class="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400"
                  >
                    <AppIcon name="smartphone" :size="12" />
                    {{ t("qrPreview.phoneOpened") }}
                  </span>
                  <span
                    v-if="metaLabel"
                    class="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-semibold text-slate-600 dark:bg-slate-800 dark:text-slate-300"
                  >
                    <AppIcon name="images" :size="12" />
                    {{ metaLabel }}
                  </span>
                </div>

                <div
                  class="flex items-center gap-2 rounded-lg border border-slate-200/80 bg-slate-50 px-2.5 py-2 dark:border-slate-700/70 dark:bg-slate-800/60"
                >
                  <code
                    class="min-w-0 flex-1 select-all break-all font-mono text-[11px] leading-relaxed text-slate-700 dark:text-slate-200"
                  >{{ url }}</code>
                  <button
                    v-if="!isExpired"
                    type="button"
                    class="flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-[11px] font-semibold transition"
                    :class="copied
                      ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/60 dark:text-emerald-400'
                      : 'bg-white text-slate-600 shadow-xs hover:text-blue-600 dark:bg-slate-700 dark:text-slate-200'"
                    :aria-label="copied ? t('qrPreview.copied') : t('qrPreview.copy')"
                    @click="copyUrl"
                  >
                    <AppIcon :name="copied ? 'clipboard-check' : 'copy'" :size="12" />
                    {{ copied ? t("qrPreview.copied") : t("qrPreview.copy") }}
                  </button>
                </div>

                <div
                  v-if="isLive && !reachable"
                  class="flex items-start gap-1.5 rounded-lg bg-amber-50 px-2.5 py-2 text-[11px] leading-relaxed text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
                >
                  <AppIcon name="wifi" :size="13" class="mt-0.5 shrink-0" />
                  {{ t("qrPreview.notReachable") }}
                </div>

                <ul class="flex flex-col gap-1 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                  <li class="flex items-start gap-1.5">
                    <AppIcon name="wifi" :size="12" class="mt-0.5 shrink-0" />
                    {{ t("qrPreview.sameWifi") }}
                  </li>
                  <li class="flex items-start gap-1.5">
                    <AppIcon name="refresh" :size="12" class="mt-0.5 shrink-0" />
                    {{ t("qrPreview.staleHint") }}
                  </li>
                </ul>

                <div class="mt-1">
                  <button
                    type="button"
                    class="h-8 inline-flex items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition"
                    :class="isExpired
                      ? 'bg-blue-600 text-white hover:bg-blue-700'
                      : 'border border-slate-200 bg-white text-slate-600 hover:border-blue-300 hover:text-blue-600 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'"
                    @click="emit('regenerate')"
                  >
                    <AppIcon name="refresh" :size="13" />
                    {{ t("qrPreview.regenerate") }}
                  </button>
                </div>
              </div>
            </div>

            <!-- What will actually be shared: desktop thumbnails of the exact served bytes. -->
            <div v-if="thumbs.length" class="mt-5 rounded-xl border border-slate-200/80 bg-slate-50/60 p-3 dark:border-slate-700/70 dark:bg-slate-800/40">
              <p class="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                <AppIcon name="share-2" :size="12" />
                {{ t("qrPreview.thumbsLabel") }}
              </p>
              <div class="flex gap-2 overflow-x-auto pb-1">
                <div
                  v-for="(thumb, index) in thumbs"
                  :key="index"
                  class="shrink-0 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-xs dark:border-slate-700 dark:bg-slate-900"
                >
                  <img :src="thumb" :alt="String(index + 1)" class="h-24 w-auto" />
                </div>
                <div
                  v-if="extraThumbCount > 0"
                  class="grid h-24 w-14 shrink-0 place-items-center rounded-lg border border-dashed border-slate-300 text-[11px] font-semibold text-slate-500 dark:border-slate-600 dark:text-slate-400"
                >
                  +{{ extraThumbCount }}
                </div>
              </div>
            </div>
          </template>
        </div>

        <footer
          class="border-t border-slate-200/80 px-5 py-2.5 text-[11px] text-slate-400 dark:border-slate-700/70 dark:text-slate-500"
        >
          {{ t("qrPreview.lifetimeHint") }}
        </footer>
      </div>
    </div>
  </Teleport>
</template>

<style scoped>
/* The QR svg has only a viewBox; give it the tile's full width. */
.qr-box :deep(svg) {
  display: block;
  width: 100%;
  height: auto;
}
</style>
