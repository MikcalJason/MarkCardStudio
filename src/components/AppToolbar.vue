<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useI18n } from "vue-i18n";
import AppIcon from "./AppIcon.vue";
import AppIconButton from "./AppIconButton.vue";
import AppToolbarButton from "./AppToolbarButton.vue";
import { isCreationModeVisible } from "../config/uiFlags.js";

const props = defineProps({
  selectedTheme: {
    type: String,
    required: true,
  },
  isDarkMode: {
    type: Boolean,
    default: false,
  },
  canUndo: {
    type: Boolean,
    default: false,
  },
  canRedo: {
    type: Boolean,
    default: false,
  },
  isExporting: {
    type: Boolean,
    default: false,
  },
  exportAction: {
    type: String,
    default: "",
  },
  activeWorkspace: {
    type: String,
    default: "create",
  },
  creationMode: {
    type: String,
    default: "write",
  },
});

const emit = defineEmits([
  "export",
  "new-document",
  "open-markdown",
  "save-markdown",
  "open-settings",
  "select-theme",
  "toggle-dark-mode",
  "undo",
  "redo",
  "select-creation-mode",
  "open-asset-library",
  "open-sticker-picker",
]);

import { THEME_LIST } from "../config/themes.js";

const themes = THEME_LIST;
const isDocumentExporting = computed(
  () => props.isExporting && props.exportAction === "document",
);
const { t } = useI18n();

const creationModes = [
  { id: "write", labelKey: "workspace.write", icon: "file-text" },
  { id: "gallery", labelKey: "workspace.gallery", icon: "layout-grid" },
  { id: "poster", labelKey: "workspace.poster", icon: "image" },
].filter((mode) => isCreationModeVisible(mode.id));
const isThemeOpen = ref(false);
const themeDropdownRef = ref(null);

function handleClickOutside(event) {
  if (themeDropdownRef.value && !themeDropdownRef.value.contains(event.target)) {
    isThemeOpen.value = false;
  }
}

function getThemeLabel(theme) {
  return t(`themes.${theme.id}.name`);
}

function getThemeDescription(theme) {
  return t(`themes.${theme.id}.description`);
}

function getSelectedThemeLabel() {
  const theme = themes.find((item) => item.name === props.selectedTheme);
  return theme ? getThemeLabel(theme) : props.selectedTheme;
}

onMounted(() => {
  document.addEventListener("click", handleClickOutside);
});

onBeforeUnmount(() => {
  document.removeEventListener("click", handleClickOutside);
});
</script>

<template>
  <nav
    class="relative z-30 shrink-0 border-b border-t border-slate-200/70 bg-white/88 px-4 py-2 backdrop-blur-[18px] dark:border-slate-800/80 dark:bg-slate-900/90"
    :aria-label="t('toolbar.label')">
    <div class="flex items-center gap-3">
      <!-- Left Toolbar Section: Document Actions + Undo/Redo -->
      <div v-if="activeWorkspace === 'create'" class="inline-flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
        <AppToolbarButton compact :title="t('toolbar.new')" :aria-label="t('toolbar.new')" @click="$emit('new-document')">
          <AppIcon name="file-plus-2" :size="16" />
          <span class="hidden 2xl:inline">{{ t("toolbar.new") }}</span>
        </AppToolbarButton>
        <AppToolbarButton compact :title="t('toolbar.openDocument')" :aria-label="t('toolbar.openDocument')"
          @click="$emit('open-markdown')">
          <AppIcon name="folder-open" :size="16" />
          <span class="hidden 2xl:inline">{{ t("toolbar.open") }}</span>
        </AppToolbarButton>
        <AppToolbarButton compact :title="t('toolbar.save')" :aria-label="t('toolbar.save')" @click="$emit('save-markdown')">
          <AppIcon name="save" :size="16" />
          <span class="hidden 2xl:inline">{{ t("toolbar.save") }}</span>
        </AppToolbarButton>

        <div class="h-4 w-px bg-slate-200/80 dark:bg-slate-800 mx-1"></div>

        <!-- Undo & Redo -->
        <AppIconButton :disabled="!canUndo" :aria-label="t('toolbar.undo')" :title="t('toolbar.undo')"
          @click="$emit('undo')">
          <AppIcon name="undo" :size="16" />
        </AppIconButton>
        <AppIconButton :disabled="!canRedo" :aria-label="t('toolbar.redo')" :title="t('toolbar.redo')"
          @click="$emit('redo')">
          <AppIcon name="redo" :size="16" />
        </AppIconButton>
      </div>

      <div v-if="activeWorkspace === 'create'" class="hidden items-center gap-0.5 rounded-lg border border-slate-200/80 bg-white p-0.5 dark:border-slate-700/80 dark:bg-slate-800/80 sm:inline-flex">
        <button
          v-for="mode in creationModes"
          :key="mode.id"
          type="button"
          class="inline-flex h-7 items-center gap-1 rounded-md px-2 text-[12px] font-semibold transition-colors duration-150 cursor-pointer"
          :class="
            creationMode === mode.id
              ? 'bg-blue-600 text-white shadow-sm dark:bg-blue-500 dark:text-white'
              : 'text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200'
          "
          :aria-pressed="creationMode === mode.id"
          :aria-label="t(mode.labelKey)"
          :title="t(mode.labelKey)"
          @click="$emit('select-creation-mode', mode.id)"
        >
          <AppIcon :name="mode.icon" :size="12" />
          <span class="hidden xl:inline">{{ t(mode.labelKey) }}</span>
        </button>
      </div>

      <div v-else class="inline-flex items-center gap-2 text-xs font-semibold text-slate-500 dark:text-slate-400">
        <AppIcon :name="activeWorkspace === 'publish' ? 'upload' : 'bar-chart-3'" :size="15" />
        <span>{{ t(activeWorkspace === 'publish' ? 'workspace.publishTitle' : 'workspace.opsTitle') }}</span>
      </div>

      <!-- Right Toolbar Section: Theme Dropdown, System Dark Mode, Settings & Primary Export -->
      <div class="inline-flex min-w-0 flex-1 items-center justify-end gap-2.5">
        <!-- Card Theme Dropdown Selector -->
        <div v-if="activeWorkspace === 'create' && creationMode !== 'gallery'" class="relative hidden lg:block" ref="themeDropdownRef">
          <button type="button"
            class="flex h-8.5 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-700 shadow-2xs hover:bg-slate-50 transition font-medium dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700/80 cursor-pointer"
            @click="isThemeOpen = !isThemeOpen">
            <span class="text-slate-500 font-normal dark:text-slate-400">{{ t("toolbar.theme") }}:</span>
            <span class="font-bold text-slate-800 dark:text-slate-100">{{ getSelectedThemeLabel() }}</span>
            <AppIcon name="chevron-down" :size="13"
              class="text-slate-400 dark:text-slate-400 ml-0.5 transition-transform duration-200"
              :class="isThemeOpen ? 'rotate-180' : ''" />
          </button>

          <!-- Theme Dropdown Popover List -->
          <div v-if="isThemeOpen"
            class="absolute right-0 top-full mt-1.5 z-50 w-64 max-h-[70vh] overflow-y-auto rounded-xl border border-slate-200/90 bg-white p-1.5 shadow-xl animate-in fade-in zoom-in-95 duration-150 dark:border-slate-700/90 dark:bg-slate-800 dark:text-slate-100">
            <button v-for="themeItem in themes" :key="themeItem.id" type="button"
              :title="getThemeDescription(themeItem)"
              class="group flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-xs text-left transition font-medium cursor-pointer"
              :class="themeItem.name === selectedTheme ? '!bg-blue-50 !text-blue-600 dark:!bg-blue-950/60 dark:!text-blue-400 font-bold' : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700/70'"
              @click="emit('select-theme', themeItem.name); isThemeOpen = false">
              <!-- Theme Color Dot / Gradient Indicator -->
              <span class="h-3.5 w-3.5 shrink-0 rounded-full border border-black/10 shadow-2xs"
                :style="{ background: themeItem.bgGradient || themeItem.color }"></span>
              <div class="flex flex-col flex-1 min-w-0">
                <span class="truncate leading-tight">{{ getThemeLabel(themeItem) }}</span>
                <span :title="getThemeDescription(themeItem)"
                  class="text-[10px] text-slate-500 dark:text-slate-400 truncate group-hover:whitespace-normal group-hover:line-clamp-none mt-0.5 text-[11px] font-normal leading-snug">{{
                    getThemeDescription(themeItem) }}</span>
              </div>
              <AppIcon v-if="themeItem.name === selectedTheme" name="check" :size="13"
                class="text-blue-600 dark:text-blue-400 shrink-0" />
            </button>
          </div>
        </div>

        <!-- Vertical Divider -->
        <div v-if="activeWorkspace === 'create'" class="h-4.5 w-px bg-slate-200/80 dark:bg-slate-800 mx-0.5"></div>

        <!-- System Dark/Light Mode Switch Toggle -->
        <button type="button"
          class="relative hidden h-7.5 w-12 items-center rounded-full p-0.5 transition-colors border border-slate-200/80 cursor-pointer xl:flex"
          :class="isDarkMode ? '!bg-slate-800 !border-slate-700' : '!bg-slate-100'"
          :aria-label="t('toolbar.appearance')" :title="t('toolbar.appearance')" @click="$emit('toggle-dark-mode')">
          <div
            class="flex h-6 w-6 items-center justify-center rounded-full bg-white shadow-xs transition-transform duration-200"
            :class="isDarkMode ? 'translate-x-4.5 !bg-slate-900 !text-amber-400' : 'translate-x-0 !text-blue-600'">
            <AppIcon :name="isDarkMode ? 'moon' : 'sun'" :size="13" />
          </div>
        </button>

        <AppIconButton v-if="creationMode !== 'gallery'" :aria-label="t('openmoji.title')" :title="t('openmoji.title')" @click="$emit('open-sticker-picker')">
          <AppIcon name="smile" :size="16" />
        </AppIconButton>

        <AppIconButton :aria-label="t('assets.title')" :title="t('assets.title')" @click="$emit('open-asset-library')">
          <AppIcon name="image" :size="16" />
        </AppIconButton>

        <!-- Primary Export Button (Matching Screenshot) -->
        <button v-if="activeWorkspace === 'create' && creationMode !== 'poster'" type="button"
          class="inline-flex h-8.5 items-center rounded-lg !bg-blue-600 hover:!bg-blue-700 disabled:opacity-70 disabled:cursor-not-allowed px-3 text-xs font-bold !text-white shadow-xs active:scale-98 transition group cursor-pointer"
          :aria-label="t('toolbar.exportTitle')"
          :title="t('toolbar.exportTitle')"
          :disabled="isExporting"
          @click="$emit('export')">
          <AppIcon :name="isDocumentExporting ? 'loader' : 'download'" :size="15" class="mr-1.5" :class="{ 'animate-spin': isDocumentExporting }" />
          <span class="hidden xl:inline">{{ isDocumentExporting ? t("toolbar.exporting") : t("toolbar.export") }}</span>
        </button>
      </div>
    </div>
  </nav>
</template>
