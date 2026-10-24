<script setup>
import { computed } from "vue";
import { useI18n } from "vue-i18n";
import AppIcon from "../AppIcon.vue";

const props = defineProps({
  preflight: {
    type: Object,
    required: true,
  },
});

const emit = defineEmits(["apply-action"]);

const { t } = useI18n();

const toneBySeverity = {
  blocker: {
    icon: "circle-alert",
    wrap: "border-rose-200/80 bg-rose-50/70 dark:border-rose-900/70 dark:bg-rose-950/40",
    text: "text-rose-600 dark:text-rose-300",
    labelKey: "publishFlow.severity.blocker",
  },
  warning: {
    icon: "alert-circle",
    wrap: "border-amber-200/80 bg-amber-50/70 dark:border-amber-900/70 dark:bg-amber-950/40",
    text: "text-amber-600 dark:text-amber-300",
    labelKey: "publishFlow.severity.warning",
  },
  info: {
    icon: "info",
    wrap: "border-slate-200/80 bg-slate-50/70 dark:border-slate-700/80 dark:bg-slate-800/50",
    text: "text-slate-500 dark:text-slate-400",
    labelKey: "publishFlow.severity.info",
  },
};

const issues = computed(() => props.preflight?.issues || []);
const counts = computed(
  () => props.preflight?.counts || { blocker: 0, warning: 0, info: 0 },
);
</script>

<template>
  <div class="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
    <div
      v-if="!issues.length"
      class="flex items-center gap-2 rounded-xl border border-emerald-200/80 bg-emerald-50/70 px-3 py-2.5 text-xs font-semibold text-emerald-700 dark:border-emerald-900/70 dark:bg-emerald-950/40 dark:text-emerald-300"
    >
      <AppIcon name="check-circle" :size="15" />
      <span>{{ t("publishFlow.checklist.allClear") }}</span>
    </div>

    <div
      v-for="(issue, index) in issues"
      :key="`${issue.code}-${index}`"
      class="rounded-xl border px-3 py-2.5"
      :class="toneBySeverity[issue.severity]?.wrap"
    >
      <div class="flex items-start gap-2.5">
        <AppIcon
          :name="toneBySeverity[issue.severity]?.icon"
          :size="15"
          class="mt-0.5 shrink-0"
          :class="toneBySeverity[issue.severity]?.text"
        />
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-1.5">
            <span
              class="rounded-full px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide"
              :class="toneBySeverity[issue.severity]?.text"
            >
              {{ t(toneBySeverity[issue.severity]?.labelKey) }}
            </span>
            <span class="text-[10px] font-semibold text-slate-500 dark:text-slate-400">
              {{ t(`publishFlow.sections.${issue.section}`) }}
            </span>
          </div>
          <p class="mt-1 text-[12px] leading-5 text-slate-600 dark:text-slate-300">
            {{ t(issue.messageKey, issue.params) }}
          </p>
        </div>
        <button
          v-if="issue.action"
          type="button"
          class="shrink-0 rounded-lg border border-slate-200/90 px-2 py-1 text-[11px] font-semibold text-slate-600 transition hover:border-blue-300 hover:text-blue-600 dark:border-slate-700 dark:text-slate-300 dark:hover:text-blue-300"
          @click="emit('apply-action', issue)"
        >
          {{ t("publishFlow.checklist.fix") }}
        </button>
      </div>
    </div>

    <div
      v-if="issues.length"
      class="mt-1 flex shrink-0 items-center gap-3 px-1 text-[11px] font-semibold text-slate-500 dark:text-slate-400"
    >
      <span class="text-rose-600 dark:text-rose-300">
        {{ t("publishFlow.checklist.blockerCount", { count: counts.blocker }) }}
      </span>
      <span class="text-amber-600 dark:text-amber-300">
        {{ t("publishFlow.checklist.warningCount", { count: counts.warning }) }}
      </span>
      <span>{{ t("publishFlow.checklist.infoCount", { count: counts.info }) }}</span>
    </div>
  </div>
</template>
