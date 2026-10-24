<script setup>
import { useI18n } from "vue-i18n";
import AppIcon from "./AppIcon.vue";
import { isWorkspaceVisible } from "../config/uiFlags.js";

const props = defineProps({
  modelValue: {
    type: String,
    default: "create",
  },
});

const emit = defineEmits(["update:modelValue"]);
const { t } = useI18n();

const workspaces = [
  { id: "create", labelKey: "workspace.create", icon: "file-text" },
  { id: "publish", labelKey: "workspace.publish", icon: "upload" },
  { id: "assets", labelKey: "workspace.assets", icon: "image" },
  { id: "ops", labelKey: "workspace.ops", icon: "bar-chart-3" },
].filter((workspace) => isWorkspaceVisible(workspace.id));

function selectWorkspace(id) {
  if (id !== props.modelValue) emit("update:modelValue", id);
}
</script>

<template>
  <div
    class="inline-flex items-center gap-0.5 rounded-xl border border-slate-200/90 bg-white p-1 dark:border-slate-700/80 dark:bg-slate-800/80"
    role="tablist"
    :aria-label="t('workspace.switcher')"
  >
    <button
      v-for="workspace in workspaces"
      :key="workspace.id"
      type="button"
      role="tab"
      class="inline-flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-semibold transition-all duration-150 cursor-pointer"
      :class="
        workspace.id === modelValue
          ? 'bg-blue-600 text-white shadow-sm dark:bg-blue-500 dark:text-white'
          : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
      "
      :aria-selected="workspace.id === modelValue"
      :aria-label="t(workspace.labelKey)"
      @click="selectWorkspace(workspace.id)"
    >
      <AppIcon :name="workspace.icon" :size="13" />
      <span class="hidden sm:inline">{{ t(workspace.labelKey) }}</span>
    </button>
  </div>
</template>
