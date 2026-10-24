const DEFAULT_BASE = "#6354f4";
const DEFAULT_ACCENT = "#f59e0b";

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function normalizeHex(value, fallback) {
  const text = String(value || "").trim();
  if (/^#[0-9a-f]{6}$/i.test(text)) return text.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(text)) {
    return `#${text.slice(1).split("").map((character) => character + character).join("")}`.toLowerCase();
  }
  return fallback;
}

function hexToRgb(hex) {
  const value = normalizeHex(hex, DEFAULT_BASE).slice(1);
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
}

function rgbToHex({ r, g, b }) {
  return `#${[r, g, b]
    .map((channel) => clamp(Math.round(channel), 0, 255).toString(16).padStart(2, "0"))
    .join("")}`;
}

function mix(left, right, amount = 0.5) {
  const a = hexToRgb(left);
  const b = hexToRgb(right);
  return rgbToHex({
    r: a.r + (b.r - a.r) * amount,
    g: a.g + (b.g - a.g) * amount,
    b: a.b + (b.b - a.b) * amount,
  });
}

function lighten(hex, amount = 0.2) {
  return mix(hex, "#ffffff", amount);
}

function darken(hex, amount = 0.2) {
  return mix(hex, "#000000", amount);
}

function alpha(hex, opacity) {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${clamp(opacity, 0, 1)})`;
}

function luminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  const channels = [r, g, b].map((channel) => {
    const value = channel / 255;
    return value <= 0.03928 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
}

function seededRandom(seed) {
  let state = (Number(seed) || 1) >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function noiseLayer(seed, opacity = 0.16) {
  const random = seededRandom(seed);
  return Array.from({ length: 7 }, () => {
    const x = Math.round(8 + random() * 84);
    const y = Math.round(8 + random() * 84);
    const size = (0.45 + random() * 0.5).toFixed(2);
    return `radial-gradient(circle at ${x}% ${y}%, rgba(15,23,42,${opacity}) 0 ${size}px, transparent ${Number(size) + 0.5}px)`;
  }).join(", ");
}

export function randomCoverSeed() {
  return Math.floor(Math.random() * 1_000_000) + 1;
}

/**
 * Deterministic CSS background generator for cover studio. Same style + seed +
 * palette always produces the same layers, so a cover series stays consistent.
 */
export function buildCoverBackground(config = {}) {
  const style = config.style || "mesh";
  const seed = Number(config.seed) || 1;
  const random = seededRandom(seed);
  const base = normalizeHex(config.baseColor, DEFAULT_BASE);
  const accent = normalizeHex(config.accentColor, DEFAULT_ACCENT);
  const softAccent = mix(accent, "#ffffff", 0.38);
  const deepBase = darken(base, 0.36);
  const lightBase = lighten(base, 0.5);
  const warm = mix(base, "#f59e0b", 0.5);
  const cool = mix(base, "#0ea5e9", 0.5);

  let background = "";
  let backgroundColor = base;
  let backgroundSize = "";
  let darkText = false;
  let textColor = "#ffffff";
  let mutedColor = "rgba(255,255,255,0.72)";

  switch (style) {
    case "gradient": {
      const angle = Math.round(110 + random() * 70);
      background = `linear-gradient(${angle}deg, ${deepBase} 0%, ${base} 38%, ${warm} 72%, ${softAccent} 100%)`;
      backgroundColor = base;
      break;
    }
    case "paper": {
      const paper = mix("#f8f1df", base, 0.08);
      background = `${noiseLayer(seed, 0.13)}, repeating-linear-gradient(0deg, transparent 0 31px, ${alpha(darken(paper, 0.16), 0.22)} 31px 32px), radial-gradient(circle at 18% 12%, ${alpha("#ffffff", 0.55)}, transparent 46%), linear-gradient(135deg, ${lighten(paper, 0.28)}, ${paper} 54%, ${darken(paper, 0.08)})`;
      backgroundColor = paper;
      darkText = true;
      break;
    }
    case "grid": {
      const paper = mix("#f8fafc", base, 0.06);
      const line = alpha(mix(base, "#0f172a", 0.55), 0.17);
      background = `linear-gradient(90deg, ${line} 1px, transparent 1px), linear-gradient(${line} 1px, transparent 1px), radial-gradient(circle at 80% 8%, ${alpha(accent, 0.18)}, transparent 42%), linear-gradient(135deg, ${lighten(paper, 0.18)}, ${paper})`;
      backgroundColor = paper;
      backgroundSize = "32px 32px, 32px 32px, auto, auto";
      darkText = true;
      break;
    }
    case "riso": {
      const paper = "#fbf5ec";
      background = `${noiseLayer(seed, 0.1)}, radial-gradient(circle at 24% 22%, ${alpha(accent, 0.62)} 0 17%, transparent 17.5%), radial-gradient(circle at 72% 38%, ${alpha(cool, 0.48)} 0 22%, transparent 22.5%), radial-gradient(circle at 44% 82%, ${alpha(base, 0.34)} 0 26%, transparent 26.5%), linear-gradient(135deg, ${paper}, ${mix(paper, accent, 0.1)})`;
      backgroundColor = paper;
      darkText = true;
      break;
    }
    case "blueprint": {
      const blueprint = "#082a52";
      background = `linear-gradient(90deg, ${alpha("#7dd3fc", 0.13)} 1px, transparent 1px), linear-gradient(${alpha("#7dd3fc", 0.13)} 1px, transparent 1px), linear-gradient(90deg, ${alpha("#7dd3fc", 0.05)} 1px, transparent 1px), linear-gradient(${alpha("#7dd3fc", 0.05)} 1px, transparent 1px), radial-gradient(circle at 76% 20%, ${alpha(accent, 0.24)}, transparent 40%), linear-gradient(135deg, #061b37, ${blueprint} 54%, #0b3b6e)`;
      backgroundColor = blueprint;
      backgroundSize = "64px 64px, 64px 64px, 16px 16px, 16px 16px, auto, auto";
      break;
    }
    case "chrome": {
      const silver = "#e2e8f0";
      background = `conic-gradient(from 220deg at 62% 34%, ${lighten(silver, 0.12)}, ${mix(base, "#cbd5e1", 0.45)}, ${lighten(accent, 0.58)}, ${darken(silver, 0.2)}, ${lighten(silver, 0.18)}), radial-gradient(circle at 24% 18%, ${alpha("#ffffff", 0.8)}, transparent 36%), linear-gradient(135deg, ${lighten(silver, 0.2)}, ${mix(silver, base, 0.22)})`;
      backgroundColor = silver;
      darkText = true;
      break;
    }
    case "noise": {
      const night = mix("#0f172a", base, 0.26);
      background = `${noiseLayer(seed, 0.22)}, radial-gradient(circle at 74% 18%, ${alpha(accent, 0.4)}, transparent 38%), radial-gradient(circle at 18% 84%, ${alpha(cool, 0.28)}, transparent 34%), linear-gradient(145deg, #050914, ${night} 62%, ${darken(base, 0.42)})`;
      backgroundColor = night;
      break;
    }
    case "mesh":
    default: {
      const points = [
        [18 + random() * 18, 12 + random() * 20],
        [58 + random() * 24, 16 + random() * 26],
        [14 + random() * 24, 62 + random() * 24],
        [58 + random() * 26, 58 + random() * 26],
      ];
      background = `${points
        .map(([x, y], index) => `radial-gradient(circle at ${x}% ${y}%, ${alpha(index % 2 ? accent : cool, 0.56)}, transparent 34%)`)
        .join(", ")}, linear-gradient(135deg, ${deepBase}, ${base} 52%, ${warm})`;
      backgroundColor = base;
      break;
    }
  }

  if (config.overlay === "dark") {
    background = `linear-gradient(180deg, rgba(2,6,23,0.12), rgba(2,6,23,0.66)), ${background}`;
  }

  if (darkText) {
    textColor = mix(darken(base, 0.62), "#111827", 0.65);
    mutedColor = alpha(mix(darken(base, 0.4), "#334155", 0.6), 0.78);
  }

  return {
    background,
    backgroundColor,
    backgroundSize,
    textColor,
    mutedColor,
    accent: darkText ? darken(accent, 0.18) : lighten(accent, 0.22),
    isDark: !darkText,
    style,
    seed,
  };
}

export function coverBackgroundSwatch(style, baseColor = DEFAULT_BASE, accentColor = DEFAULT_ACCENT) {
  const built = buildCoverBackground({ style, seed: 7, baseColor, accentColor });
  return built.background;
}
