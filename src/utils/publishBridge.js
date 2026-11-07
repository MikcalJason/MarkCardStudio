// The companion Chrome extension reads this hash on the creator page and pulls
// the bundle from the desktop app's loopback bridge. A fragment never reaches
// the platform's server, so the bridge token stays local.
export const PUBLISH_BRIDGE_HASH_KEY = "markcard_bridge";

export function withBridgeHash(url, bridgeUrl) {
  if (!url || !bridgeUrl) return url;
  const target = new URL(url);
  const params = new URLSearchParams(target.hash.replace(/^#/, ""));
  params.set(PUBLISH_BRIDGE_HASH_KEY, bridgeUrl);
  target.hash = params.toString();
  return target.toString();
}

export function bridgeMinutesLeft(expiresAt) {
  const remaining = Number(expiresAt) - Date.now();
  if (!Number.isFinite(remaining) || remaining <= 0) return 0;
  // Round up so a live bridge never reads as "0 minutes left".
  return Math.max(1, Math.ceil(remaining / 60000));
}
