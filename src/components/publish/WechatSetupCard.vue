<script setup>
import { computed, nextTick, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import { invoke } from "@tauri-apps/api/core";
import {
  clearChannelPermissions,
  readChannelPermissions,
  writeChannelPermissions,
} from "../../storage/channelPermissions.js";
import AppIcon from "../AppIcon.vue";

const props = defineProps({
  isTauri: {
    type: Boolean,
    default: false,
  },
});

const CHANNEL = "wechat";
const { t } = useI18n();

const PROBE_LABEL_KEYS = {
  domainIp: "publishFlow.credentials.probe.domainIp",
  menu: "publishFlow.credentials.probe.menu",
  material: "publishFlow.credentials.probe.material",
  draft: "publishFlow.credentials.probe.draft",
  freepublish: "publishFlow.credentials.probe.freepublish",
  articleStats: "publishFlow.credentials.probe.articleStats",
  articleTotal: "publishFlow.credentials.probe.articleTotal",
  articleRead: "publishFlow.credentials.probe.articleRead",
  articleShare: "publishFlow.credentials.probe.articleShare",
  userStats: "publishFlow.credentials.probe.userStats",
  userCumulate: "publishFlow.credentials.probe.userCumulate",
  messageStats: "publishFlow.credentials.probe.messageStats",
  interfaceSummary: "publishFlow.credentials.probe.interfaceSummary",
  userList: "publishFlow.credentials.probe.userList",
};

const PROBE_TONES = {
  allowed: "bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-300",
  unauthorized: "bg-rose-50 text-rose-600 dark:bg-rose-950/40 dark:text-rose-300",
  blockedIp: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  invalidCredentials: "bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300",
  busy: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
  unknown: "bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400",
};

const status = ref({ configured: false, appIdMasked: "" });
const formOpen = ref(false);
const formRef = ref(null);
const appIdRef = ref(null);
const appId = ref("");
const appSecret = ref("");
const busy = ref("");
const message = ref("");
const error = ref("");
const loaded = ref(false);

const credentialsChanged = computed(() => Boolean(appId.value.trim() && appSecret.value.trim()));
const canSave = computed(() => credentialsChanged.value);
const probe = ref(null);
const publicIp = ref("");
const fetchingIp = ref(false);
const ipError = ref("");
const ipCopied = ref(false);

const proxy = ref({ configured: false, urlMasked: "" });
const proxyOpen = ref(false);
const proxyUrl = ref("");
const proxyBusy = ref(false);
const proxyMessage = ref("");
const proxyError = ref("");
const proxyFormRef = ref(null);
const proxyInputRef = ref(null);
const probeItems = computed(() => probe.value?.items || []);
const statusByKey = computed(() =>
  Object.fromEntries(probeItems.value.map((item) => [item.key, item.status])),
);
const draftBlocked = computed(
  () => probeItems.value.length > 0 && statusByKey.value.draft !== "allowed",
);

function probeLabel(key) {
  return PROBE_LABEL_KEYS[key] ? t(PROBE_LABEL_KEYS[key]) : key;
}

function probeStatusText(itemStatus) {
  return t(`publishFlow.credentials.probeStatus.${itemStatus}`);
}

function probeTone(itemStatus) {
  return PROBE_TONES[itemStatus] || PROBE_TONES.unknown;
}

function readableError(value) {
  return typeof value === "string" ? value : value?.message || String(value);
}

function applyStatus(next) {
  status.value = next || { configured: false, appIdMasked: "" };
}

async function refreshStatus() {
  if (!props.isTauri) {
    loaded.value = true;
    return;
  }
  try {
    applyStatus(await invoke("channel_credentials_status", { channel: CHANNEL }));
    try {
      const proxyStatus = await invoke("channel_proxy_status", { channel: CHANNEL });
      if (proxyStatus) proxy.value = proxyStatus;
    } catch {
      // A keychain hiccup on the proxy must not hide the credential status.
    }
    if (status.value.configured) {
      const cached = readChannelPermissions(CHANNEL);
      if (cached) probe.value = { items: cached.items };
    }
  } catch (err) {
    error.value = readableError(err);
  } finally {
    loaded.value = true;
  }
}

function openForm() {
  formOpen.value = !formOpen.value;
  if (formOpen.value) {
    appId.value = "";
    appSecret.value = "";
    message.value = "";
    error.value = "";
    // The form is taller than the settings dialog body, so reveal it instead of leaving 保存/取消 below the fold.
    nextTick(() => {
      const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      formRef.value?.scrollIntoView({
        block: "center",
        behavior: reducedMotion ? "auto" : "smooth",
      });
      appIdRef.value?.focus({ preventScroll: true });
    });
  }
}

async function save() {
  if (!canSave.value) return;
  busy.value = "save";
  message.value = "";
  error.value = "";
  try {
    let next = status.value;
    if (credentialsChanged.value) {
      next = await invoke("set_channel_credentials", {
        channel: CHANNEL,
        appId: appId.value,
        appSecret: appSecret.value,
      });
    }
    applyStatus(next);
    appId.value = "";
    appSecret.value = "";
    formOpen.value = false;
    probe.value = null;
    clearChannelPermissions(CHANNEL);
    message.value = t("publishFlow.credentials.saved");
  } catch (err) {
    error.value = readableError(err);
  } finally {
    busy.value = "";
  }
}

async function testConnection() {
  busy.value = "test";
  message.value = "";
  error.value = "";
  try {
    const result = await invoke("test_channel_credentials", { channel: CHANNEL });
    message.value = result?.ok
      ? t("publishFlow.credentials.testOk", { seconds: result.expiresIn })
      : t("publishFlow.credentials.testFail", { message: result?.message || "" });
  } catch (err) {
    error.value = readableError(err);
  } finally {
    busy.value = "";
  }
}

async function fetchPublicIp() {
  fetchingIp.value = true;
  ipError.value = "";
  ipCopied.value = false;
  try {
    // Runs in Rust on purpose: the WebView may use a different proxy/VPN than
    // the API calls, so a browser lookup would report the wrong egress IP.
    const result = await invoke("fetch_public_ip");
    const ip = String(result?.ip || "").trim();
    if (!ip) throw new Error("empty response");
    publicIp.value = ip;
  } catch (err) {
    publicIp.value = "";
    ipError.value = t("publishFlow.credentials.fetchIpFailed", {
      error: readableError(err),
    });
  } finally {
    fetchingIp.value = false;
  }
}

async function copyPublicIp() {
  if (!publicIp.value) return;
  try {
    await navigator.clipboard.writeText(publicIp.value);
    ipCopied.value = true;
    window.setTimeout(() => {
      ipCopied.value = false;
    }, 1500);
  } catch {
    ipError.value = t("publishFlow.credentials.copyIpFailed");
  }
}

function toggleProxyForm() {
  proxyOpen.value = !proxyOpen.value;
  proxyUrl.value = "";
  proxyMessage.value = "";
  proxyError.value = "";
  if (!proxyOpen.value) return;
  // The proxy card sits at the bottom of the settings dialog body, so an opened
  // form would land below the fold and look like the button did nothing.
  nextTick(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    proxyFormRef.value?.scrollIntoView({
      block: "center",
      behavior: reducedMotion ? "auto" : "smooth",
    });
    proxyInputRef.value?.focus({ preventScroll: true });
  });
}

async function saveProxy() {
  const value = proxyUrl.value.trim();
  if (!value || proxyBusy.value) return;
  proxyBusy.value = true;
  proxyMessage.value = "";
  proxyError.value = "";
  try {
    proxy.value = await invoke("set_channel_proxy", { channel: CHANNEL, url: value });
    proxyUrl.value = "";
    proxyOpen.value = false;
    proxyMessage.value = t("publishFlow.credentials.proxySaved");
    // The whole point of the relay is the egress IP, so show the new one right
    // away instead of making the user press 获取公网 IP again.
    await fetchPublicIp();
  } catch (err) {
    proxyError.value = readableError(err);
  } finally {
    proxyBusy.value = false;
  }
}

async function clearProxy() {
  if (!window.confirm(t("publishFlow.credentials.proxyClearConfirm"))) return;
  proxyBusy.value = true;
  proxyMessage.value = "";
  proxyError.value = "";
  try {
    proxy.value = await invoke("clear_channel_proxy", { channel: CHANNEL });
    proxyOpen.value = false;
    proxyMessage.value = t("publishFlow.credentials.proxyCleared");
    await fetchPublicIp();
  } catch (err) {
    proxyError.value = readableError(err);
  } finally {
    proxyBusy.value = false;
  }
}

async function runProbe() {
  busy.value = "probe";
  message.value = "";
  error.value = "";
  try {
    const result = await invoke("probe_channel_permissions", { channel: CHANNEL });
    probe.value = result;
    writeChannelPermissions(
      CHANNEL,
      (result?.items || []).map((item) => ({ key: item.key, status: item.status })),
    );
  } catch (err) {
    probe.value = null;
    error.value = readableError(err);
  } finally {
    busy.value = "";
  }
}

async function clearCredentials() {
  if (!window.confirm(t("publishFlow.credentials.clearConfirm"))) return;
  busy.value = "clear";
  message.value = "";
  error.value = "";
  try {
    applyStatus(await invoke("clear_channel_credentials", { channel: CHANNEL }));
    formOpen.value = false;
    probe.value = null;
    clearChannelPermissions(CHANNEL);
    message.value = t("publishFlow.credentials.cleared");
  } catch (err) {
    error.value = readableError(err);
  } finally {
    busy.value = "";
  }
}

onMounted(async () => {
  await refreshStatus();
  // The egress IP is informational, so it resolves on open instead of sitting
  // behind a button; saving or clearing the relay proxy refreshes it again.
  if (props.isTauri) fetchPublicIp();
});
</script>

<template>
  <section class="rounded-2xl border border-slate-200/80 bg-white/85 p-4 shadow-sm dark:border-slate-700/80 dark:bg-slate-900/80">
    <div class="flex flex-wrap items-start justify-between gap-3">
      <div class="flex min-w-0 items-start gap-2.5">
        <span class="mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400">
          <AppIcon name="link" :size="16" />
        </span>
        <div class="min-w-0">
          <h2 class="text-sm font-bold dark:text-slate-100">{{ t("publishFlow.credentials.title") }}</h2>
          <p class="mt-0.5 text-xs leading-5 text-slate-500 dark:text-slate-400">
            {{ t("publishFlow.credentials.desc") }}
          </p>
        </div>
      </div>
      <span
        v-if="loaded"
        class="shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold"
        :class="status.configured
          ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-300'
          : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'"
      >
        {{ status.configured
          ? t("publishFlow.credentials.configured", { appId: status.appIdMasked })
          : t("publishFlow.credentials.notConfigured") }}
      </span>
    </div>

    <p
      v-if="!isTauri"
      class="mt-3 rounded-lg bg-amber-50 px-2.5 py-2 text-[11px] leading-5 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
    >
      {{ t("publishFlow.credentials.desktopOnly") }}
    </p>

    <template v-else>
      <div class="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          class="inline-flex h-8 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-xs font-bold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          @click="openForm"
        >
          <AppIcon name="settings" :size="14" />
          {{ status.configured ? t("publishFlow.credentials.update") : t("publishFlow.credentials.setup") }}
        </button>
        <button
          type="button"
          class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          :disabled="!status.configured || Boolean(busy)"
          @click="testConnection"
        >
          <AppIcon :name="busy === 'test' ? 'loader' : 'link'" :size="14" :class="{ 'animate-spin': busy === 'test' }" />
          {{ t("publishFlow.credentials.test") }}
        </button>
        <button
          type="button"
          class="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          :disabled="!status.configured || Boolean(busy)"
          :title="t('publishFlow.credentials.probeHint')"
          @click="runProbe"
        >
          <AppIcon :name="busy === 'probe' ? 'loader' : 'shield'" :size="14" :class="{ 'animate-spin': busy === 'probe' }" />
          {{ t("publishFlow.credentials.probeButton") }}
        </button>
        <button
          v-if="status.configured"
          type="button"
          class="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-semibold text-slate-500 transition-colors hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-50 dark:text-slate-400 dark:hover:bg-rose-950/40 dark:hover:text-rose-300"
          :disabled="Boolean(busy)"
          @click="clearCredentials"
        >
          <AppIcon name="trash-2" :size="14" />
          {{ t("publishFlow.credentials.clear") }}
        </button>
      </div>

      <div class="mt-2.5 rounded-lg border border-slate-200/70 bg-white/60 px-2.5 py-2 dark:border-slate-700/70 dark:bg-slate-950/30">
        <div class="flex flex-wrap items-center gap-2">
          <span class="text-[11px] font-bold text-slate-600 dark:text-slate-300">
            {{ t("publishFlow.credentials.proxyTitle") }}
          </span>
          <span
            class="rounded-full px-1.5 py-0.5 text-[10px] font-bold"
            :class="proxy.configured
              ? 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/50 dark:text-emerald-300'
              : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'"
          >
            {{ proxy.configured
              ? t("publishFlow.credentials.proxyOn", { url: proxy.urlMasked })
              : t("publishFlow.credentials.proxyOff") }}
          </span>
          <div class="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              class="inline-flex h-7 items-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-600 transition-colors hover:border-blue-300 hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
              :disabled="proxyBusy"
              @click="toggleProxyForm"
            >
              <AppIcon name="link" :size="12" />
              {{ proxy.configured ? t("publishFlow.credentials.proxyUpdate") : t("publishFlow.credentials.proxySetup") }}
            </button>
            <button
              v-if="proxy.configured"
              type="button"
              class="inline-flex h-7 items-center rounded-md px-2 text-[11px] font-semibold text-slate-500 transition-colors hover:bg-rose-50 hover:text-rose-600 disabled:cursor-not-allowed disabled:opacity-60 dark:text-slate-400 dark:hover:bg-rose-950/40 dark:hover:text-rose-300"
              :disabled="proxyBusy"
              @click="clearProxy"
            >
              {{ t("publishFlow.credentials.proxyClear") }}
            </button>
          </div>
        </div>
        <p class="mt-1 text-[10px] leading-4 text-slate-500 dark:text-slate-400">
          {{ t("publishFlow.credentials.proxyHint") }}
        </p>

        <form v-if="proxyOpen" ref="proxyFormRef" class="mt-1.5 flex flex-wrap items-center gap-2" @submit.prevent="saveProxy">
          <input
            ref="proxyInputRef"
            v-model="proxyUrl"
            type="text"
            autocomplete="off"
            spellcheck="false"
            class="h-8 min-w-0 flex-1 rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-800 outline-none focus:border-blue-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            :placeholder="t('publishFlow.credentials.proxyPlaceholder')"
          />
          <button
            type="submit"
            class="inline-flex h-8 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-xs font-bold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="!proxyUrl.trim() || proxyBusy"
          >
            <AppIcon :name="proxyBusy ? 'loader' : 'save'" :size="14" :class="{ 'animate-spin': proxyBusy }" />
            {{ proxyBusy ? t("publishFlow.credentials.proxySaving") : t("publishFlow.credentials.proxySave") }}
          </button>
          <button
            type="button"
            class="inline-flex h-8 items-center rounded-lg px-2.5 text-xs font-semibold text-slate-500 transition-colors hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            @click="toggleProxyForm"
          >
            {{ t("publishFlow.credentials.cancel") }}
          </button>
        </form>
        <p v-if="proxyMessage" class="mt-1 text-[10px] font-medium text-emerald-700 dark:text-emerald-400">{{ proxyMessage }}</p>
        <p v-if="proxyError" class="mt-1 text-[10px] font-medium text-rose-600 dark:text-rose-300">{{ proxyError }}</p>
      </div>

      <div class="mt-2.5 rounded-lg bg-slate-50/80 px-2.5 py-2 dark:bg-slate-800/50">
        <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span class="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
            {{ t("publishFlow.credentials.exitIp") }}
          </span>
          <span class="min-w-0 break-all text-[10px] text-slate-500 dark:text-slate-400">
            {{ t("publishFlow.credentials.exitIpHint") }}
          </span>
          <span
            v-if="fetchingIp"
            class="ml-auto inline-flex items-center gap-1 text-[10px] font-medium text-slate-400 dark:text-slate-500"
          >
            <AppIcon name="loader" :size="10" class="animate-spin" />
            {{ t("publishFlow.credentials.fetchingIp") }}
          </span>
        </div>

        <div v-if="publicIp" class="mt-1.5 flex flex-wrap items-center gap-2">
          <span class="rounded-md bg-white px-1.5 py-0.5 font-mono text-[11px] font-semibold text-slate-700 dark:bg-slate-900 dark:text-slate-200">
            {{ publicIp }}
          </span>
          <button
            type="button"
            class="text-[10px] font-semibold text-blue-600 hover:underline dark:text-blue-300"
            @click="copyPublicIp"
          >
            {{ ipCopied ? t("publishFlow.credentials.ipCopied") : t("publishFlow.credentials.copyIp") }}
          </button>
        </div>
        <p v-if="ipError" class="mt-1 text-[10px] font-medium text-rose-600 dark:text-rose-300">
          {{ ipError }}
        </p>

        <p class="mt-1 text-[10px] leading-4 text-slate-500 dark:text-slate-400">
          {{ proxy.configured
            ? t("publishFlow.credentials.proxiedIpHint")
            : t("publishFlow.credentials.ipHint") }}
        </p>
      </div>

      <div
        v-if="probeItems.length"
        class="mt-2.5 rounded-lg border border-slate-200/70 bg-white/60 px-2.5 py-2 dark:border-slate-700/70 dark:bg-slate-950/30"
      >
        <p class="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
          {{ t("publishFlow.credentials.probeTitle") }}
        </p>
        <ul class="mt-1 space-y-1">
          <li v-for="item in probeItems" :key="item.key" class="flex items-center justify-between gap-2">
            <span class="min-w-0 truncate text-[11px] text-slate-600 dark:text-slate-300" :title="item.message">
              {{ probeLabel(item.key) }}
            </span>
            <span
              class="shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-bold"
              :class="probeTone(item.status)"
            >
              {{ probeStatusText(item.status) }}
            </span>
          </li>
        </ul>
        <p v-if="draftBlocked" class="mt-1.5 text-[10px] leading-4 text-amber-700 dark:text-amber-300">
          {{ t("publishFlow.credentials.probeBlocked") }}
        </p>
      </div>

      <form v-if="formOpen" ref="formRef" class="mt-3 grid gap-2 sm:grid-cols-2" @submit.prevent="save">
        <label class="grid gap-1">
          <span class="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
            {{ t("publishFlow.credentials.appId") }}
          </span>
          <input
            ref="appIdRef"
            v-model="appId"
            type="text"
            autocomplete="off"
            spellcheck="false"
            class="h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-800 outline-none focus:border-blue-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            placeholder="wx0000000000000000"
          />
        </label>
        <label class="grid gap-1">
          <span class="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
            {{ t("publishFlow.credentials.appSecret") }}
          </span>
          <input
            v-model="appSecret"
            type="password"
            autocomplete="new-password"
            class="h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-800 outline-none focus:border-blue-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
            :placeholder="status.configured
              ? t('publishFlow.credentials.secretKeep')
              : t('publishFlow.credentials.secretPlaceholder')"
          />
        </label>

        <p class="text-[11px] leading-5 text-slate-500 sm:col-span-2 dark:text-slate-400">
          {{ t("publishFlow.credentials.keychainHint") }} {{ t("publishFlow.credentials.ipHint") }}
        </p>

        <div class="flex items-center gap-2 sm:col-span-2">
          <button
            type="submit"
            class="inline-flex h-8 items-center gap-1.5 rounded-lg bg-blue-600 px-3 text-xs font-bold text-white transition-colors hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            :disabled="!canSave || Boolean(busy)"
          >
            <AppIcon :name="busy === 'save' ? 'loader' : 'save'" :size="14" :class="{ 'animate-spin': busy === 'save' }" />
            {{ t("publishFlow.credentials.save") }}
          </button>
          <button
            type="button"
            class="inline-flex h-8 items-center rounded-lg px-2.5 text-xs font-semibold text-slate-500 transition-colors hover:bg-slate-100 dark:text-slate-400 dark:hover:bg-slate-800"
            @click="formOpen = false"
          >
            {{ t("publishFlow.credentials.cancel") }}
          </button>
        </div>
      </form>
    </template>

    <p v-if="message" class="mt-2 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">{{ message }}</p>
    <p v-if="error" class="mt-2 text-[11px] font-medium text-rose-700 dark:text-rose-400">{{ error }}</p>
  </section>
</template>
