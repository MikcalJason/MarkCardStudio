<script setup>
import { computed } from "vue";
import { getCoverTemplate } from "../../config/coverTemplates.js";
import { buildCoverBackground } from "../../utils/coverBackgrounds.js";

const props = defineProps({
  design: {
    type: Object,
    required: true,
  },
  showSafeArea: {
    type: Boolean,
    default: false,
  },
  compact: {
    type: Boolean,
    default: false,
  },
});

const template = computed(() => getCoverTemplate(props.design?.templateId));
const layout = computed(() => ({
  align: "left",
  font: "sans",
  titleScale: 0.14,
  padding: 0.08,
  safeArea: 0.06,
  overlay: 0.1,
  ...(props.design?.layout || {}),
}));
const background = computed(() => buildCoverBackground(props.design?.background || {}));

const rootStyle = computed(() => {
  const titleScale = Math.max(0.08, Math.min(0.2, Number(layout.value.titleScale) || 0.14));
  return {
    background: background.value.background,
    backgroundColor: background.value.backgroundColor,
    backgroundSize: background.value.backgroundSize || "auto",
    color: layout.value.textColor || background.value.textColor,
    "--cover-accent": layout.value.accentColor || background.value.accent,
    "--cover-muted": background.value.mutedColor,
    "--cover-padding": `${Math.round((Number(layout.value.padding) || 0.08) * 1000) / 10}%`,
    "--cover-safe": `${Math.round((Number(layout.value.safeArea) || 0.06) * 1000) / 10}%`,
    "--cover-title-size": `${Math.round(titleScale * 1000) / 10}cqw`,
    "--cover-overlay": String(Math.max(0, Math.min(0.9, Number(layout.value.overlay) || 0))),
  };
});

const alignClass = computed(() => `cover-design--align-${layout.value.align === "center" ? "center" : "left"}`);
const fontClass = computed(() => {
  if (layout.value.font === "serif") return "cover-design--font-serif";
  if (layout.value.font === "mono") return "cover-design--font-mono";
  if (layout.value.font === "display") return "cover-design--font-display";
  return "cover-design--font-sans";
});
</script>

<template>
  <div
    class="cover-design"
    :class="[template.className, alignClass, fontClass, { 'cover-design--compact': compact }]"
    :style="rootStyle"
    role="img"
    :aria-label="design.title"
  >
    <div class="cover-design__overlay"></div>
    <div class="cover-design__grain"></div>
    <div class="cover-design__ornament cover-design__ornament--one"></div>
    <div class="cover-design__ornament cover-design__ornament--two"></div>

    <div class="cover-design__content">
      <div class="cover-design__top">
        <span class="cover-design__kicker">{{ design.kicker }}</span>
        <span v-if="design.meta" class="cover-design__meta">{{ design.meta }}</span>
      </div>

      <div class="cover-design__main">
        <span class="cover-design__index">01</span>
        <h1 class="cover-design__title">{{ design.title }}</h1>
        <p v-if="design.subtitle" class="cover-design__subtitle">{{ design.subtitle }}</p>
      </div>

      <div class="cover-design__bottom">
        <span class="cover-design__brand">{{ design.brand }}</span>
        <span class="cover-design__line"></span>
        <span class="cover-design__edition">{{ design.meta || "MARKCARD" }}</span>
      </div>
    </div>

    <div v-if="showSafeArea" class="cover-design__safe-area">
      <span>SAFE AREA</span>
    </div>
  </div>
</template>
