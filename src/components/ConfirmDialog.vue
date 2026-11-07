<script setup>
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import AppIcon from "./AppIcon.vue";

const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
  title: {
    type: String,
    default: "",
  },
  description: {
    type: String,
    default: "",
  },
  confirmLabel: {
    type: String,
    default: "",
  },
  cancelLabel: {
    type: String,
    default: "",
  },
  icon: {
    type: String,
    default: "alert-circle",
  },
  tone: {
    type: String,
    default: "danger",
  },
  busy: {
    type: Boolean,
    default: false,
  },
  confirmDisabled: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(["cancel", "confirm"]);
const dialogRef = ref(null);
const cancelButtonRef = ref(null);

let previouslyFocusedElement = null;

const danger = computed(() => props.tone === "danger");

function cancel() {
  if (!props.busy) emit("cancel");
}

function confirm() {
  if (!props.busy && !props.confirmDisabled) emit("confirm");
}

function handleKeydown(event) {
  if (!props.open) return;

  if (event.key === "Escape") {
    event.preventDefault();
    cancel();
    return;
  }

  if (event.key !== "Tab") return;

  const focusableElements = Array.from(
    dialogRef.value?.querySelectorAll('button:not([disabled]), [tabindex]:not([tabindex="-1"])') || [],
  );

  if (!focusableElements.length) {
    event.preventDefault();
    dialogRef.value?.focus();
    return;
  }

  const firstElement = focusableElements[0];
  const lastElement = focusableElements[focusableElements.length - 1];

  if (event.shiftKey && document.activeElement === firstElement) {
    event.preventDefault();
    lastElement.focus();
  } else if (!event.shiftKey && document.activeElement === lastElement) {
    event.preventDefault();
    firstElement.focus();
  }
}

watch(
  () => props.open,
  async (isOpen) => {
    if (isOpen) {
      previouslyFocusedElement = document.activeElement;
      await nextTick();
      cancelButtonRef.value?.focus();
      return;
    }

    await nextTick();
    previouslyFocusedElement?.focus?.();
    previouslyFocusedElement = null;
  },
);

onMounted(() => {
  window.addEventListener("keydown", handleKeydown);
});

onBeforeUnmount(() => {
  window.removeEventListener("keydown", handleKeydown);
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-system grid place-items-center bg-slate-950/45 p-4 backdrop-blur-sm"
      @mousedown.self="cancel"
    >
      <section
        ref="dialogRef"
        class="w-[min(420px,calc(100vw-2rem))] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900"
        role="alertdialog"
        aria-modal="true"
        tabindex="-1"
      >
        <div class="flex items-start gap-3.5 px-5 pb-4 pt-5">
          <span
            class="grid h-10 w-10 shrink-0 place-items-center rounded-lg"
            :class="danger
              ? 'bg-red-50 text-red-600 dark:bg-red-950/60 dark:text-red-300'
              : 'bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-300'"
          >
            <AppIcon :name="icon" :size="19" />
          </span>
          <div class="min-w-0 pt-0.5">
            <h2 class="text-base font-bold text-slate-900 dark:text-slate-100">{{ title }}</h2>
            <p v-if="description" class="mt-1.5 text-sm leading-6 text-slate-600 dark:text-slate-400">
              {{ description }}
            </p>
            <slot />
          </div>
        </div>

        <footer class="flex justify-end gap-2 border-t border-slate-200 bg-slate-50 px-5 py-3.5 dark:border-slate-800 dark:bg-slate-950/50">
          <button
            ref="cancelButtonRef"
            type="button"
            class="h-9 rounded-lg border border-slate-300 bg-white px-4 text-sm font-semibold text-slate-700 transition-colors hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200 dark:hover:bg-slate-800"
            :disabled="busy"
            @click="cancel"
          >
            {{ cancelLabel }}
          </button>
          <button
            type="button"
            class="inline-flex h-9 items-center gap-2 rounded-lg px-4 text-sm font-semibold text-white transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed disabled:opacity-60"
            :class="danger
              ? 'bg-red-600 hover:bg-red-700 focus-visible:outline-red-500'
              : 'bg-blue-600 hover:bg-blue-700 focus-visible:outline-blue-500'"
            :disabled="busy || confirmDisabled"
            @click="confirm"
          >
            <AppIcon v-if="busy" name="loader" :size="15" class="animate-spin" />
            <span>{{ confirmLabel }}</span>
          </button>
        </footer>
      </section>
    </div>
  </Teleport>
</template>
