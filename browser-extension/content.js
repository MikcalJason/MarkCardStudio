// Runs on the Xiaohongshu creator page. The desktop app opens this page with
// `#markcard_bridge=<loopback address>`, so the extension can pull the finished
// bundle and fill the note with no folder picker and no second click.
//
// Same hard boundary as the adapter: it fills fields and injects files. It
// never presses 发布, never reads cookies, tokens, or page storage.
(() => {
  const HASH_KEY = "markcard_bridge";
  const HOST_ID = "markcard-publish-assistant";
  const BRIDGE_URL_RE = /^http:\/\/127\.0\.0\.1:\d{2,5}\/[A-Za-z0-9]{4,64}$/;
  const WAIT_TIMEOUT_MS = 25000;
  const POLL_MS = 500;

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  let bundle = null;
  let busy = false;
  let autoAttempted = false;
  let lastBridgeUrl = "";

  function readBridgeUrl() {
    const params = new URLSearchParams(location.hash.replace(/^#/, ""));
    const value = params.get(HASH_KEY) || "";
    return BRIDGE_URL_RE.test(value) ? value : "";
  }

  function shadow() {
    const existing = document.getElementById(HOST_ID);
    if (existing?.shadowRoot) return existing.shadowRoot;
    const host = document.createElement("div");
    host.id = HOST_ID;
    host.style.cssText = "position:fixed;right:16px;bottom:16px;z-index:2147483646;";
    const root = host.attachShadow({ mode: "open" });
    root.innerHTML = `
      <style>
        .card { width: 264px; padding: 12px; border: 1px solid rgba(15,23,42,.12); border-radius: 14px;
          background: #fff; color: #0f172a; font: 12px/1.6 -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif;
          box-shadow: 0 10px 30px rgba(15,23,42,.18); }
        .head { display: flex; align-items: center; gap: 6px; font-weight: 700; }
        .dot { width: 8px; height: 8px; border-radius: 50%; background: #2563eb; flex: 0 0 auto; }
        .close { margin-left: auto; height: 20px; padding: 0 2px; border: 0; background: transparent;
          color: #94a3b8; font: inherit; cursor: pointer; }
        .row { display: flex; gap: 6px; margin-top: 6px; color: #64748b; }
        .row span { flex: 0 0 34px; }
        .row b { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; color: #0f172a; font-weight: 600; }
        .status { margin: 8px 0 0; padding: 6px 8px; border-radius: 8px; background: #f1f5f9; color: #475569; line-height: 1.5; }
        .status.warn { background: #fffbeb; color: #92400e; }
        .status.bad { background: #fef2f2; color: #b91c1c; }
        .actions { display: flex; gap: 6px; margin-top: 10px; }
        button.primary { height: 28px; padding: 0 12px; border: 1px solid transparent; border-radius: 8px;
          background: #2563eb; color: #fff; font: inherit; font-weight: 600; cursor: pointer; }
        button.primary:disabled { opacity: .45; cursor: not-allowed; }
        .steps { margin: 8px 0 0; padding: 0; list-style: none; display: grid; gap: 3px; max-height: 132px; overflow: auto; }
        .steps li { padding: 4px 6px; border-radius: 6px; background: #f1f5f9; color: #475569; word-break: break-all; }
        .steps li.ok::before { content: "✓ "; color: #15803d; }
        .steps li.fail::before { content: "✕ "; color: #b91c1c; }
        .note { margin: 8px 0 0; color: #94a3b8; line-height: 1.5; }
        .hidden { display: none; }
      </style>
      <div class="card" role="dialog" aria-label="MarkCard 发布助手">
        <div class="head"><span class="dot"></span><span>MarkCard 发布包</span><button class="close" type="button" title="关闭">✕</button></div>
        <div class="row"><span>标题</span><b data-field="title">-</b></div>
        <div class="row"><span>图片</span><b data-field="count">-</b></div>
        <p class="status" data-field="status">正在读取发布包…</p>
        <ol class="steps hidden" data-field="steps"></ol>
        <div class="actions"><button class="primary" type="button" data-action="fill" disabled>填充</button></div>
        <p class="note">只填标题、正文和图片，不会替你点发布；素材从本机读取，不上传到任何服务器。</p>
      </div>
    `;
    root.querySelector(".close").addEventListener("click", () => host.remove());
    root.querySelector('[data-action="fill"]').addEventListener("click", () => runFill());
    document.documentElement.appendChild(host);
    return root;
  }

  function field(name) {
    return shadow()?.querySelector(`[data-field="${name}"]`) || null;
  }

  function setStatus(text, kind) {
    const node = field("status");
    if (!node) return;
    node.textContent = text;
    node.className = `status${kind ? ` ${kind}` : ""}`;
  }

  function setFillEnabled(enabled) {
    const button = shadow()?.querySelector('[data-action="fill"]');
    if (button) button.disabled = !enabled || busy;
  }

  function renderSummary() {
    if (!bundle) return;
    const title = field("title");
    const count = field("count");
    if (title) title.textContent = bundle.content?.title || "（无标题）";
    if (count) count.textContent = `${bundle.count} 张`;
    setFillEnabled(true);
  }

  function renderSteps(result) {
    const list = field("steps");
    if (!list) return;
    list.textContent = "";
    const labels = { tab: "入口", title: "标题", body: "正文", images: "图片" };
    const steps = result?.steps || [];
    if (!steps.length) {
      list.classList.add("hidden");
      return;
    }
    for (const step of steps) {
      const item = document.createElement("li");
      item.className = step.ok ? "ok" : "fail";
      item.textContent = `${labels[step.key] || step.key}：${step.detail}`;
      list.appendChild(item);
    }
    list.classList.remove("hidden");
  }

  function imageInputs() {
    return [...document.querySelectorAll('input[type="file"]')].filter(
      (node) => !node.accept || /image|jpe?g|png/i.test(node.accept),
    );
  }

  function hasEditor() {
    return [...document.querySelectorAll('[contenteditable="true"]')].some(
      (node) => node.getBoundingClientRect().width >= 240,
    );
  }

  function findClickableByText(pattern) {
    return (
      [...document.querySelectorAll("button, a, div, span, li")].find((node) => {
        if (node.children.length) return false;
        if (!pattern.test((node.textContent || "").trim())) return false;
        const rect = node.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      }) || null
    );
  }

  function clickElement(node) {
    const options = { bubbles: true, cancelable: true, view: window };
    try {
      node.dispatchEvent(new PointerEvent("pointerdown", options));
    } catch {
      // The mouse sequence below is enough on engines without PointerEvent.
    }
    node.dispatchEvent(new MouseEvent("mousedown", options));
    node.dispatchEvent(new MouseEvent("mouseup", options));
    node.dispatchEvent(new MouseEvent("click", options));
  }

  /**
   * The studio opens on 上传视频 and only mounts the image uploader after its
   * 上传图文 tab is active. Clicking it here saves the "upload a throwaway photo,
   * then delete it" dance. An existing editor means the user is already there,
   * so nothing is clicked and no in-progress upload is reset.
   */
  async function activateImageTab() {
    if (hasEditor()) return;
    const tab = findClickableByText(/上传图[文片]/);
    if (!tab) return;
    clickElement(tab);
    await sleep(600);
  }

  /**
   * Waits for the image uploader rather than the title/body editor: on this
   * site the fields only mount after the note has images, and the adapter
   * injects those first.
   */
  async function waitForUploader() {
    const started = Date.now();
    await activateImageTab();
    while (Date.now() - started < WAIT_TIMEOUT_MS) {
      if (imageInputs().length || hasEditor()) return true;
      await sleep(POLL_MS);
    }
    return false;
  }

  async function runFill() {
    if (busy || !bundle) return;
    busy = true;
    setFillEnabled(false);
    setStatus("正在填充…");
    try {
      const response = await chrome.runtime.sendMessage({ type: "fill" });
      if (!response?.ok) {
        setStatus(response?.error || "填充失败。", "bad");
        return;
      }
      renderSteps(response.result);
      if (response.result?.ok) {
        setStatus("填充完成，请核对内容后自己点发布。", "warn");
      } else {
        setStatus("有字段没填上，原因见下面。可重试或手动补。", "bad");
      }
    } catch (error) {
      setStatus(String(error?.message || error), "bad");
    } finally {
      busy = false;
      setFillEnabled(true);
    }
  }

  async function autoFill() {
    if (autoAttempted) return;
    autoAttempted = true;
    setStatus("等待小红书编辑器就绪…");
    const ready = await waitForUploader();
    if (!ready) {
      setStatus("没等到图片上传控件：请手动点「上传图文」，再点填充。", "warn");
      return;
    }
    // The site mounts the editor in stages; a short delay keeps the paste and
    // the file injection from landing on a half-built form.
    await sleep(800);
    await runFill();
  }

  async function boot() {
    const url = readBridgeUrl();
    if (!url || url === lastBridgeUrl) return;
    lastBridgeUrl = url;
    autoAttempted = false;
    shadow();
    setStatus("正在读取发布包…");
    setFillEnabled(false);
    const response = await chrome.runtime.sendMessage({ type: "bridge-set", url });
    if (!response?.ok) {
      setStatus(response?.error || "读取发布包失败。", "bad");
      return;
    }
    bundle = response.bundle;
    renderSummary();
    if (!bundle.supported) {
      setStatus(
        `这个发布包是 ${bundle.channelId || "未知"} 渠道生成的，扩展只填小红书。请回应用用「小红书图文」重新生成。`,
        "bad",
      );
      setFillEnabled(false);
      return;
    }
    if (!bundle.ready) setStatus("发布包的校验里有阻塞项，填充前请先回应用处理。", "warn");
    await autoFill();
  }

  // A hash-only navigation does not reload the page, so follow it explicitly.
  window.addEventListener("hashchange", () => {
    if (readBridgeUrl() && readBridgeUrl() !== lastBridgeUrl) boot();
  });

  boot().catch(() => {
    // The panel above already reports the failure; nothing else to do here.
  });
})();
