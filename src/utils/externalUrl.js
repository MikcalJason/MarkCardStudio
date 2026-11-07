import { invoke } from "@tauri-apps/api/core";

function isTauriRuntime() {
  return typeof window !== "undefined" && Boolean(window.__TAURI_INTERNALS__);
}

/**
 * Opens an external page for the user.
 *
 * `preferChrome` is for creator studios that only work with the companion
 * Chrome extension installed; the desktop shell then tries Chrome first and
 * falls back to the default browser. Browser mode just opens a new tab.
 *
 * Returns the browser that handled the URL, or null when nothing opened.
 */
export async function openExternalUrl(url, { preferChrome = false } = {}) {
  if (!url) return null;

  if (!isTauriRuntime()) {
    window.open(url, "_blank", "noopener,noreferrer");
    return "browser-tab";
  }

  try {
    const result = await invoke("open_external_url", { url, preferChrome });
    if (result?.opened) return result.browser || "default";
  } catch (error) {
    console.error("Failed to open external URL:", error);
  }

  const { openUrl } = await import("@tauri-apps/plugin-opener");
  await openUrl(url);
  return "default";
}
