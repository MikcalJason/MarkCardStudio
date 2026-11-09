<script setup>
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import AppIcon from "../AppIcon.vue";
import PublishChecklist from "./PublishChecklist.vue";
import { TAG_SUGGESTIONS, countCodePoints } from "../../config/publishChannels.js";
import { draftProbeVerdict, writeChannelPermissions } from "../../storage/channelPermissions.js";
import { openExternalUrl } from "../../utils/externalUrl.js";
import { bridgeMinutesLeft, withBridgeHash } from "../../utils/publishBridge.js";

const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
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
});

const emit = defineEmits(["close", "switch-canvas", "goto-create"]);

const { t } = useI18n();
const STEPS = ["channel", "check", "publish"];
const isTauri = Boolean(window.__TAURI_INTERNALS__);

const step = ref(0);
const titleDraft = ref("");
const bodyDraft = ref("");
const tagsDraft = ref("");
const copiedKey = ref("");
const result = ref(null);
const draftState = ref("idle");
const draftProgress = ref({ stage: "upload", current: 0, total: 0 });
const draftResult = ref(null);
let unlistenDraft = null;
const errorMessage = ref("");
const abortController = ref(null);

const plan = computed(() => props.publish.plan.value);
const channel = computed(() => props.publish.channel.value);
// The probe stores verdicts under the native channel id, which differs from the
// publish channel id, so map before reading the cache.
const PROBE_CHANNEL_BY_ID = { "wechat-newspic": "wechat" };
const probeChannel = computed(() => PROBE_CHANNEL_BY_ID[channel.value?.id] || "");
// allowed | denied | blocked | invalid | retry | unknown | missing
const draftVerdict = ref("missing");
const probing = ref(false);
const probeError = ref("");
// The probe's own errmsg is the only place WeChat names the egress IP it
// rejected, so it is kept in memory (never cached) and shown under the notice.
const probeMessage = ref("");

const DRAFT_NOTICE_KEYS = {
  blocked: "publishFlow.draft.blockedIp",
  invalid: "publishFlow.draft.invalidCredentials",
  denied: "publishFlow.draft.denied",
};
const draftNoticeKey = computed(
  () => DRAFT_NOTICE_KEYS[draftVerdict.value] || "publishFlow.draft.needProbe",
);

function refreshApiPermissionState() {
  draftVerdict.value = draftProbeVerdict(probeChannel.value);
  probeError.value = "";
  probeMessage.value = "";
}

async function runPermissionProbe() {
  if (!probeChannel.value || probing.value) return;
  probing.value = true;
  probeError.value = "";
  probeMessage.value = "";
  try {
    const outcome = await invoke("probe_channel_permissions", { channel: probeChannel.value });
    const items = outcome?.items || [];
    writeChannelPermissions(
      probeChannel.value,
      items.map((item) => ({ key: item.key, status: item.status })),
    );
    probeMessage.value = items.find((item) => item.key === "draft")?.message || "";
    draftVerdict.value = draftProbeVerdict(probeChannel.value);
  } catch (error) {
    // A failed check is not a verdict WeChat ever gave.
    draftVerdict.value = "retry";
    probeError.value = error?.message || String(error);
  } finally {
    probing.value = false;
  }
}
const preflight = computed(() => props.publish.preflight.value);
const readiness = computed(() => props.publish.readiness.value);
const pageOptions = computed(() => props.publish.availablePages.value);
const isGenerating = computed(() => props.bundle.isGenerating.value);
const progress = computed(() => props.bundle.progress.value);
// Assisted channels expose the loopback bridge the Chrome extension reads; the
// hash carried into the creator page is how the two meet.
const bridgeInfo = computed(() => props.bundle.bridge?.value || null);
const bridgeMinutes = computed(() => bridgeMinutesLeft(bridgeInfo.value?.expiresAt));
const bridgeError = computed(() => props.bundle.bridgeError?.value || "");
// Desktop writes every bundle into the app's own publish folder, so the path is
// shown as a fact instead of being asked for.
const bundleRoot = computed(() => props.bundle.bundleRootPath?.value || "");
const contentHash = computed(() => props.publish.contentHash.value);
const canWriteBundle = computed(() => props.bundle.supportsBundle());
const selectedIndexes = computed(() => plan.value.images.map((image) => image.pageIndex));
const unselectedPages = computed(() =>
  pageOptions.value.filter((page) => !selectedIndexes.value.includes(page.index)),
);
const titleLimit = computed(() => channel.value.limits.title.max);
const bodyLimit = computed(() => channel.value.limits.body.max);
const tagLimit = computed(() => channel.value.limits.tags.max);
const tagList = computed(() =>
  tagsDraft.value
    .split(/[,，\s]+/)
    .map((tag) => tag.replace(/^#/, "").trim())
    .filter(Boolean),
);
const previousRecord = computed(() =>
  props.history.findLast({ channelId: channel.value.id, contentHash: contentHash.value }),
);

const resultActions = computed(() => [
  {
    key: "copyTitle",
    icon: "copy",
    labelKey: "publishFlow.actions.copyTitle",
    handler: copyTitle,
    copied: copiedKey.value === "title",
  },
  {
    key: "copyBody",
    icon: "copy",
    labelKey: "publishFlow.actions.copyBody",
    handler: copyBody,
    copied: copiedKey.value === "body",
  },
  {
    key: "copyAll",
    icon: "copy",
    labelKey: "publishFlow.actions.copyAll",
    handler: copyAll,
    copied: copiedKey.value === "all",
  },
  {
    key: "openFolder",
    icon: "folder-open",
    labelKey: "publishFlow.actions.openFolder",
    handler: handleOpenFolder,
    copied: false,
    hidden: !isTauri,
  },
  {
    key: "openCreator",
    icon: "external-link",
    labelKey:
      channel.value.mode === "assist"
        ? "publishFlow.actions.openCreatorAssisted"
        : "publishFlow.actions.openCreator",
    handler: openCreatorPlatform,
    copied: false,
    hidden: !channel.value.externalUrl,
  },
  {
    key: "markPublished",
    icon: "check",
    labelKey: "publishFlow.actions.markPublished",
    handler: markPublished,
    copied: false,
  },
]);

function tagDraftText(list) {
  return list.map((tag) => `#${tag}`).join(" ");
}

function syncDrafts() {
  titleDraft.value = plan.value.content.title;
  bodyDraft.value = plan.value.content.body;
  tagsDraft.value = tagDraftText(plan.value.content.tags);
  result.value = null;
  draftState.value = "idle";
  draftResult.value = null;
  errorMessage.value = "";
}

watch(
  () => props.open,
  (open) => {
    if (!open) {
      abortController.value?.abort?.();
      step.value = 0;
      return;
    }
    step.value = 0;
    syncDrafts();
    // Resolve the managed bundle folder up front so the publish step can show
    // where the files will land before the user commits to generating.
    if (isTauri) props.bundle.ensureBundleRoot?.().catch(() => {});
  },
);

watch(() => props.publish.channelId.value, syncDrafts);
watch(() => [props.open, channel.value], refreshApiPermissionState, { immediate: true });

function selectChannel(id) {
  props.publish.selectChannel(id);
}

function commitTitle() {
  props.publish.updateOverrides({ title: titleDraft.value });
}

function commitBody() {
  props.publish.updateOverrides({ body: bodyDraft.value });
}

function commitTags() {
  const list = tagList.value;
  props.publish.updateOverrides({ tags: list });
  // Keep the input in the same #tag form as the chips and the suggestion buttons.
  const formatted = tagDraftText(list);
  if (formatted !== tagsDraft.value) tagsDraft.value = formatted;
}

function addTag(tag) {
  if (tagList.value.includes(tag)) return;
  if (tagLimit.value > 0 && tagList.value.length >= tagLimit.value) return;
  tagsDraft.value = tagDraftText([...tagList.value, tag]);
  commitTags();
}

function removeTag(tag) {
  tagsDraft.value = tagDraftText(tagList.value.filter((item) => item !== tag));
  commitTags();
}

const suggestionTags = computed(() => {
  const pool = [
    ...props.publish.derivedCopy.value.tags,
    ...TAG_SUGGESTIONS,
  ];
  const seen = [];
  for (const tag of pool) {
    if (tagList.value.includes(tag) || seen.includes(tag)) continue;
    seen.push(tag);
    if (seen.length >= 6) break;
  }
  return seen;
});

function resetBody() {
  bodyDraft.value = props.publish.derivedCopy.value.body;
  props.publish.updateOverrides({ body: "" });
}

function writeOrder(next) {
  props.publish.updateOverrides({
    pageIndexes: next,
    coverIndex: next[0] ?? null,
  });
}

function addPage(pageIndex) {
  if (selectedIndexes.value.includes(pageIndex)) return;
  writeOrder([...selectedIndexes.value, pageIndex]);
}

function removePage(pageIndex) {
  writeOrder(selectedIndexes.value.filter((index) => index !== pageIndex));
}

function movePage(pageIndex, delta) {
  const order = [...selectedIndexes.value];
  const from = order.indexOf(pageIndex);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= order.length) return;
  order.splice(to, 0, order.splice(from, 1)[0]);
  writeOrder(order);
}

function promoteCover(pageIndex) {
  const order = selectedIndexes.value.filter((index) => index !== pageIndex);
  writeOrder([pageIndex, ...order]);
}

function setMode(mode) {
  props.publish.updateOverrides({ mode });
}

function goNext() {
  step.value = Math.min(step.value + 1, STEPS.length - 1);
}

function goBack() {
  step.value = Math.max(step.value - 1, 0);
}

async function copyText(key, text) {
  try {
    await navigator.clipboard.writeText(String(text || ""));
    copiedKey.value = key;
    window.setTimeout(() => {
      if (copiedKey.value === key) copiedKey.value = "";
    }, 2000);
    return true;
  } catch {
    errorMessage.value = t("publishFlow.errors.clipboard");
    return false;
  }
}

function copyTitle() {
  return copyText("title", plan.value.content.title);
}

function copyBody() {
  const tags = plan.value.content.tags.map((tag) => `#${tag}`).join(" ");
  return copyText("body", tags ? `${plan.value.content.body}\n\n${tags}` : plan.value.content.body);
}

function copyAll() {
  const tags = plan.value.content.tags.map((tag) => `#${tag}`).join(" ");
  const text = [plan.value.content.title, plan.value.content.body, tags]
    .filter(Boolean)
    .join("\n\n");
  return copyText("all", text);
}

async function openCreatorPlatform() {
  const url = channel.value.externalUrl;
  if (!url) return;
  // Assisted channels carry the finished bundle's loopback bridge in the URL
  // fragment, so the extension fills the page without a folder picker.
  let bridgeUrl = "";
  if (channel.value.mode === "assist") {
    const bundlePath = result.value?.bundlePath || props.bundle.lastBundlePath.value;
    if (bundlePath) {
      const started = await props.bundle.ensureBridge(bundlePath).catch(() => null);
      // A bundle built for another channel would be refused by the extension
      // anyway; never hand it over in the first place.
      if (started?.url && (!started.channelId || started.channelId === channel.value.id)) {
        bridgeUrl = started.url;
      }
    }
  }
  const target = bridgeUrl ? withBridgeHash(url, bridgeUrl) : url;
  // The Xiaohongshu studio only works with the fill extension, which is Chrome
  // only, so those channels ask the shell for Chrome first.
  await openExternalUrl(target, { preferChrome: Boolean(channel.value.openInChrome) });
}

/**
 * One click = generate the bundle, start the bridge, and open the creator page
 * with the bridge fragment the extension follows. It never publishes: the
 * platform's own 发布 button stays the user's decision.
 */
async function handleOneClickPublish() {
  if (isGenerating.value) return;
  if (!result.value) {
    await handleGenerate();
    if (!result.value) return;
  }
  await openCreatorPlatform();
}

async function handleGenerate() {
  errorMessage.value = "";
  result.value = null;
  const controller = new AbortController();
  abortController.value = controller;
  try {
    const outcome = await props.bundle.generatePublishBundle({
      plan: plan.value,
      channel: channel.value,
      preflight: preflight.value,
      contentHash: contentHash.value,
      signal: controller.signal,
    });
    if (!outcome) return;
    result.value = outcome;
    props.history.append({
      workId: plan.value.meta.workId,
      channelId: channel.value.id,
      status: channel.value.mode === "assist" ? "assisted" : "bundle",
      mode: plan.value.options.mode,
      title: plan.value.content.title,
      contentHash: contentHash.value,
      bundlePath: outcome.bundlePath,
      imageCount: outcome.imageCount,
    });
    props.publish.markVariantReady();
  } catch (error) {
    errorMessage.value = error?.message || String(error);
  } finally {
    abortController.value = null;
  }
}

function cancelGenerate() {
  abortController.value?.abort?.();
}

async function handleOpenFolder() {
  try {
    await props.bundle.openBundleFolder(result.value?.bundlePath || props.bundle.lastBundlePath.value);
  } catch (error) {
    errorMessage.value = error?.message || String(error);
  }
}

async function handleOpenRoot() {
  if (!bundleRoot.value) return;
  try {
    await props.bundle.openBundleFolder(bundleRoot.value);
  } catch (error) {
    errorMessage.value = error?.message || String(error);
  }
}

function markPublished() {
  props.history.append({
    workId: plan.value.meta.workId,
    channelId: channel.value.id,
    status: "published",
    mode: plan.value.options.mode,
    title: plan.value.content.title,
    contentHash: contentHash.value,
    bundlePath: result.value?.bundlePath || props.bundle.lastBundlePath.value || "",
    imageCount: result.value?.imageCount || plan.value.images.length,
  });
  props.publish.markVariantPublished();
  errorMessage.value = "";
}

// A missing permission record used to hide the push action entirely, which read
// as the whole WeChat flow being broken. WeChat answers before any card is
// uploaded (the token call rejects a bad credential or a non-whitelisted IP), so
// an unchecked verdict still pushes; only a verdict WeChat itself gave stops it.
const PUSH_REFUSED_VERDICTS = ["denied", "blocked", "invalid"];
const draftPanelOpen = computed(() => isTauri && channel.value?.mode === "api");
const canPushDraft = computed(
  () =>
    draftPanelOpen.value &&
    Boolean(result.value?.bundlePath) &&
    !PUSH_REFUSED_VERDICTS.includes(draftVerdict.value),
);

// A push answers with the same errcodes the probe maps, so trust the platform
// over a cached verdict that may predate a whitelist or credential change.
function applyPushVerdict(message) {
  const errcode = /^(\d{4,6}):/.exec(String(message || ""))?.[1];
  if (errcode === "40164") draftVerdict.value = "blocked";
  else if (errcode === "48001") draftVerdict.value = "denied";
  else if (["40001", "41001", "42001"].includes(errcode)) draftVerdict.value = "invalid";
}

async function handlePushDraft() {
  if (!canPushDraft.value || draftState.value === "running") return;
  const confirmed = window.confirm(
    t("publishFlow.draft.confirm", {
      count: result.value.imageCount,
      channel: t(channel.value.labelKey),
    }),
  );
  if (!confirmed) return;

  draftState.value = "running";
  draftResult.value = null;
  draftProgress.value = { stage: "upload", current: 0, total: result.value.imageCount };
  errorMessage.value = "";
  try {
    unlistenDraft = await listen("wechat-draft-progress", (event) => {
      if (event?.payload) draftProgress.value = event.payload;
    });
    const outcome = await invoke("publish_wechat_draft_from_bundle", {
      channel: PROBE_CHANNEL_BY_ID[channel.value.id],
      bundlePath: result.value.bundlePath,
    });
    draftResult.value = outcome;
    draftState.value = "done";
    props.history.append({
      workId: plan.value.meta.workId,
      channelId: channel.value.id,
      status: "draft",
      mode: "draft",
      title: plan.value.content.title,
      contentHash: contentHash.value,
      bundlePath: result.value.bundlePath,
      remoteId: outcome?.mediaId || "",
      imageCount: outcome?.imageCount || result.value.imageCount,
    });
    props.publish.markVariantReady();
  } catch (error) {
    draftState.value = "failed";
    const message = error?.message || String(error);
    errorMessage.value = message;
    applyPushVerdict(message);
  } finally {
    unlistenDraft?.();
    unlistenDraft = null;
  }
}

function truncateCodePoints(text, max) {
  const points = Array.from(text);
  return points.length > max ? points.slice(0, max).join("") : text;
}

function applyFix(issue) {
  if (issue?.action?.type === "switch-canvas") {
    emit("switch-canvas", channel.value);
    return;
  }
  if (issue?.action?.type === "goto-create") {
    emit("goto-create");
    return;
  }
  if (issue?.action?.type === "truncate-title") {
    titleDraft.value = truncateCodePoints(titleDraft.value, titleLimit.value);
    commitTitle();
    return;
  }
  if (issue?.action?.type === "truncate-body") {
    bodyDraft.value = truncateCodePoints(bodyDraft.value, bodyLimit.value);
    commitBody();
    return;
  }
  if (issue?.action?.type === "trim-tags") {
    tagsDraft.value = tagDraftText(tagList.value.slice(0, tagLimit.value));
    commitTags();
  }
}

function limitTone(actual, max) {
  if (!max) return "text-slate-500 dark:text-slate-400";
  return actual > max ? "text-rose-600 dark:text-rose-300" : "text-slate-500 dark:text-slate-400";
}

onBeforeUnmount(() => {
  abortController.value?.abort?.();
  unlistenDraft?.();
  unlistenDraft = null;
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-dialog flex items-center justify-center bg-slate-950/55 p-3 backdrop-blur-sm sm:p-5"
      role="dialog"
      aria-modal="true"
      :aria-label="t('publishFlow.title')"
      @click.self="emit('close')"
    >
      <div
        class="flex h-[min(92vh,860px)] w-[min(96vw,1080px)] min-w-0 flex-col overflow-hidden rounded-2xl border border-slate-200/90 bg-white shadow-2xl dark:border-slate-700/80 dark:bg-slate-900"
      >
        <header class="flex shrink-0 flex-wrap items-center gap-3 border-b border-slate-200/80 px-4 py-3 dark:border-slate-800 sm:px-5">
          <div class="flex min-w-0 items-center gap-2.5">
            <span class="grid h-9 w-9 place-items-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-300">
              <AppIcon name="upload" :size="17" />
            </span>
            <div class="min-w-0">
              <h2 class="truncate text-sm font-bold dark:text-slate-100">{{ t("publishFlow.title") }}</h2>
              <p class="truncate text-[11px] text-slate-500 dark:text-slate-400">
                {{ plan.meta.documentTitle || t("workspace.untitled") }}
              </p>
            </div>
          </div>

          <ol class="order-3 flex w-full items-center gap-1 rounded-lg border border-slate-200/80 bg-white p-1 dark:border-slate-700/80 dark:bg-slate-800/80 sm:order-none sm:ml-4 sm:w-auto">
            <li v-for="(name, index) in STEPS" :key="name" class="flex-1 sm:flex-none">
              <button
                type="button"
                class="h-7 w-full rounded-md px-3 text-[11px] font-semibold transition sm:w-auto"
                :class="step === index
                  ? 'bg-blue-600 text-white shadow-sm dark:bg-blue-500 dark:text-white'
                  : 'text-slate-500 dark:text-slate-400'"
                @click="step = index"
              >
                {{ index + 1 }}. {{ t(`publishFlow.steps.${name}`) }}
              </button>
            </li>
          </ol>

          <div class="ml-auto flex shrink-0 items-center gap-2">
            <span
              class="hidden rounded-full px-2 py-1 text-[11px] font-bold sm:inline-flex"
              :class="{
                'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-300': readiness.tone === 'ready',
                'bg-amber-50 text-amber-600 dark:bg-amber-950/50 dark:text-amber-300': readiness.tone === 'warning',
                'bg-rose-50 text-rose-600 dark:bg-rose-950/50 dark:text-rose-300': readiness.tone === 'blocker',
                'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400': readiness.tone === 'neutral',
              }"
            >
              {{ t(readiness.labelKey) }}
            </span>
            <button
              type="button"
              class="grid h-8 w-8 place-items-center rounded-lg border border-slate-200/90 text-slate-500 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-400 dark:hover:bg-slate-800"
              :aria-label="t('common.close')"
              @click="emit('close')"
            >
              <AppIcon name="x" :size="15" />
            </button>
          </div>
        </header>

        <div class="min-h-0 flex-1 overflow-y-auto px-4 py-4 dark:border-slate-800 sm:px-5">
          <section v-if="step === 0" class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div class="min-w-0 space-y-4">
              <div class="grid gap-2 sm:grid-cols-3">
                <button
                  v-for="item in publish.channels"
                  :key="item.id"
                  type="button"
                  class="rounded-xl border p-3 text-left transition"
                  :class="channel.id === item.id
                    ? 'border-blue-400 bg-blue-50/70 dark:border-blue-500/70 dark:bg-blue-950/40'
                    : 'border-slate-200/90 bg-white/70 hover:border-slate-300 dark:border-slate-700/80 dark:bg-slate-800/50'"
                  @click="selectChannel(item.id)"
                >
                  <div class="flex items-center gap-2">
                    <AppIcon :name="item.icon" :size="16" class="text-slate-500 dark:text-slate-400" />
                    <span class="truncate text-xs font-bold dark:text-slate-100">{{ t(item.labelKey) }}</span>
                  </div>
                  <p class="mt-1.5 text-[11px] leading-4 text-slate-500 dark:text-slate-400">
                    {{ t(`publishFlow.modes.${item.mode}`) }}
                  </p>
                  <p class="mt-1 text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                    {{ t("publishFlow.canvasHint", { width: item.canvas.width, height: item.canvas.height }) }}
                  </p>
                </button>
              </div>

              <div class="rounded-xl border border-slate-200/90 p-3 dark:border-slate-700/80">
                <div class="flex items-center justify-between gap-2">
                  <label class="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400" for="publish-title">
                    {{ t("publishFlow.fields.title") }}
                  </label>
                  <span class="text-[11px] font-semibold" :class="limitTone(countCodePoints(titleDraft), titleLimit)">
                    {{ countCodePoints(titleDraft) }}/{{ titleLimit }}
                  </span>
                </div>
                <input
                  id="publish-title"
                  v-model="titleDraft"
                  type="text"
                  class="mt-1.5 w-full rounded-lg border border-slate-200/90 bg-white/80 px-2.5 py-1.5 text-sm outline-none transition focus:border-blue-400 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-100"
                  @change="commitTitle"
                  @blur="commitTitle"
                />

                <div class="mt-3 flex items-center justify-between gap-2">
                  <label class="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400" for="publish-body">
                    {{ t("publishFlow.fields.body") }}
                  </label>
                  <div class="flex items-center gap-2">
                    <button type="button" class="text-[11px] font-semibold text-blue-600 hover:underline dark:text-blue-300" @click="resetBody">
                      {{ t("publishFlow.fields.resetBody") }}
                    </button>
                    <span class="text-[11px] font-semibold" :class="limitTone(countCodePoints(bodyDraft), bodyLimit)">
                      {{ countCodePoints(bodyDraft) }}/{{ bodyLimit }}
                    </span>
                  </div>
                </div>
                <textarea
                  id="publish-body"
                  v-model="bodyDraft"
                  rows="9"
                  class="mt-1.5 w-full resize-y rounded-lg border border-slate-200/90 bg-white/80 px-2.5 py-1.5 text-[13px] leading-6 outline-none transition focus:border-blue-400 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-100"
                  @change="commitBody"
                  @blur="commitBody"
                ></textarea>

                <div class="mt-3 flex items-center justify-between gap-2">
                  <label class="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400" for="publish-tags">
                    {{ t("publishFlow.fields.tags") }}
                  </label>
                  <span class="text-[11px] font-semibold" :class="limitTone(tagList.length, tagLimit)">
                    {{ tagList.length }}/{{ tagLimit || "∞" }}
                  </span>
                </div>
                <input
                  id="publish-tags"
                  v-model="tagsDraft"
                  type="text"
                  :placeholder="t('publishFlow.fields.tagsPlaceholder')"
                  class="mt-1.5 w-full rounded-lg border border-slate-200/90 bg-white/80 px-2.5 py-1.5 text-sm outline-none transition focus:border-blue-400 dark:border-slate-700 dark:bg-slate-900/60 dark:text-slate-100"
                  @change="commitTags"
                  @blur="commitTags"
                  @keydown.enter.prevent="commitTags"
                />

                <div v-if="tagList.length" class="mt-2 flex flex-wrap gap-1.5">
                  <span
                    v-for="tag in tagList"
                    :key="tag"
                    class="inline-flex items-center gap-1 rounded-full bg-blue-50 py-0.5 pl-2 pr-1 text-[11px] font-semibold text-blue-700 dark:bg-blue-950/50 dark:text-blue-300"
                  >
                    #{{ tag }}
                    <button
                      type="button"
                      class="grid h-4 w-4 place-items-center rounded-full transition hover:bg-blue-100 dark:hover:bg-blue-900/60"
                      :aria-label="t('publishFlow.fields.removeTag', { tag })"
                      @click="removeTag(tag)"
                    >
                      <AppIcon name="x" :size="10" />
                    </button>
                  </span>
                </div>

                <div v-if="suggestionTags.length" class="mt-2 flex flex-wrap items-center gap-1.5">
                  <span class="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                    {{ t("publishFlow.fields.tagsSuggest") }}
                  </span>
                  <button
                    v-for="tag in suggestionTags"
                    :key="tag"
                    type="button"
                    class="rounded-full border border-dashed border-slate-300 px-2 py-0.5 text-[11px] font-semibold text-slate-500 transition hover:border-blue-400 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-40 dark:border-slate-600 dark:text-slate-400"
                    :disabled="tagLimit > 0 && tagList.length >= tagLimit"
                    @click="addTag(tag)"
                  >
                    #{{ tag }}
                  </button>
                </div>
              </div>
            </div>

            <div class="flex min-w-0 flex-col rounded-xl border border-slate-200/90 p-3 dark:border-slate-700/80">
              <div class="flex items-center justify-between">
                <h3 class="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  {{ t("publishFlow.images.section") }}
                </h3>
                <span class="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
                  {{ plan.images.length }}/{{ channel.limits.images.max }}
                </span>
              </div>
              <p class="mt-1 text-[11px] leading-4 text-slate-500 dark:text-slate-400">
                {{ t("publishFlow.images.orderHint") }}
              </p>

              <ol class="mt-2 max-h-[min(58vh,560px)] min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-0.5">
                <li
                  v-for="(image, position) in plan.images"
                  :key="image.pageIndex"
                  class="flex items-center gap-2 rounded-lg border border-slate-200/80 px-2 py-1.5 dark:border-slate-700/70"
                  :class="image.missing ? 'bg-rose-50/60 dark:bg-rose-950/30' : 'bg-white/60 dark:bg-slate-800/40'"
                >
                  <span class="grid h-5 w-5 shrink-0 place-items-center rounded bg-slate-100 text-[10px] font-bold text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                    {{ String(position + 1).padStart(2, "0") }}
                  </span>
                  <img
                    v-if="image.src"
                    :src="image.src"
                    :alt="image.label"
                    class="h-9 w-7 shrink-0 rounded-md object-cover"
                  />
                  <span v-else class="grid h-9 w-7 shrink-0 place-items-center rounded-md bg-slate-100 text-slate-400 dark:bg-slate-800">
                    <AppIcon name="image" :size="13" />
                  </span>
                  <span class="min-w-0 flex-1">
                    <span class="flex items-center gap-1.5">
                      <span
                        v-if="image.role === 'cover'"
                        class="shrink-0 rounded bg-blue-600 px-1.5 py-0.5 text-[10px] font-bold text-white"
                      >
                        {{ t("publishFlow.images.cover") }}
                      </span>
                      <span class="truncate text-[12px] font-semibold dark:text-slate-200">
                        {{ image.label }} · {{ t(`publishFlow.imageKinds.${image.kind}`) }}
                      </span>
                    </span>
                    <span v-if="image.missing" class="block truncate text-[11px] text-rose-600 dark:text-rose-300">
                      {{ t("publishFlow.images.broken") }}
                    </span>
                  </span>
                  <span class="flex shrink-0 flex-col">
                    <button
                      type="button"
                      class="grid h-4 w-6 place-items-center rounded text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-30 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                      :disabled="position === 0"
                      :aria-label="t('publishFlow.images.moveUp')"
                      :title="t('publishFlow.images.moveUp')"
                      @click="movePage(image.pageIndex, -1)"
                    >
                      <AppIcon name="chevron-up" :size="12" />
                    </button>
                    <button
                      type="button"
                      class="grid h-4 w-6 place-items-center rounded text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-30 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                      :disabled="position === plan.images.length - 1"
                      :aria-label="t('publishFlow.images.moveDown')"
                      :title="t('publishFlow.images.moveDown')"
                      @click="movePage(image.pageIndex, 1)"
                    >
                      <AppIcon name="chevron-down" :size="12" />
                    </button>
                  </span>
                  <button
                    type="button"
                    class="shrink-0 rounded-md border border-slate-200/90 px-1.5 py-1 text-[10px] font-bold text-slate-500 transition hover:border-blue-300 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-30 dark:border-slate-700 dark:text-slate-400"
                    :disabled="image.role === 'cover'"
                    :title="t('publishFlow.images.toCover')"
                    @click="promoteCover(image.pageIndex)"
                  >
                    {{ t("publishFlow.images.toCover") }}
                  </button>
                  <button
                    type="button"
                    class="grid h-6 w-6 shrink-0 place-items-center rounded-md text-slate-400 transition hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40 dark:hover:text-rose-300"
                    :aria-label="t('publishFlow.images.remove')"
                    :title="t('publishFlow.images.remove')"
                    @click="removePage(image.pageIndex)"
                  >
                    <AppIcon name="x" :size="12" />
                  </button>
                </li>
              </ol>

              <p v-if="!plan.images.length" class="mt-2 rounded-lg bg-amber-50 px-2.5 py-2 text-[11px] leading-5 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                {{ t("publishFlow.images.noneSelected") }}
              </p>

              <div v-if="unselectedPages.length" class="mt-2.5 border-t border-slate-200/80 pt-2 dark:border-slate-700/70">
                <h4 class="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  {{ t("publishFlow.images.available") }}
                </h4>
                <ul class="mt-1.5 flex flex-wrap gap-1.5">
                  <li v-for="page in unselectedPages" :key="page.index">
                    <button
                      type="button"
                      class="flex items-center gap-1.5 rounded-lg border border-dashed border-slate-300 px-1.5 py-1 text-[11px] font-semibold text-slate-500 transition hover:border-blue-400 hover:text-blue-600 dark:border-slate-600 dark:text-slate-400"
                      :title="t('publishFlow.images.add')"
                      @click="addPage(page.index)"
                    >
                      <img
                        v-if="page.src"
                        :src="page.src"
                        :alt="page.label"
                        class="h-6 w-5 shrink-0 rounded object-cover"
                      />
                      <AppIcon v-else name="image" :size="12" />
                      <span class="max-w-[92px] truncate">{{ page.label }}</span>
                      <AppIcon name="plus" :size="11" />
                    </button>
                  </li>
                </ul>
              </div>
            </div>
          </section>

          <section v-else-if="step === 1" class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
            <PublishChecklist :preflight="preflight" @apply-action="applyFix" />

            <aside class="space-y-3 rounded-xl border border-slate-200/90 p-3 dark:border-slate-700/80">
              <div>
                <h3 class="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  {{ t("publishFlow.canvas.section") }}
                </h3>
                <p class="mt-1.5 text-[12px] leading-5 text-slate-600 dark:text-slate-300">
                  {{ t("publishFlow.canvas.current", {
                    width: plan.canvas.width,
                    height: plan.canvas.height,
                    count: plan.images.length,
                  }) }}
                </p>
                <p class="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                  {{ t("publishFlow.limitsHint", {
                    imageMin: channel.limits.images.min,
                    imageMax: channel.limits.images.max,
                    titleMax: channel.limits.title.max,
                    bodyMax: channel.limits.body.max,
                  }) }}
                </p>
              </div>

              <div v-if="channel.capabilities.publish && channel.mode === 'api'">
                <h3 class="text-[11px] font-bold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                  {{ t("publishFlow.canvas.mode") }}
                </h3>
                <div class="mt-1.5 flex gap-1 rounded-lg border border-slate-200/80 bg-white p-1 dark:border-slate-700/80 dark:bg-slate-800/80">
                  <button
                    v-for="mode in ['draft', 'publish']"
                    :key="mode"
                    type="button"
                    class="h-7 flex-1 rounded-md text-[11px] font-semibold transition"
                    :class="plan.options.mode === mode
                      ? 'bg-blue-600 text-white shadow-sm dark:bg-blue-500 dark:text-white'
                      : 'text-slate-500 dark:text-slate-400'"
                    @click="setMode(mode)"
                  >
                    {{ t(`publishFlow.modes.publishMode.${mode}`) }}
                  </button>
                </div>
              </div>

              <p v-if="!canWriteBundle" class="rounded-lg bg-amber-50 px-2.5 py-2 text-[11px] leading-5 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300">
                {{ t("publishFlow.errors.bundleUnsupported") }}
              </p>
              <p v-else-if="previousRecord" class="rounded-lg bg-slate-50 px-2.5 py-2 text-[11px] leading-5 text-slate-600 dark:bg-slate-800/60 dark:text-slate-300">
                {{ t("publishFlow.alreadyPublished", { time: new Date(previousRecord.createdAt).toLocaleString() }) }}
              </p>
            </aside>
          </section>

          <section v-else class="space-y-3">
            <div
              v-if="isTauri && bundleRoot"
              class="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200/90 bg-slate-50/70 px-3 py-2 dark:border-slate-700/80 dark:bg-slate-800/50"
            >
              <AppIcon name="folder-open" :size="14" class="shrink-0 text-slate-400" />
              <p class="min-w-0 flex-1 break-all text-[11px] leading-5 text-slate-500 dark:text-slate-400">
                {{ t("publishFlow.bundleRootHint", { path: bundleRoot }) }}
              </p>
              <button
                type="button"
                class="shrink-0 rounded-md border border-slate-200/90 px-2 py-1 text-[11px] font-semibold text-slate-600 transition hover:border-blue-300 hover:text-blue-600 dark:border-slate-700 dark:text-slate-300"
                @click="handleOpenRoot"
              >
                {{ t("publishFlow.actions.openFolder") }}
              </button>
            </div>

            <div
              v-if="!result && !isGenerating"
              class="rounded-xl border border-dashed border-slate-200/90 p-4 text-center dark:border-slate-700/80"
            >
              <p class="text-sm font-bold dark:text-slate-100">{{ t("publishFlow.steps.publish") }}</p>
              <p class="mx-auto mt-1.5 max-w-md text-[12px] leading-5 text-slate-500 dark:text-slate-400">
                {{ t(`publishFlow.channelNotes.${channel.id}`) }}
              </p>
              <p class="mx-auto mt-2 max-w-md rounded-lg bg-slate-50 px-3 py-2 text-left text-[11px] leading-5 text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
                {{ t("publishFlow.bundleExplainer") }}
              </p>
              <button
                v-if="channel.mode === 'assist' && canWriteBundle && isTauri"
                type="button"
                class="mt-3 inline-flex h-9 items-center gap-1.5 rounded-xl bg-blue-600 px-4 text-[12px] font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                :disabled="isGenerating || preflight.counts.blocker > 0"
                @click="handleOneClickPublish"
              >
                <AppIcon name="upload" :size="14" />
                {{ t("publishFlow.actions.oneClickCreator") }}
              </button>
              <p
                v-if="channel.mode === 'assist'"
                class="mx-auto mt-2 max-w-md text-[11px] leading-5 text-slate-500 dark:text-slate-400"
              >
                {{ t("publishFlow.bridge.oneClickHint") }}
              </p>
              <p v-if="!preflight.ready" class="mt-2 text-[12px] font-semibold text-rose-600 dark:text-rose-300">
                {{ t("publishFlow.blockedHint") }}
              </p>
            </div>

            <div
              v-if="isGenerating"
              class="rounded-xl border border-slate-200/90 p-4 dark:border-slate-700/80"
            >
              <div class="flex items-center gap-2 text-[12px] font-semibold text-slate-600 dark:text-slate-300">
                <AppIcon name="loader" :size="15" class="animate-spin text-blue-600" />
                <span>{{ t(`publishFlow.progress.${progress.stage}`) }}</span>
                <span class="ml-auto text-slate-400">{{ progress.current }}/{{ progress.total }}</span>
              </div>
              <div class="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
                <div
                  class="h-full rounded-full bg-blue-500 transition-all"
                  :style="{ width: `${progress.total ? (progress.current / progress.total) * 100 : 0}%` }"
                ></div>
              </div>
              <button type="button" class="mt-2 text-[11px] font-semibold text-slate-500 hover:text-rose-600" @click="cancelGenerate">
                {{ t("publishFlow.actions.cancel") }}
              </button>
            </div>

            <div v-if="result" class="space-y-3">
              <div class="rounded-xl border border-emerald-200/80 bg-emerald-50/70 p-3 dark:border-emerald-900/70 dark:bg-emerald-950/40">
                <div class="flex items-center gap-2 text-[12px] font-bold text-emerald-700 dark:text-emerald-300">
                  <AppIcon name="check-circle" :size="15" />
                  {{ t("publishFlow.bundleReady", { count: result.imageCount }) }}
                </div>
                <p class="mt-1 break-all text-[11px] leading-5 text-emerald-700/80 dark:text-emerald-300/80">
                  {{ result.bundlePath || t("publishFlow.bundleFolderNamed", { name: bundleRoot }) }}
                </p>
              </div>

              <div
                v-if="bridgeInfo"
                class="rounded-xl border border-blue-200/80 bg-blue-50/70 p-3 dark:border-blue-900/70 dark:bg-blue-950/40"
              >
                <div class="flex items-center gap-2 text-[12px] font-bold text-blue-700 dark:text-blue-300">
                  <AppIcon name="upload" :size="15" />
                  {{ t("publishFlow.bridge.ready") }}
                </div>
                <p class="mt-1 text-[11px] leading-5 text-blue-700/80 dark:text-blue-300/80">
                  {{ t("publishFlow.bridge.readyHint", { minutes: bridgeMinutes }) }}
                </p>
              </div>
              <p
                v-else-if="bridgeError"
                class="rounded-lg bg-amber-50 px-3 py-2 text-[11px] leading-5 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
              >
                {{ t("publishFlow.bridge.failed", { error: bridgeError }) }}
              </p>

              <!-- One surface for every permission verdict: before this existed, a
                   stale or missing check silently removed the push action. -->
              <div
                v-if="draftPanelOpen"
                class="rounded-xl border border-slate-200/90 bg-white/70 p-3 dark:border-slate-700/80 dark:bg-slate-800/40"
              >
                <div class="flex flex-wrap items-center gap-2">
                  <p class="min-w-0 flex-1 text-[12px] font-bold text-slate-700 dark:text-slate-200">
                    {{ t("publishFlow.draft.title") }}
                  </p>
                  <span
                    v-if="draftState === 'running'"
                    class="inline-flex items-center gap-1.5 text-[12px] font-semibold text-slate-500 dark:text-slate-400"
                  >
                    <AppIcon name="loader" :size="14" class="animate-spin text-blue-600" />
                    {{ t(`publishFlow.draft.stages.${draftProgress.stage}`) }}
                    <span class="tabular-nums text-slate-400">
                      {{ draftProgress.current }}/{{ draftProgress.total }}
                    </span>
                  </span>
                  <button
                    v-else-if="canPushDraft"
                    type="button"
                    class="inline-flex h-8 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-[12px] font-bold text-white transition-colors hover:bg-blue-700 cursor-pointer"
                    @click="handlePushDraft"
                  >
                    <AppIcon name="upload" :size="14" />
                    {{ draftState === "done" ? t("publishFlow.draft.again") : t("publishFlow.draft.push") }}
                  </button>
                  <button
                    v-else-if="draftVerdict !== 'allowed'"
                    type="button"
                    class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200/90 px-3 text-[12px] font-semibold text-slate-600 transition-colors hover:border-blue-300 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-300"
                    :disabled="probing"
                    @click="runPermissionProbe"
                  >
                    <AppIcon :name="probing ? 'loader' : 'shield'" :size="14" :class="{ 'animate-spin': probing }" />
                    {{ probing ? t("publishFlow.draft.probing") : t("publishFlow.draft.probe") }}
                  </button>
                </div>
                <div
                  v-if="draftState === 'running'"
                  class="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"
                >
                  <div
                    class="h-full rounded-full bg-blue-500 transition-all"
                    :style="{ width: `${draftProgress.total ? (draftProgress.current / draftProgress.total) * 100 : 0}%` }"
                  ></div>
                </div>
                <p
                  v-if="draftState === 'done'"
                  class="mt-1.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300"
                >
                  {{ t("publishFlow.draft.done", { count: draftResult?.imageCount || 0 }) }}
                </p>
                <p
                  v-else-if="draftVerdict === 'allowed' || draftState === 'running'"
                  class="mt-1 text-[11px] leading-5 text-slate-500 dark:text-slate-400"
                >
                  {{ t("publishFlow.draft.desc") }}
                </p>
                <p v-else class="mt-1 text-[11px] leading-5 text-amber-700 dark:text-amber-300">
                  {{ t(draftNoticeKey) }}
                </p>
                <p v-if="probeError" class="mt-1 text-[11px] leading-5 text-rose-700 dark:text-rose-300">
                  {{ t("publishFlow.draft.probeFailed", { error: probeError }) }}
                </p>
                <p
                  v-else-if="draftVerdict !== 'allowed' && probeMessage"
                  class="mt-1 break-all text-[11px] leading-5 text-slate-500 dark:text-slate-400"
                >
                  {{ t("publishFlow.draft.wechatSaid", { message: probeMessage }) }}
                </p>
              </div>

              <div class="grid gap-2 sm:grid-cols-2">
                <button
                  v-for="action in resultActions"
                  v-show="!action.hidden"
                  :key="action.key"
                  type="button"
                  class="flex items-center gap-2 rounded-xl border border-slate-200/90 px-3 py-2 text-[12px] font-semibold text-slate-600 transition hover:border-blue-300 hover:text-blue-600 dark:border-slate-700 dark:text-slate-300 dark:hover:text-blue-300"
                  @click="action.handler"
                >
                  <AppIcon :name="action.icon" :size="15" />
                  {{ action.copied ? t("publishFlow.actions.copied") : t(action.labelKey) }}
                </button>
              </div>
            </div>

            <!-- One surface for every permission verdict: before this existed, a
                 stale or missing check silently removed the push action. -->
            <p v-if="errorMessage" class="rounded-lg bg-rose-50 px-3 py-2 text-[12px] leading-5 text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
              {{ errorMessage }}
            </p>
          </section>
        </div>

        <footer class="flex shrink-0 flex-wrap items-center gap-2 border-t border-slate-200/80 px-4 py-3 dark:border-slate-800 sm:px-5">
          <button
            v-if="step > 0"
            type="button"
            class="h-9 rounded-xl border border-slate-200/90 px-3 text-[12px] font-semibold text-slate-600 transition hover:bg-slate-100 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
            @click="goBack"
          >
            {{ t("publishFlow.actions.back") }}
          </button>
          <button
            v-if="step < STEPS.length - 1"
            type="button"
            class="h-9 rounded-xl bg-blue-600 px-4 text-[12px] font-bold text-white transition hover:bg-blue-700"
            @click="goNext"
          >
            {{ t("publishFlow.actions.next") }}
          </button>
          <button
            v-else
            type="button"
            class="h-9 rounded-xl bg-blue-600 px-4 text-[12px] font-bold text-white transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="isGenerating || !canWriteBundle || (preflight.counts.blocker > 0 && channel.mode !== 'bundle')"
            @click="handleGenerate"
          >
            {{ t("publishFlow.actions.generateBundle") }}
          </button>
          <span class="ml-auto text-[11px] text-slate-500 dark:text-slate-400">
            {{ t("publishFlow.footerHint", { channel: t(channel.labelKey) }) }}
          </span>
        </footer>
      </div>
    </div>
  </Teleport>
</template>
