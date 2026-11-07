import { clearBundleDir, loadBundleDir, saveBundleDir } from "./storage.js";
import { XHS_CHANNEL_ID, fillXhs } from "./adapters/xhs.js";

const XHS_URL = "https://creator.xiaohongshu.com/*";
const state = { handle: null, bundle: null, tabId: 0 };
const el = (id) => document.getElementById(id);

function setNotice(text, kind) {
  const node = el("notice");
  node.textContent = text || "";
  node.className = `notice${kind ? ` ${kind}` : ""}`;
}

function showBundle(bundle) {
  // The bridge is the one-click path from the app; a picked folder is the
  // fallback when the extension is used on its own.
  el("bundleName").textContent =
    bundle.source === "bridge" ? "MarkCard Studio（本地桥接）" : state.handle?.name || "已选择目录";
  el("summary").classList.remove("hidden");
  el("sChannel").textContent = bundle.channelId || "-";
  el("sCanvas").textContent = bundle.canvas ? `${bundle.canvas.width}×${bundle.canvas.height}` : "-";
  el("sCount").textContent = `${bundle.count} 张`;
  el("sTitle").textContent = `${bundle.content.title || "（空）"} · ${[...bundle.content.title].length} 字`;
  el("sBody").textContent = `${[...bundle.content.body].length} 字`;
  el("sTags").textContent = bundle.content.tags.length ? bundle.content.tags.join(" / ") : "（无）";
  if (!bundle.ready) setNotice("这个发布包的校验里有阻塞项，填充前请先回应用处理。", "warn");
}

function syncButtons() {
  el("btnReload").classList.toggle("hidden", !state.handle);
  el("btnClear").classList.toggle("hidden", !state.handle);
  el("btnFill").disabled = !(state.bundle?.channelId === XHS_CHANNEL_ID && state.tabId);
}

async function describe() {
  setNotice("");
  const res = await chrome.runtime.sendMessage({ type: "describe" });
  if (!res?.ok) {
    state.bundle = null;
    setNotice(res?.error || "读取发布包失败。", "bad");
    syncButtons();
    return;
  }
  state.bundle = res.bundle;
  showBundle(res.bundle);
  if (res.bundle.channelId !== XHS_CHANNEL_ID) {
    setNotice(
      `这个发布包是 ${res.bundle.channelId || "未知"} 渠道生成的，扩展只填小红书。请回应用用「小红书图文」重新生成一次。`,
      "bad",
    );
  }
  await checkTab();
}

async function checkTab() {
  const tabs = await chrome.tabs.query({ url: XHS_URL });
  const active = tabs.find((tab) => tab.active) || tabs[0];
  state.tabId = active?.id || 0;
  el("tabState").textContent = tabs.length
    ? `已打开 ${tabs.length} 个创作平台标签页`
    : "没有小红书创作平台标签页";
  syncButtons();
}

async function pick() {
  try {
    const handle = await window.showDirectoryPicker({ id: "markcard-bundle", mode: "read" });
    await handle.requestPermission({ mode: "read" });
    await saveBundleDir(handle);
    state.handle = handle;
    // Picking a folder is an explicit choice, so it wins over a handoff that
    // may already be stale.
    await chrome.runtime.sendMessage({ type: "bridge-clear" }).catch(() => {});
    await describe();
  } catch (error) {
    if (error?.name !== "AbortError") setNotice(String(error?.message || error), "bad");
  }
}

async function fill() {
  if (!state.bundle || !state.tabId) return;
  el("btnFill").disabled = true;
  el("steps").textContent = "";
  setNotice("正在填充…");
  const payload = {
    channelId: state.bundle.channelId,
    content: state.bundle.content,
    images: state.bundle.images,
  };
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: state.tabId },
      func: fillXhs,
      args: [payload],
    });
    renderSteps(injection?.result);
  } catch (error) {
    setNotice(String(error?.message || error), "bad");
  } finally {
    el("btnFill").disabled = false;
  }
}

function renderSteps(result) {
  const labels = { tab: "入口", title: "标题", body: "正文", images: "图片" };
  const list = el("steps");
  list.textContent = "";
  if (!result) {
    setNotice("页面没有返回结果，可能被站点脚本拦截。", "bad");
    return;
  }
  for (const step of result.steps) {
    const item = document.createElement("li");
    item.className = step.ok ? "ok" : "fail";
    item.textContent = `${labels[step.key] || step.key}：${step.detail}`;
    list.appendChild(item);
  }
  if (result.ok) setNotice("填充完成，请自行核对后再点发布。", "warn");
}

el("btnPick").addEventListener("click", pick);
el("btnReload").addEventListener("click", describe);
el("btnFill").addEventListener("click", fill);
el("btnClear").addEventListener("click", async () => {
  await clearBundleDir();
  state.handle = null;
  state.bundle = null;
  el("summary").classList.add("hidden");
  el("bundleName").textContent = "未选择";
  setNotice("已记住的目录已清除。");
  syncButtons();
});

(async () => {
  state.handle = await loadBundleDir();
  syncButtons();
  await checkTab();
  if (!state.handle) {
    // No folder yet: a bundle handed over by the app may still be waiting.
    const status = await chrome.runtime.sendMessage({ type: "bridge-status" }).catch(() => null);
    if (status?.active) await describe();
    return;
  }
  // Reading the handle is origin-wide, so a stored grant works without a new
  // gesture; anything else needs one click on 「重新读取」.
  const permission = await state.handle.queryPermission({ mode: "read" });
  if (permission === "granted") await describe();
  else setNotice("需要重新授权上次的发布包目录，点「重新读取」。", "warn");
})();
