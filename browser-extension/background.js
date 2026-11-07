import { loadBundleDir } from "./storage.js";
import { XHS_CHANNEL_ID, fillXhs } from "./adapters/xhs.js";

// Bundle-relative image paths are the only thing this extension will ever read
// out of a folder, so a crafted manifest cannot point it elsewhere.
const IMAGE_FILE_RE = /^images\/[A-Za-z0-9._-]+\.(jpe?g|png)$/i;
const MIME_BY_EXT = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png" };

// The desktop app serves the bundle it just wrote over a loopback bridge, and
// hands its address to the creator page in the URL fragment. That is what makes
// "one click" possible: no folder picker, no repeated directory grant. The
// address lives in session storage (never disk) and expires with the app's own
// 30-minute TTL.
const BRIDGE_KEY = "markcardBridge";
const BRIDGE_URL_RE = /^http:\/\/127\.0\.0\.1:\d{2,5}\/[A-Za-z0-9]{4,64}$/;
const BRIDGE_MAX_AGE_MS = 45 * 60 * 1000;

async function readBridge() {
  let stored;
  try {
    stored = await chrome.storage.session.get(BRIDGE_KEY);
  } catch {
    return null;
  }
  const entry = stored?.[BRIDGE_KEY];
  if (!entry?.url || !BRIDGE_URL_RE.test(entry.url)) return null;
  if (Date.now() - Number(entry.savedAt || 0) > BRIDGE_MAX_AGE_MS) {
    await forgetBridge();
    return null;
  }
  return entry;
}

async function rememberBridge(rawUrl) {
  const url = String(rawUrl || "").trim().replace(/\/+$/, "");
  if (!BRIDGE_URL_RE.test(url)) {
    throw new Error("本地桥接地址无效，请回应用重新打开创作平台。");
  }
  const entry = { url, savedAt: Date.now() };
  await chrome.storage.session.set({ [BRIDGE_KEY]: entry });
  return entry;
}

async function forgetBridge() {
  try {
    await chrome.storage.session.remove(BRIDGE_KEY);
  } catch {
    // session storage is unavailable in some profiles; the TTL still guards it.
  }
}

async function fetchManifest(base) {
  let response;
  try {
    response = await fetch(`${base}/manifest.json`, { cache: "no-store" });
  } catch {
    throw new Error("连不上本地桥接：应用可能已关闭或已超时，请回应用重新生成发布包。");
  }
  if (!response.ok) {
    throw new Error(`本地桥接返回 ${response.status}，请回应用重新生成发布包。`);
  }
  const manifest = await response.json();
  if (manifest.generator !== "markcard-studio") {
    throw new Error("这个地址返回的不是 MarkCard Studio 的发布包。");
  }
  return manifest;
}

async function openBundleDir() {
  const dir = await loadBundleDir();
  if (!dir) throw new Error("还没有选择发布包目录。");
  // After a browser restart the stored handle can drop its grant, and reading it
  // then fails with a generic NotAllowedError — say what to click instead.
  if ((await dir.queryPermission({ mode: "read" })) !== "granted") {
    throw new Error("目录授权已失效，点「重新读取」再授权一次。");
  }
  let manifestHandle;
  try {
    manifestHandle = await dir.getFileHandle("manifest.json");
  } catch {
    throw new Error("这一层没有 manifest.json：请选发布包目录本身（里面有 manifest.json 和 images/）。");
  }
  const manifest = JSON.parse(await (await manifestHandle.getFile()).text());
  if (manifest.generator !== "markcard-studio") {
    throw new Error("这个目录里的 manifest.json 不是 MarkCard Studio 生成的发布包。");
  }
  return { kind: "directory", dir, manifest };
}

/**
 * Prefers the app's bridge and falls back to a previously granted folder when
 * the bridge is gone (app closed, TTL elapsed), so a stopped bridge never
 * masks a bundle the user already picked.
 */
async function openBundle() {
  const bridge = await readBridge();
  if (bridge) {
    try {
      const manifest = await fetchManifest(bridge.url);
      return { kind: "bridge", base: bridge.url, manifest };
    } catch (error) {
      await forgetBridge();
      const dir = await loadBundleDir();
      if (!dir) throw error;
    }
  }
  return openBundleDir();
}

function describe(bundle) {
  const manifest = bundle.manifest;
  const channelId = manifest.channel?.id || "";
  return {
    source: bundle.kind,
    channelId,
    supported: channelId === XHS_CHANNEL_ID,
    canvas: manifest.channel?.canvas || null,
    count: (manifest.images || []).length,
    content: {
      title: manifest.content?.title || "",
      body: manifest.content?.body || "",
      tags: manifest.content?.tags || [],
    },
    images: (manifest.images || []).map((image, index) => ({
      index,
      file: image.file,
      role: image.role || "",
      bytes: image.bytes || 0,
      width: image.width || 0,
      height: image.height || 0,
    })),
    createdAt: manifest.createdAt || "",
    ready: manifest.checks?.ready !== false,
  };
}

function toBase64(bytes) {
  let binary = "";
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return btoa(binary);
}

async function readBundleImage(bundle, index) {
  const position = Number(index);
  const image = (bundle.manifest.images || [])[position];
  if (!image) throw new Error(`发布包里没有第 ${position + 1} 张图。`);
  if (!IMAGE_FILE_RE.test(image.file)) throw new Error(`非法的图片路径 ${image.file}`);

  const name = image.file.split("/")[1];
  const mime = MIME_BY_EXT[name.split(".").pop().toLowerCase()];
  if (!mime) throw new Error(`不支持的图片格式 ${name}`);

  if (bundle.kind === "bridge") {
    const response = await fetch(`${bundle.base}/${image.file}`, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`第 ${position + 1} 张读取失败：本地桥接返回 ${response.status}`);
    }
    return {
      name,
      mime,
      base64: toBase64(new Uint8Array(await response.arrayBuffer())),
    };
  }

  let imagesDir;
  try {
    imagesDir = await bundle.dir.getDirectoryHandle("images");
  } catch {
    throw new Error("发布包里没有 images/ 目录，请重新生成一次。");
  }
  let handle;
  try {
    handle = await imagesDir.getFileHandle(name);
  } catch {
    throw new Error(`images/${name} 不在包里，可能上次生成被中断了。`);
  }
  const file = await handle.getFile();
  return {
    name: file.name,
    mime,
    base64: toBase64(new Uint8Array(await file.arrayBuffer())),
  };
}

async function fillInto(tabId) {
  const bundle = await openBundle();
  const info = describe(bundle);
  if (!info.supported) {
    throw new Error(
      `这个发布包是 ${info.channelId || "未知"} 渠道生成的，扩展只填小红书。请回应用用「小红书图文」重新生成一次。`,
    );
  }
  const payload = {
    channelId: info.channelId,
    content: info.content,
    images: info.images,
  };
  const [injection] = await chrome.scripting.executeScript({
    target: { tabId },
    func: fillXhs,
    args: [payload],
  });
  return { bundle: info, result: injection?.result };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const type = message?.type;

  if (type === "describe") {
    openBundle()
      .then((bundle) => sendResponse({ ok: true, bundle: describe(bundle) }))
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }

  if (type === "image") {
    openBundle()
      .then(async (bundle) => {
        const image = await readBundleImage(bundle, message.index);
        sendResponse({ ok: true, ...image });
      })
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }

  if (type === "bridge-set") {
    rememberBridge(message.url)
      .then(() => openBundle())
      .then((bundle) => sendResponse({ ok: true, bundle: describe(bundle) }))
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }

  if (type === "bridge-clear") {
    forgetBridge().then(() => sendResponse({ ok: true }));
    return true;
  }

  if (type === "bridge-status") {
    readBridge()
      .then((entry) => sendResponse({ ok: true, active: Boolean(entry) }))
      .catch(() => sendResponse({ ok: true, active: false }));
    return true;
  }

  if (type === "fill") {
    const tabId = sender?.tab?.id;
    if (!tabId) {
      sendResponse({ ok: false, error: "没有可填充的标签页。" });
      return false;
    }
    fillInto(tabId)
      .then((outcome) => sendResponse({ ok: true, ...outcome }))
      .catch((error) => sendResponse({ ok: false, error: String(error?.message || error) }));
    return true;
  }

  return false;
});
