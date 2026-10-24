<script setup>
import { useI18n } from "vue-i18n";
import AppIcon from "../AppIcon.vue";

defineProps({
  rows: {
    type: Array,
    default: () => [],
  },
  activeKey: {
    type: String,
    default: "",
  },
  collapsed: {
    type: Object,
    default: () => ({}),
  },
});

defineEmits(["select", "toggle"]);

const { t } = useI18n();
</script>

<template>
  <ul v-if="rows.length" class="mt-0.5">
    <li
      v-for="row in rows"
      :key="row.key"
      class="relative flex items-center gap-0.5"
      :style="{ paddingLeft: `${row.depth * 12}px` }"
    >
      <span
        v-if="row.depth"
        aria-hidden="true"
        class="pointer-events-none absolute inset-y-1 border-l border-slate-200/80 dark:border-slate-700/70"
        :style="{ left: `${(row.depth - 1) * 12 + 9}px` }"
      ></span>
      <button
        v-if="row.hasChildren"
        type="button"
        class="grid h-7 w-6 shrink-0 place-items-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
        :aria-label="t('assets.toggleFolder')"
        :aria-expanded="!collapsed[row.key]"
        @click="$emit('toggle', row.key)"
      >
        <AppIcon :name="collapsed[row.key] ? 'chevron-right' : 'chevron-down'" :size="12" />
      </button>
      <span v-else class="w-6 shrink-0"></span>
      <button
        type="button"
        class="flex min-h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md px-1.5 text-xs transition-colors"
        :class="activeKey === row.key
          ? 'bg-blue-50 font-semibold text-blue-700 dark:bg-blue-950/40 dark:text-blue-300'
          : 'font-medium text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800'"
        :title="row.key"
        :aria-current="activeKey === row.key ? 'true' : undefined"
        @click="$emit('select', row.key)"
      >
        <AppIcon
          name="folder-open"
          :size="13"
          class="shrink-0"
          :class="activeKey === row.key ? 'text-blue-500 dark:text-blue-300' : 'text-slate-400'"
        />
        <span class="truncate">{{ row.label }}</span>
        <span
          class="ml-auto shrink-0 text-[10px] font-semibold tabular-nums"
          :class="activeKey === row.key ? 'text-blue-600/80 dark:text-blue-300/80' : 'text-slate-500'"
        >{{ row.count }}</span>
      </button>
    </li>
  </ul>
</template>
