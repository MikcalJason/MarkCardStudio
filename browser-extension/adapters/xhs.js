// The channel id this adapter serves, read from the bundle's manifest so a
// bundle built for another channel can never be pushed into this page.
export const XHS_CHANNEL_ID = "xhs-note";

// Everything platform-specific lives in this one function, because
// chrome.scripting.executeScript serializes only the function source: no import,
// no module constant, no closure can reach the page. When 小红书 ships a new DOM,
// this file is the only thing to fix.
//
// Hard boundary: this adapter fills fields and injects files. It never submits,
// never clicks 发布, and never reads cookies, tokens, or page storage.
export async function fillXhs(payload) {
  const S = {
    // A title box is whatever the site labels 标题, or the one short-text box
    // whose own maxLength matches the note-title scale.
    titlePlaceholder: /标题|title/i,
    titleMaxLength: [8, 32],
    bodyEditor: '[contenteditable="true"]',
    imageInput: 'input[type="file"]',
    // The studio opens on 上传视频, and the image upload control only exists on
    // 上传图文. Clicking that tab is the difference between "works immediately"
    // and "upload a throwaway photo first".
    imageTabLabel: /上传图[文片]/,
    minEditorWidth: 240,
    // The site queues its own uploads, so sequential injection needs a gap.
    injectGapMs: 1500,
    tabWaitMs: 6000,
    fieldWaitMs: 8000,
    pollMs: 300,
  };

  const steps = [];
  const record = (key, ok, detail) => {
    steps.push({ key, ok, detail });
    return ok;
  };

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  function visible(el) {
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function setNativeValue(el, value) {
    // A controlled <input> ignores `el.value = ...`: React keeps its own state,
    // so the value has to go through the prototype setter plus an input event.
    const proto =
      el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(el, String(value));
    else el.value = String(value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function imageInputs() {
    return [...document.querySelectorAll(S.imageInput)].filter(
      (el) => !el.accept || /image|jpe?g|png/i.test(el.accept),
    );
  }

  async function findImageInput(timeoutMs) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      const input = imageInputs()[0];
      if (input) return input;
      await sleep(S.pollMs);
    }
    return null;
  }

  async function waitForBodyEditor(timeoutMs) {
    const started = Date.now();
    while (Date.now() - started < timeoutMs) {
      if (findBodyEditor()) return true;
      await sleep(S.pollMs);
    }
    return false;
  }

  function findClickableByText(pattern) {
    const nodes = [...document.querySelectorAll("button, a, div, span, li")];
    return (
      nodes.find((el) => {
        if (el.children.length) return false;
        if (!pattern.test((el.textContent || "").trim())) return false;
        return visible(el);
      }) || null
    );
  }

  function clickElement(el) {
    const options = { bubbles: true, cancelable: true, view: window };
    // Tab switches on this site listen for pointer events, not just click.
    try {
      el.dispatchEvent(new PointerEvent("pointerdown", options));
    } catch {
      // Very old engines: the mouse sequence below still fires.
    }
    el.dispatchEvent(new MouseEvent("mousedown", options));
    el.dispatchEvent(new MouseEvent("mouseup", options));
    el.dispatchEvent(new MouseEvent("click", options));
  }

  function findTitleField() {
    const boxes = [...document.querySelectorAll('input[type="text"], input:not([type]), textarea')];
    return (
      boxes.find((el) => S.titlePlaceholder.test(el.placeholder || el.getAttribute("aria-label") || "")) ||
      boxes.find(
        (el) =>
          el.maxLength >= S.titleMaxLength[0] &&
          el.maxLength <= S.titleMaxLength[1] &&
          el.getBoundingClientRect().width > 120,
      ) ||
      null
    );
  }

  function findBodyEditor() {
    const area = (el) => {
      const rect = el.getBoundingClientRect();
      return rect.width * rect.height;
    };
    const editors = [...document.querySelectorAll(S.bodyEditor)].filter(
      (el) => el.getBoundingClientRect().width >= S.minEditorWidth,
    );
    if (!editors.length) return null;
    return editors.sort((a, b) => area(b) - area(a))[0];
  }

  /**
   * Moves the studio from its default 上传视频 tab to 上传图文. The editor is
   * the signal that the image page is already open, so a note the user is
   * filling by hand is never reset.
   */
  async function ensureImageTab() {
    if (findBodyEditor()) {
      return record("tab", true, "已经在图文上传页。");
    }
    const tab = findClickableByText(S.imageTabLabel);
    if (tab) clickElement(tab);
    const input = await findImageInput(S.tabWaitMs);
    if (input || findBodyEditor()) {
      return record("tab", true, tab ? "已切到「上传图文」。" : "已经在图文上传页。");
    }
    return record(
      "tab",
      false,
      tab ? "点了「上传图文」但没等到图片上传控件。" : "没找到「上传图文」入口：请手动切到图文页再点填充。",
    );
  }

  function base64ToFile(index) {
    return chrome.runtime.sendMessage({ type: "image", index }).then((res) => {
      if (!res?.ok) throw new Error(res?.error || `第 ${index + 1} 张读取失败`);
      const binary = atob(res.base64);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
      return new File([bytes], res.name, { type: res.mime });
    });
  }

  async function injectImages(images) {
    if (!images.length) {
      return record("images", false, "发布包里没有图片。");
    }
    const input = await findImageInput(S.tabWaitMs);
    if (!input) {
      return record("images", false, "页面上没有图片上传控件：请先走到「上传图文」的图片步骤。");
    }
    // One at a time: 18 base64 payloads at once would hold the whole bundle in
    // memory and make the service worker re-read the manifest per request.
    const files = [];
    try {
      for (let index = 0; index < images.length; index += 1) {
        files.push(await base64ToFile(index));
      }
    } catch (error) {
      return record("images", false, String(error?.message || error));
    }

    if (input.multiple) {
      const transfer = new DataTransfer();
      files.forEach((file) => transfer.items.add(file));
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      return record("images", true, `一次注入 ${files.length} 张（控件支持多选）。`);
    }

    for (let index = 0; index < files.length; index += 1) {
      const transfer = new DataTransfer();
      transfer.items.add(files[index]);
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
      if (index < files.length - 1) await sleep(S.injectGapMs);
    }
    return record(
      "images",
      true,
      `逐张注入 ${files.length} 张，每张间隔 ${S.injectGapMs}ms（控件不支持多选）。`,
    );
  }

  const content = payload?.content || {};
  const tags = (content.tags || []).map((tag) => `#${String(tag).replace(/^#/, "")}`).join(" ");
  const bodyText = [content.body || "", tags].filter(Boolean).join("\n\n");

  // 1. Enter the image publishing tab. 2. Push the files first, because the
  // studio only mounts the title and body fields once the note has content.
  await ensureImageTab();
  await injectImages(payload?.images || []);
  await waitForBodyEditor(S.fieldWaitMs);

  const titleField = findTitleField();
  if (titleField) {
    setNativeValue(titleField, content.title || "");
    record("title", true, `已填「${content.title || ""}」`);
  } else {
    record("title", false, "没找到标题输入框。");
  }

  const editor = findBodyEditor();
  if (editor) {
    editor.focus();
    const transfer = new DataTransfer();
    transfer.setData("text/plain", bodyText);
    // Rich-text editors own their state, so writing innerText is ignored; a paste
    // event they can intercept is the path that actually lands.
    const unhandled = editor.dispatchEvent(
      new ClipboardEvent("paste", { bubbles: true, cancelable: true, clipboardData: transfer }),
    );
    if (unhandled) document.execCommand("insertText", false, bodyText);
    record(
      "body",
      true,
      `${unhandled ? "execCommand" : "paste"} 写入 ${bodyText.length} 字；话题以纯文本带入，需在编辑器里重新点选才成为真话题。`,
    );
  } else {
    record("body", false, "没找到正文编辑器（contenteditable）。");
  }

  return {
    ok: steps.every((step) => step.ok),
    steps,
    channel: payload?.channelId || "",
    count: (payload?.images || []).length,
  };
}
