// Channel limits mirror current platform behaviour, not permanent facts.
// Keep them here so the UI and the preflight checks read one source of truth.

export const PUBLISH_CHANNELS = [
  {
    id: "wechat-newspic",
    labelKey: "publishFlow.channels.wechat",
    mode: "api",
    icon: "message-square",
    canvas: { width: 1080, height: 1440 },
    ratio: "3:4",
    limits: {
      images: { min: 1, max: 20 },
      title: { min: 1, max: 20 },
      body: { min: 0, max: 1000 },
      tags: { max: 10 },
    },
    media: { format: "JPG", maxBytes: 10 * 1024 * 1024, minSide: 320 },
    capabilities: { draft: true, publish: true, schedule: false, tags: true, cover: true },
    externalUrl: "https://mp.weixin.qq.com/",
  },
  {
    id: "xhs-note",
    labelKey: "publishFlow.channels.xhs",
    mode: "assist",
    icon: "heart-handshake",
    canvas: { width: 1080, height: 1440 },
    ratio: "3:4",
    limits: {
      images: { min: 1, max: 18 },
      title: { min: 1, max: 20 },
      body: { min: 0, max: 1000 },
      tags: { max: 10 },
    },
    media: { format: "JPG", maxBytes: 32 * 1024 * 1024, minSide: 720 },
    capabilities: { draft: false, publish: false, schedule: false, tags: true, cover: true },
    externalUrl: "https://creator.xiaohongshu.com/publish/publish?from=tab_switch&target=image",
    // The fill extension only runs in Chrome, so this page must open there to be useful.
    openInChrome: true,
  },
  {
    id: "local-bundle",
    labelKey: "publishFlow.channels.bundle",
    mode: "bundle",
    icon: "folder-down",
    canvas: { width: 1080, height: 1440 },
    ratio: "3:4",
    limits: {
      images: { min: 1, max: 99 },
      title: { min: 0, max: 200 },
      body: { min: 0, max: 20000 },
      tags: { max: 100 },
    },
    media: { format: "PNG", maxBytes: 0, minSide: 0 },
    capabilities: { draft: false, publish: false, schedule: false, tags: true, cover: true },
    externalUrl: "",
  },
];

export const TAG_SUGGESTIONS = [
  "Markdown",
  "效率工具",
  "读书笔记",
  "自媒体",
  "设计灵感",
  "周末去哪儿",
];

export function getPublishChannel(channelId) {
  return PUBLISH_CHANNELS.find((channel) => channel.id === channelId) || PUBLISH_CHANNELS[2];
}

export function countCodePoints(value) {
  return Array.from(String(value || "")).length;
}
