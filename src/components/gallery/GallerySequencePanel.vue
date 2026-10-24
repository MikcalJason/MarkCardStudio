<script setup>
import { computed, ref } from "vue";
import { useI18n } from "vue-i18n";
import AppIcon from "../AppIcon.vue";
import AssetThumbnail from "../assets/AssetThumbnail.vue";
import CoverDesignArtwork from "../cover/CoverDesignArtwork.vue";

const props = defineProps({
  work: {
    type: Object,
    default: null,
  },
  activeIndex: {
    type: Number,
    default: 0,
  },
  coverActive: {
    type: Boolean,
    default: false,
  },
  getThumb: {
    type: Function,
    required: true,
  },
  isDesktop: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits([
  "add-images",
  "remove-image",
  "move-image",
  "set-cover",
  "select-image",
  "open-cover-studio",
  "remove-cover",
]);

const { t } = useI18n();
const draggingIndex = ref(-1);
const dragOverIndex = ref(-1);

const images = computed(() => props.work?.images || []);
const coverDesign = computed(() => props.work?.coverDesign || null);
const coverAssetId = computed(() =>
  coverDesign.value ? "" : props.work?.cover?.assetId || images.value[0]?.assetId || "",
);

function onDragStart(event, index) {
  draggingIndex.value = index;
  event.dataTransfer.effectAllowed = "move";
  event.dataTransfer.setData("text/plain", String(index));
}

function onDragOver(event, index) {
  event.preventDefault();
  dragOverIndex.value = index;
  event.dataTransfer.dropEffect = "move";
}

function onDrop(event, index) {
  event.preventDefault();
  const fromIndex = Number(event.dataTransfer.getData("text/plain"));
  if (Number.isFinite(fromIndex) && fromIndex !== index) {
    emit("move-image", { fromIndex, toIndex: index });
  }
  draggingIndex.value = -1;
  dragOverIndex.value = -1;
}

function onDragEnd() {
  draggingIndex.value = -1;
  dragOverIndex.value = -1;
}
</script>

<template>
  <section class="panel-surface flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl">
    <header class="shrink-0 border-b border-slate-200/80 px-4 py-3 dark:border-slate-800">
      <div class="flex items-center justify-between gap-2">
        <div class="flex min-w-0 items-center gap-2">
          <span class="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-blue-50 text-blue-600 dark:bg-blue-950/50 dark:text-blue-300">
            <AppIcon name="layout-grid" :size="14" />
          </span>
          <div class="min-w-0">
            <h2 class="truncate text-sm font-bold dark:text-slate-100">{{ t("gallery.title") }}</h2>
            <p class="truncate text-[11px] text-slate-500 dark:text-slate-400">
              {{ t("gallery.count", { count: images.length }) }}
            </p>
          </div>
        </div>
        <button
          type="button"
          class="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-blue-600 px-2.5 text-xs font-bold text-white hover:bg-blue-700"
          @click="$emit('add-images')"
        >
          <AppIcon name="image-plus" :size="14" />
          <span class="hidden sm:inline">{{ t("gallery.add") }}</span>
        </button>
      </div>
      <p class="mt-2 text-[11px] leading-5 text-slate-500 dark:text-slate-400">
        {{ t("gallery.sequenceHint") }}
      </p>
    </header>

    <div class="min-h-0 flex-1 overflow-y-auto p-2.5">
      <div class="relative mb-2">
        <div
          class="flex w-full items-center gap-2.5 rounded-xl border bg-white/80 p-2 text-left transition dark:bg-slate-900/60"
          :class="[
            coverActive
              ? 'border-blue-400 ring-1 ring-blue-500/15 dark:border-blue-500/70'
              : 'border-slate-200/90 dark:border-slate-700/80',
            coverDesign ? 'cursor-pointer hover:border-blue-300 hover:bg-blue-50/40 dark:hover:border-blue-500/60 dark:hover:bg-blue-950/20' : '',
          ]"
          @click="coverDesign && $emit('open-cover-studio')"
        >
        <div class="relative h-20 w-16 shrink-0 overflow-hidden rounded-lg border border-slate-200/80 bg-slate-900 dark:border-slate-700/80">
          <CoverDesignArtwork v-if="coverDesign" :design="coverDesign" compact />
          <AssetThumbnail
            v-else-if="images[0]"
            :asset="{ assetId: images[0].assetId, alt: images[0].alt, name: images[0].caption }"
            :get-thumb="getThumb"
            :alt="images[0].alt || images[0].caption"
          />
          <div v-else class="flex h-full flex-col items-center justify-center gap-1 bg-[radial-gradient(circle_at_30%_20%,#818cf8,transparent_60%),linear-gradient(135deg,#312e81,#0f172a)] text-white/70">
            <AppIcon name="layout-grid" :size="16" />
          </div>
        </div>
        <span class="min-w-0 flex-1">
          <span class="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-600 dark:bg-amber-950/50 dark:text-amber-300">
            {{ t("gallery.cover") }}
          </span>
          <strong v-if="coverDesign" class="mt-1 block truncate text-[11px] font-bold text-slate-700 dark:text-slate-200">
            {{ coverDesign.title }}
          </strong>
          <span v-else class="mt-1 block truncate text-[11px] text-slate-500 dark:text-slate-400">
            {{ images.length ? t("gallery.firstImageCover") : t("gallery.noCover") }}
          </span>
          <span
            v-if="coverDesign"
            class="mt-0.5 block text-[10px] font-semibold text-blue-600 dark:text-blue-300"
          >
            {{ t("gallery.openCoverStudio") }} →
          </span>
        </span>
        </div>
        <button
          v-if="coverDesign"
          type="button"
          class="absolute right-1.5 top-1.5 z-10 grid h-6 w-6 place-items-center rounded-md bg-white/90 text-slate-400 shadow-sm hover:bg-rose-50 hover:text-rose-600 dark:bg-slate-800/90 dark:hover:bg-rose-950/50 dark:hover:text-rose-300"
          :aria-label="t('gallery.removeCover')"
          :title="t('gallery.removeCover')"
          @click.stop="$emit('remove-cover')"
        >
          <AppIcon name="trash-2" :size="12" />
        </button>
      </div>

      <div v-if="!images.length" class="flex h-full flex-col items-center justify-center px-4 py-10 text-center">
        <span class="grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500">
          <AppIcon name="image-plus" :size="22" />
        </span>
        <h3 class="mt-3 text-xs font-bold text-slate-700 dark:text-slate-200">{{ t("gallery.emptyTitle") }}</h3>
        <p class="mt-1 max-w-[220px] text-[11px] leading-5 text-slate-500 dark:text-slate-400">
          {{ t("gallery.emptyDesc") }}
        </p>
        <button
          type="button"
          class="mt-3 inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          @click="$emit('add-images')"
        >
          <AppIcon name="image" :size="13" />
          {{ t("gallery.openLibrary") }}
        </button>
      </div>

      <ol v-else class="space-y-2">
        <li
          v-for="(image, index) in images"
          :key="image.id"
          draggable="true"
          class="group flex gap-2.5 rounded-xl border bg-white/80 p-2 transition dark:bg-slate-900/60"
          :class="[
            activeIndex === index
              ? 'border-blue-400 ring-1 ring-blue-500/15 dark:border-blue-500/70'
              : 'border-slate-200/90 dark:border-slate-700/80',
            draggingIndex === index ? 'opacity-50' : '',
            dragOverIndex === index && draggingIndex !== index ? 'border-dashed border-blue-500' : '',
          ]"
          @click="$emit('select-image', index)"
          @dragstart="onDragStart($event, index)"
          @dragover="onDragOver($event, index)"
          @drop="onDrop($event, index)"
          @dragend="onDragEnd"
        >
          <span class="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded bg-slate-100 text-[10px] font-bold text-slate-500 dark:bg-slate-800 dark:text-slate-400">
            {{ String(index + 1).padStart(2, "0") }}
          </span>

          <div class="h-16 w-12 shrink-0 overflow-hidden rounded-lg border border-slate-200/80 dark:border-slate-700/80">
            <AssetThumbnail
              :asset="{ assetId: image.assetId, alt: image.alt, name: image.caption }"
              :get-thumb="getThumb"
              :alt="image.alt || image.caption"
            />
          </div>

          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-1.5">
              <span
                v-if="coverAssetId === image.assetId"
                class="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-600 dark:bg-amber-950/50 dark:text-amber-300"
              >
                {{ t("gallery.cover") }}
              </span>
              <span
                v-if="image.overlay?.items?.length"
                class="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                :title="t('overlay.title')"
              >
                <AppIcon name="sparkles" :size="10" class="inline-block align-[-1px]" />
              </span>
              <span class="truncate text-[10px] text-slate-500 dark:text-slate-400">
                {{ image.assetId.slice(-8) }}
              </span>
              <button
                v-if="!coverDesign"
                type="button"
                class="ml-auto grid h-6 w-6 shrink-0 place-items-center rounded text-slate-400 opacity-0 transition hover:bg-slate-100 hover:text-slate-700 group-hover:opacity-100 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                :title="t('gallery.setCover')"
                :aria-label="t('gallery.setCover')"
                @click.stop="$emit('set-cover', image)"
              >
                <AppIcon name="check" :size="12" />
              </button>
            </div>
            <div class="mt-1 flex items-center justify-end gap-0.5">
              <button
                type="button"
                class="grid h-6 w-6 place-items-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                :disabled="index === 0"
                :title="t('gallery.moveUp')"
                @click.stop="$emit('move-image', { fromIndex: index, toIndex: index - 1 })"
              >
                <AppIcon name="arrow-up" :size="12" />
              </button>
              <button
                type="button"
                class="grid h-6 w-6 place-items-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700 disabled:opacity-30 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                :disabled="index === images.length - 1"
                :title="t('gallery.moveDown')"
                @click.stop="$emit('move-image', { fromIndex: index, toIndex: index + 1 })"
              >
                <AppIcon name="arrow-down" :size="12" />
              </button>
              <button
                type="button"
                class="grid h-6 w-6 place-items-center rounded text-slate-400 hover:bg-rose-50 hover:text-rose-600 dark:hover:bg-rose-950/40 dark:hover:text-rose-300"
                :title="t('gallery.remove')"
                @click.stop="$emit('remove-image', image)"
              >
                <AppIcon name="trash-2" :size="12" />
              </button>
              <span class="ml-1 cursor-grab text-slate-300 dark:text-slate-600" :title="t('gallery.dragHint')">
                <AppIcon name="grip-vertical" :size="12" />
              </span>
            </div>
          </div>
        </li>
      </ol>
    </div>

    <footer class="shrink-0 border-t border-slate-200/80 px-4 py-2 text-[10px] text-slate-400 dark:border-slate-800 dark:text-slate-500">
      {{ isDesktop ? t("gallery.projectMirrorHint") : t("gallery.browserHint") }}
    </footer>
  </section>
</template>
