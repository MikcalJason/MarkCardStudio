import { computed, ref, watch } from "vue";
import { PUBLISH_CHANNELS, getPublishChannel } from "../config/publishChannels.js";
import { buildPublishCopy, extractCopyTitle } from "../publish/markdownToCopy.js";
import { runPublishPreflight, summarizeReadiness } from "../publish/preflight.js";
import { buildContentSeed, sha256Text } from "../publish/contentHash.js";

/**
 * Fingerprint of what the card renderer will actually paint on a gallery page.
 * Re-decorating or switching to raw mode changes the exported pixels, so it has
 * to move the content hash even though the asset id stays the same.
 */
function galleryDecor(gallery) {
  const items = Array.isArray(gallery?.overlay) ? gallery.overlay : [];
  const parts = items.map((item) =>
    [
      item.kind,
      Math.round((Number(item.x) || 0) * 100),
      Math.round((Number(item.y) || 0) * 100),
      Math.round((Number(item.size) || 0) * 100),
      Math.round(Number(item.rotate) || 0),
      item.kind === "text" ? `${item.color}${item.weight}` : item.stickerId,
      item.kind === "text" ? item.text : "",
    ].join("~"),
  );
  // Raw mode renders no title or caption, so its typography must not move the
  // hash; otherwise a slider tweak would look like a content change.
  const type = gallery?.type || {};
  const typography =
    gallery?.mode === "raw"
      ? ""
      : [
          type.fontId || "theme",
          Math.round((Number(type.titleRatio) || 0) * 1000),
          Number(type.titleWeight) || 800,
          Math.round((Number(type.captionRatio) || 0) * 1000),
        ].join("~");
  return [
    gallery?.mode || "template",
    gallery?.fit || "cover",
    gallery?.frame || "bleed",
    gallery?.showCaptions === false ? "nocaption" : "caption",
    gallery?.showNumbers ? "number" : "",
    gallery?.background || "theme",
    gallery?.background === "theme" ? "" : String(gallery?.tint?.average || ""),
    String(gallery?.caption || ""),
    typography,
    parts.join("|"),
  ].join(":");
}

const PUBLISH_UI_KEY = "markcard_publish_ui_v1";

function readStoredChannel() {
  try {
    const raw = localStorage.getItem(PUBLISH_UI_KEY);
    if (!raw) return "";
    const parsed = JSON.parse(raw);
    return PUBLISH_CHANNELS.some((channel) => channel.id === parsed?.channelId)
      ? parsed.channelId
      : "";
  } catch {
    return "";
  }
}

function persistChannel(channelId) {
  try {
    localStorage.setItem(PUBLISH_UI_KEY, JSON.stringify({ channelId }));
  } catch {
    // Only the remembered channel is lost when storage is unavailable.
  }
}

/**
 * Turns the live document plus the work's channel variant overrides into one
 * PublishPlan. Nothing here writes files or talks to a platform.
 */
export function usePublishPlan({
  pages,
  currentWork,
  markdownSource,
  sourcePath,
  selectedPlatform,
  isDirty,
  transparentBackground,
  scale,
  upsertVariant,
  markVariantStatus,
  resetVariant,
}) {
  const channelId = ref(readStoredChannel() || PUBLISH_CHANNELS[1].id);
  const contentHash = ref("");

  const channel = computed(() => getPublishChannel(channelId.value));
  const variant = computed(() =>
    currentWork.value?.variants?.find((item) => item.channelId === channelId.value) || null,
  );
  const overrides = computed(() => variant.value?.overrides || {});

  const availablePages = computed(() =>
    (pages.value || []).map((page, index) => {
      const gallery = page?.gallery || null;
      const brokenBlock = Array.isArray(page?.blocks)
        ? page.blocks.some((block) => block?.type === "image" && (block.missing || !block.src))
        : false;
      return {
        index,
        page,
        label: page?.label || String(index + 1).padStart(2, "0"),
        title: page?.title || "",
        kind: page?.coverDesign ? "cover" : gallery ? "gallery" : "markdown",
        src: gallery?.src || page?.imageUrl || "",
        assetId: gallery ? currentWork.value?.images?.[gallery.index]?.assetId || "" : "",
        decor: gallery ? galleryDecor(gallery) : "",
        missing:
          Boolean(gallery?.missing) ||
          Boolean(gallery?.empty) ||
          brokenBlock ||
          Boolean(gallery && !gallery.src),
      };
    }),
  );

  const derivedCopy = computed(() => {
    const work = currentWork.value;
    const fallbackTitle =
      work?.copy?.title ||
      work?.title ||
      availablePages.value.find((item) => item.title)?.title ||
      extractCopyTitle(markdownSource.value);
    const copy = buildPublishCopy({
      markdown: markdownSource.value,
      title: fallbackTitle,
      tags: work?.copy?.tags?.length ? work.copy.tags : null,
    });
    return {
      ...copy,
      digest: work?.copy?.cta || "",
    };
  });

  const plan = computed(() => {
    const list = availablePages.value;
    const explicitOrder = Array.isArray(overrides.value.pageIndexes) && overrides.value.pageIndexes.length
      ? overrides.value.pageIndexes.filter((index) => list.some((item) => item.index === index))
      : null;

    let images;
    if (explicitOrder) {
      // An explicit order is authoritative: the first entry is the cover, so no
      // cover-first resort may silently undo the user's arrangement.
      images = explicitOrder.map((index) => list.find((item) => item.index === index)).filter(Boolean);
    } else {
      const all = list.map((item) => item.index);
      const coverIndex = all.includes(overrides.value.coverIndex) ? overrides.value.coverIndex : all[0];
      images = [...list].sort((left, right) => {
        if (left.index === coverIndex) return -1;
        if (right.index === coverIndex) return 1;
        return left.index - right.index;
      });
    }

    const canvas = {
      width: selectedPlatform?.value?.width || channel.value.canvas.width,
      height: selectedPlatform?.value?.height || channel.value.canvas.height,
    };

    return {
      channelId: channelId.value,
      canvas,
      content: {
        title: String(overrides.value.title || derivedCopy.value.title || "").trim(),
        body: String(
          overrides.value.body !== undefined && overrides.value.body !== ""
            ? overrides.value.body
            : derivedCopy.value.body,
        ),
        tags: Array.isArray(overrides.value.tags) && overrides.value.tags.length
          ? overrides.value.tags
          : derivedCopy.value.tags,
        digest: String(overrides.value.digest || derivedCopy.value.digest || ""),
      },
      images: images.map((item, position) => ({
        pageIndex: item.index,
        label: item.label,
        role: position === 0 ? "cover" : "content",
        kind: item.kind,
        src: item.src,
        assetId: item.assetId,
        decor: item.decor,
        missing: item.missing,
      })),
      options: {
        mode: overrides.value.mode === "publish" ? "publish" : "draft",
        format: channel.value.media.format || "PNG",
        scale: scale?.value || 2,
      },
      meta: {
        workId: currentWork.value?.id || "",
        sourcePath: sourcePath?.value || "",
        documentTitle: currentWork.value?.title || "",
      },
    };
  });

  const overflowPageCount = computed(() =>
    (pages.value || []).filter(
      (page) =>
        page?.isOverflow ||
        (Array.isArray(page?.blocks) && page.blocks.some((block) => block?.oversize)),
    ).length,
  );

  const preflight = computed(() =>
    runPublishPreflight({
      channel: channel.value,
      plan: plan.value,
      context: {
        overflowPages: overflowPageCount.value,
        transparent: Boolean(transparentBackground?.value),
        isDirty: Boolean(isDirty?.value),
      },
    }),
  );

  const readiness = computed(() => summarizeReadiness(preflight.value));
  const variants = computed(() => currentWork.value?.variants || []);

  watch(channelId, (value) => {
    persistChannel(value);
    if (!currentWork.value) return;
    upsertVariant(value, {});
  });

  watch(
    () => plan.value,
    (nextPlan) => {
      if (!nextPlan.images.length && !nextPlan.content.title) {
        contentHash.value = "";
        return;
      }
      sha256Text(buildContentSeed(nextPlan))
        .then((hash) => {
          contentHash.value = `sha256:${hash}`;
        })
        .catch(() => {
          contentHash.value = "";
        });
    },
    { immediate: true, deep: true },
  );

  function selectChannel(id) {
    if (!PUBLISH_CHANNELS.some((channelItem) => channelItem.id === id)) return;
    channelId.value = id;
  }

  function updateOverrides(patch) {
    if (!currentWork.value) return null;
    return upsertVariant(channelId.value, patch);
  }

  function markVariantReady() {
    if (!preflight.value.ready) return null;
    return markVariantStatus(channelId.value, "ready");
  }

  function markVariantPublished() {
    return markVariantStatus(channelId.value, "published");
  }

  // Clearing a channel's overrides makes it follow the work again. Omitting the
  // id resets whichever channel is currently selected.
  function resetVariantOverrides(id = channelId.value) {
    if (typeof resetVariant !== "function") return null;
    return resetVariant(id);
  }

  return {
    channel,
    channels: PUBLISH_CHANNELS,
    channelId,
    contentHash,
    derivedCopy,
    markVariantPublished,
    markVariantReady,
    plan,
    preflight,
    readiness,
    resetVariantOverrides,
    selectChannel,
    updateOverrides,
    availablePages,
    variants,
    variant,
  };
}
