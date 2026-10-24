const FENCE_RE = /^[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?^[ \t]*\1[ \t]*$/gm;
const CONTAINER_MARKER_RE = /^[ \t*+-]*:::+[^\n]*$/gm;
const HEADING_RE = /^[ \t]{0,3}#{1,6}[ \t]+/gm;
const BLOCKQUOTE_RE = /^[ \t]{0,3}>[ \t]?/gm;
const RULE_RE = /^[ \t]*([-_*])[ \t]*(?:\1[ \t]*){2,}$/gm;
const IMAGE_RE = /!\[[^\]]*\]\([^)]*\)/g;
const LINK_RE = /\[([^\]]*)\]\([^)\s]*(?:[ \t]+"[^"]*")?\)/g;
const HTML_TAG_RE = /<\/?[a-zA-Z][^>]*>/g;
const EMPHASIS_RE = /(\*{1,3}|_{1,3}|~~)(?=\S)([\s\S]*?\S)\1/g;
const CODE_SPAN_RE = /`([^`]*)`/g;

export function extractCopyTitle(markdown, fallback = "") {
  const lines = String(markdown || "").split(/\r?\n/);
  let insideFence = false;
  const headingByLevel = new Map();

  for (const rawLine of lines) {
    if (/^[ \t]*(`{3,}|~{3,})/.test(rawLine)) {
      insideFence = !insideFence;
      continue;
    }
    if (insideFence) continue;
    const heading = rawLine.match(/^[ \t]{0,3}(#{1,6})[ \t]+(.+?)[ \t]*#*[ \t]*$/);
    if (heading) {
      const level = heading[1].length;
      if (!headingByLevel.has(level)) headingByLevel.set(level, heading[2]);
      continue;
    }
  }

  for (const level of [1, 2, 3, 4, 5, 6]) {
    if (headingByLevel.has(level)) return cleanInline(headingByLevel.get(level));
  }
  if (fallback) return cleanInline(fallback);

  for (const line of lines) {
    if (!line.trim() || /^[ \t]*(`{3,}|~{3,})/.test(line)) continue;
    return cleanInline(line);
  }
  return "";
}

export function markdownToPlainText(markdown) {
  const text = String(markdown || "")
    .replace(FENCE_RE, "")
    .replace(CONTAINER_MARKER_RE, "")
    .replace(IMAGE_RE, "")
    .replace(HTML_TAG_RE, " ")
    .replace(LINK_RE, "$1")
    .replace(HEADING_RE, "")
    .replace(BLOCKQUOTE_RE, "")
    .replace(RULE_RE, "")
    .replace(/^[ \t]*[-*+][ \t]+/gm, "- ")
    .replace(CODE_SPAN_RE, "$1")
    .replace(EMPHASIS_RE, "$2")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return text;
}

export function extractHashtags(markdown) {
  const tags = [];
  const source = String(markdown || "").replace(FENCE_RE, "");
  const re = /(^|[^\w#])#([\p{L}\p{N}][\p{L}\p{N}_-]{0,29})/gu;
  let match = re.exec(source);
  while (match) {
    const tag = match[2].replace(/\[话题\]$/, "");
    if (tag && !tags.includes(tag)) tags.push(tag);
    match = re.exec(source);
  }
  return tags;
}

export function normalizeTagList(tags, max = 0) {
  const normalized = [];
  for (const raw of Array.isArray(tags) ? tags : []) {
    const tag = String(raw || "").replace(/^#[ \t]*/, "").replace(/[ \t]+$/, "");
    if (!tag || tag.startsWith("#")) continue;
    if (!normalized.includes(tag)) normalized.push(tag);
    if (max > 0 && normalized.length >= max) break;
  }
  return normalized;
}

export function joinTags(tags) {
  return normalizeTagList(tags).map((tag) => `#${tag}`).join(" ");
}

export function buildPublishCopy({ markdown = "", title = "", tags = null } = {}) {
  const extractedTags = Array.isArray(tags) ? tags : extractHashtags(markdown);
  return {
    title: cleanInline(String(title || "").trim()) || extractCopyTitle(markdown),
    body: markdownToPlainText(markdown),
    tags: normalizeTagList(extractedTags),
    digest: "",
  };
}

function cleanInline(value) {
  return String(value || "")
    .replace(IMAGE_RE, "")
    .replace(LINK_RE, "$1")
    .replace(CODE_SPAN_RE, "$1")
    .replace(EMPHASIS_RE, "$2")
    .replace(HTML_TAG_RE, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}
