<script setup>
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import AppIcon from "../AppIcon.vue";
import AssetThumbnail from "./AssetThumbnail.vue";
import { formatBytes, formatDimensions } from "../../utils/imageFiles.js";

const props = defineProps({
  asset: {
    type: Object,
    required: true,
  },
  selected: {
    type: Boolean,
    default: false,
  },
  picker: {
    type: Boolean,
    default: false,
  },
  getThumb: {
    type: Function,
    required: true,
  },
});

const emit = defineEmits(["open", "toggle", "pick"]);
const { t } = useI18n();

const usageCount = computed(() => props.asset.usage?.length || 0);
const dimensions = computed(() => formatDimensions(props.asset));

function onToggle(event) {
  event.stopPropagation();
  emit("toggle", props.asset);
}
</script>

<template>
  <article
    class="group relative flex cursor-pointer flex-col overflow-hidden rounded-xl border bg-white transition-[border-color,box-shadow] duration-150 hover:border-slate-300 hover:shadow-md focus-visible:ring-2 focus-visible:ring-blue-500/40 focus-visible:outline-none dark:bg-slate-900 dark:hover:border-slate-600"
    :class="
      selected
        ? 'border-blue-500 ring-2 ring-blue-500/20 dark:border-blue-400'
        : 'border-slate-200/90 dark:border-slate-700/80'
    "
    role="button"
    tabindex="0"
    :aria-label="asset.alt || asset.name || asset.fileName"
    @click="$emit('open', asset)"
    @dblclick="$emit('pick', asset)"
    @keydown.enter="$emit('open', asset)"
    @keydown.space.prevent="$emit('toggle', asset)"
  >
    <div class="relative aspect-[4/3] overflow-hidden">
      <AssetThumbnail :asset="asset" :get-thumb="getThumb" :alt="asset.alt || asset.name" />

      <button
        type="button"
        class="absolute left-2 top-2 z-10 grid h-6 w-6 place-items-center rounded-md border shadow-sm backdrop-blur transition cursor-pointer"
        :class="
          selected
            ? 'border-blue-500 bg-blue-600 text-white'
            : 'border-white/70 bg-white/85 text-slate-500 hover:bg-white dark:border-slate-600 dark:bg-slate-900/85 dark:text-slate-300'
        "
        :aria-label="selected ? t('assets.deselect') : t('assets.select')"
        :aria-pressed="selected"
        @click="onToggle"
      >
        <AppIcon v-if="selected" name="check" :size="13" />
      </button>

      <div class="pointer-events-none absolute inset-x-2 bottom-2 flex items-end justify-between gap-2">
        <span
          v-if="asset.ai?.generated"
          class="rounded bg-violet-600/95 px-1.5 py-0.5 text-[10px] font-bold text-white shadow-sm"
        >
          {{ t("assets.aiBadge") }}
        </span>
        <span
          v-if="usageCount"
          class="ml-auto inline-flex items-center gap-1 rounded bg-slate-900/80 px-1.5 py-0.5 text-[10px] font-bold text-white shadow-sm"
          :title="t('assets.usageCount', { count: usageCount })"
        >
          <AppIcon name="hash" :size="10" />
          {{ usageCount }}
        </span>
      </div>
    </div>

    <div class="min-w-0 px-2.5 py-2">
      <h3 class="truncate text-xs font-bold text-slate-800 dark:text-slate-100">
        {{ asset.name || asset.fileName || asset.assetId.slice(-8) }}
      </h3>
      <p class="mt-0.5 flex items-center gap-1.5 truncate text-[11px] text-slate-500 dark:text-slate-400">
        <span v-if="dimensions">{{ dimensions }}</span>
        <span v-if="dimensions">·</span>
        <span>{{ formatBytes(asset.bytes) }}</span>
      </p>
    </div>
  </article>
</template>
