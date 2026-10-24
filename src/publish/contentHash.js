async function digestHex(bytes) {
  if (!globalThis.crypto?.subtle) {
    throw new Error("SHA-256 is not available in this environment");
  }
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function sha256Text(text) {
  return digestHex(new TextEncoder().encode(String(text || "")));
}

export async function sha256Blob(blob) {
  return digestHex(await blob.arrayBuffer());
}

export function buildContentSeed(plan) {
  const images = (plan?.images || [])
    .map((image) => `${image.role}:${image.pageIndex}:${image.assetId || ""}:${image.decor || ""}`)
    .join(",");
  return [
    plan?.channelId || "",
    `${plan?.canvas?.width || 0}x${plan?.canvas?.height || 0}`,
    plan?.content?.title || "",
    plan?.content?.body || "",
    (plan?.content?.tags || []).join(","),
    images,
  ].join("\n");
}
