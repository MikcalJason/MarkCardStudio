<script setup>
import AppIcon from "../AppIcon.vue";

defineProps({
  modelValue: {
    type: String,
    default: "",
  },
  options: {
    type: Array,
    required: true,
  },
  ariaLabel: {
    type: String,
    default: "",
  },
});

defineEmits(["update:modelValue"]);
</script>

<template>
  <label class="relative inline-flex items-center">
    <select
      :value="modelValue"
      class="h-8 w-full cursor-pointer appearance-none rounded-lg border border-slate-200 bg-white pl-2.5 pr-7 text-xs font-medium text-slate-600 outline-none transition-colors hover:border-slate-300 focus:border-blue-400 focus:ring-2 focus:ring-blue-500/15 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-slate-600"
      :aria-label="ariaLabel"
      @change="$emit('update:modelValue', $event.target.value)"
    >
      <option v-for="option in options" :key="option.value" :value="option.value">
        {{ option.label }}
      </option>
    </select>
    <AppIcon name="chevron-down" :size="13" class="pointer-events-none absolute right-2 text-slate-400" />
  </label>
</template>
