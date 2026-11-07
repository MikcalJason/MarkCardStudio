import { countCodePoints } from "../config/publishChannels.js";

function issue(code, severity, section, messageKey, params = {}, action = null) {
  return { code, severity, section, messageKey, params, action };
}

/**
 * Technical validation only. It never judges platform review outcomes; the UI
 * must still tell the user to confirm the destination platform's own rules.
 */
export function runPublishPreflight({ channel, plan, context = {} } = {}) {
  if (!channel || !plan) return { issues: [], ready: false, counts: emptyCounts() };

  const issues = [];
  const title = String(plan.content?.title || "");
  const body = String(plan.content?.body || "");
  const tags = Array.isArray(plan.content?.tags) ? plan.content.tags : [];
  const images = Array.isArray(plan.images) ? plan.images : [];
  const titleLength = countCodePoints(title);
  const bodyLength = countCodePoints(body);

  if (channel.limits.title.min > 0 && titleLength < channel.limits.title.min) {
    issues.push(
      issue("title-missing", "blocker", "content", "publishFlow.checks.titleMissing", {
        min: channel.limits.title.min,
      }),
    );
  }
  if (titleLength > channel.limits.title.max) {
    issues.push(
      issue(
        "title-too-long",
        "blocker",
        "content",
        "publishFlow.checks.titleTooLong",
        {
          max: channel.limits.title.max,
          actual: titleLength,
        },
        { type: "truncate-title", labelKey: "publishFlow.checklist.fixTruncate" },
      ),
    );
  }
  if (bodyLength > channel.limits.body.max) {
    issues.push(
      issue(
        "body-too-long",
        "blocker",
        "content",
        "publishFlow.checks.bodyTooLong",
        {
          max: channel.limits.body.max,
          actual: bodyLength,
        },
        { type: "truncate-body", labelKey: "publishFlow.checklist.fixTruncate" },
      ),
    );
  } else if (!bodyLength) {
    issues.push(issue("body-empty", "info", "content", "publishFlow.checks.bodyEmpty"));
  }

  if (images.length < channel.limits.images.min) {
    issues.push(
      issue("images-missing", "blocker", "images", "publishFlow.checks.imagesMissing", {
        min: channel.limits.images.min,
      }),
    );
  }
  if (images.length > channel.limits.images.max) {
    issues.push(
      issue("images-too-many", "blocker", "images", "publishFlow.checks.imagesTooMany", {
        max: channel.limits.images.max,
        actual: images.length,
      }),
    );
  }

  // Only a genuinely unresolved asset counts as broken. Markdown pages often
  // have no thumbnail, which still renders a perfectly valid card.
  const broken = images
    .map((image, index) => ({ image, number: index + 1 }))
    .filter(({ image }) => image.missing);
  for (const { number } of broken) {
    issues.push(
      issue("image-broken", "blocker", "images", "publishFlow.checks.imageBroken", { number }),
    );
  }
  if (!images.some((image) => image.role === "cover") && channel.capabilities.cover) {
    issues.push(issue("cover-missing", "info", "images", "publishFlow.checks.coverMissing"));
  }

  if (channel.limits.tags.max === 0 && tags.length > 0) {
    issues.push(issue("tags-unsupported", "info", "content", "publishFlow.checks.tagsUnsupported"));
  } else if (channel.limits.tags.max > 0 && tags.length > channel.limits.tags.max) {
    issues.push(
      issue(
        "tags-too-many",
        "warning",
        "content",
        "publishFlow.checks.tagsTooMany",
        {
          max: channel.limits.tags.max,
          actual: tags.length,
        },
        { type: "trim-tags", labelKey: "publishFlow.checklist.fixTrimTags" },
      ),
    );
  }

  const canvas = plan.canvas || { width: 0, height: 0 };
  if (canvas.width !== channel.canvas.width || canvas.height !== channel.canvas.height) {
    issues.push(
      issue(
        "canvas-mismatch",
        "warning",
        "canvas",
        "publishFlow.checks.canvasMismatch",
        {
          actual: `${canvas.width}×${canvas.height}`,
          expected: `${channel.canvas.width}×${channel.canvas.height}`,
        },
        { type: "switch-canvas", platform: { width: channel.canvas.width, height: channel.canvas.height } },
      ),
    );
  }
  if (Math.min(canvas.width, canvas.height) < channel.media.minSide) {
    issues.push(
      issue("canvas-too-small", "warning", "canvas", "publishFlow.checks.canvasTooSmall", {
        minSide: channel.media.minSide,
      }),
    );
  }

  if (context.overflowPages > 0) {
    issues.push(
      issue(
        "page-overflow",
        "warning",
        "images",
        "publishFlow.checks.pageOverflow",
        { count: context.overflowPages },
        { type: "goto-create" },
      ),
    );
  }
  if (context.transparent && String(plan.options?.format || "").toUpperCase() === "JPG") {
    issues.push(
      issue("transparent-jpg", "warning", "export", "publishFlow.checks.transparentJpg"),
    );
  }
  if (context.isDirty) {
    issues.push(issue("document-dirty", "info", "export", "publishFlow.checks.documentDirty"));
  }

  const counts = emptyCounts();
  for (const item of issues) counts[item.severity] += 1;
  return {
    issues,
    counts,
    ready: counts.blocker === 0,
    readiness: score(counts),
  };
}

export function summarizeReadiness(preflight) {
  if (!preflight) return { labelKey: "publishFlow.readiness.unknown", tone: "neutral" };
  if (!preflight.ready) return { labelKey: "publishFlow.readiness.blocked", tone: "blocker" };
  if (preflight.counts.warning > 0) return { labelKey: "publishFlow.readiness.warning", tone: "warning" };
  return { labelKey: "publishFlow.readiness.ready", tone: "ready" };
}

function emptyCounts() {
  return { blocker: 0, warning: 0, info: 0 };
}

function score(counts) {
  if (counts.blocker) return 0;
  if (counts.warning) return 0.6;
  return 1;
}
