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
  // Gallery images only persist an assetId, so the original file name is read
  // back from the asset library instead of being copied into the work.
  getAssetName: {
    type: Function,
    default: null,
  },
  isDesktop: {
    type: Boolean,
    default: false,
  },
  sceneThumbs: {
    type: Object,
    default: () => ({}),
  },
  sceneActive: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits([
  "add-images",
  "remove-image",
  "move-image",
  "sort-images",
  "select-image",
  "open-cover-studio",
  "remove-cover",
  "calibrate-image",
]);

const { t, locale } = useI18n();
const draggingIndex = ref(-1);
const dragOverIndex = ref(-1);

const images = computed(() => props.work?.images || []);
const coverDesign = computed(() => props.work?.coverDesign || null);

function imageLabel(image) {
  const name = props.getAssetName?.(image.assetId) || "";
  if (name) return name;
  return image.assetId.replace(/^sha256:/, "").slice(-8);
}

// Sorting consumes the same label each row shows, so the order always matches
// what the user read. Ties keep their current order because sort is stable.
function compareLabels(left, right) {
  return String(left).localeCompare(String(right), locale.value, {
    numeric: true,
    caseFirst: "lower",
  });
}

function idsSortedByLabel(descending) {
  const sign = descending ? -1 : 1;
  const keyed = images.value.map((image) => ({
    id: image.id,
    label: imageLabel(image),
  }));
  return keyed
    .slice()
    .sort((left, right) => sign * compareLabels(left.label, right.label))
    .map((item) => item.id);
}

const ascIds = computed(() => idsSortedByLabel(false));
const descIds = computed(() => idsSortedByLabel(true));

const activeSort = computed(() => {
  if (images.value.length < 2) return "";
  const current = images.value.map((image) => image.id).join("|");
  if (current === ascIds.value.join("|")) return "asc";
  if (current === descIds.value.join("|")) return "desc";
  return "";
});

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
        <div class="flex shrink-0 items-center gap-1">
          <!-- Name sorting is a one-off reorder, not a view mode: the sequence is
               what publishes, so the new order has to be the work's own order. -->
          <button
            type="button"
            class="grid h-8 w-8 place-items-center rounded-lg border transition disabled:opacity-40"
            :class="
              activeSort === 'asc'
                ? 'border-blue-400 bg-blue-50 text-blue-600 dark:border-blue-500/70 dark:bg-blue-950/50 dark:text-blue-300'
                : 'border-slate-200/90 text-slate-500 hover:bg-slate-50 hover:text-slate-700 dark:border-slate-700/80 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200'
            "
            :disabled="images.length < 2"
            :aria-pressed="activeSort === 'asc'"
            :aria-label="t('gallery.sortByNameAsc')"
            :title="t('gallery.sortByNameAsc')"
            @click="$emit('sort-images', ascIds)"
          >
            <AppIcon name="arrow-up-narrow-wide" :size="14" />
          </button>
          <button
            type="button"
            class="grid h-8 w-8 place-items-center rounded-lg border transition disabled:opacity-40"
            :class="
              activeSort === 'desc'
                ? 'border-blue-400 bg-blue-50 text-blue-600 dark:border-blue-500/70 dark:bg-blue-950/50 dark:text-blue-300'
                : 'border-slate-200/90 text-slate-500 hover:bg-slate-50 hover:text-slate-700 dark:border-slate-700/80 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-200'
            "
            :disabled="images.length < 2"
            :aria-pressed="activeSort === 'desc'"
            :aria-label="t('gallery.sortByNameDesc')"
            :title="t('gallery.sortByNameDesc')"
            @click="$emit('sort-images', descIds)"
          >
            <AppIcon name="arrow-down-wide-narrow" :size="14" />
          </button>
          <button
            type="button"
            class="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-blue-600 px-2.5 text-xs font-bold text-white hover:bg-blue-700"
            @click="$emit('add-images')"
          >
            <AppIcon name="image-plus" :size="14" />
            <span class="hidden sm:inline">{{ t("gallery.add") }}</span>
          </button>
        </div>
      </div>
      <p class="mt-2 text-[11px] leading-5 text-slate-500 dark:text-slate-400">
        {{ t("gallery.sequenceHint") }}
      </p>
    </header>

    <div class="min-h-0 flex-1 overflow-y-auto p-2.5">
      <!-- Without a design the first image is the cover, so its own row already carries the tag. -->
      <div v-if="coverDesign" class="relative mb-2">
        <div
          class="flex w-full cursor-pointer items-center gap-2.5 rounded-xl border bg-white/80 p-2 text-left transition hover:border-blue-300 hover:bg-blue-50/40 dark:bg-slate-900/60 dark:hover:border-blue-500/60 dark:hover:bg-blue-950/20"
          :class="
            coverActive
              ? 'border-blue-400 ring-1 ring-blue-500/15 dark:border-blue-500/70'
              : 'border-slate-200/90 dark:border-slate-700/80'
          "
          @click="$emit('open-cover-studio')"
        >
        <div class="relative h-20 w-16 shrink-0 overflow-hidden rounded-lg border border-slate-200/80 bg-slate-900 dark:border-slate-700/80">
          <CoverDesignArtwork :design="coverDesign" compact />
        </div>
        <span class="min-w-0 flex-1">
          <span class="inline-flex items-center gap-1 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-bold text-amber-600 dark:bg-amber-950/50 dark:text-amber-300">
            {{ t("gallery.cover") }}
          </span>
          <strong class="mt-1 block truncate text-[11px] font-bold text-slate-700 dark:text-slate-200">
            {{ coverDesign.title }}
          </strong>
          <span class="mt-0.5 block text-[10px] font-semibold text-blue-600 dark:text-blue-300">
            {{ t("gallery.openCoverStudio") }} →
          </span>
        </span>
        </div>
        <button
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
            <img
              v-if="sceneThumbs[image.id]"
              :src="sceneThumbs[image.id]"
              :alt="image.alt || image.caption"
              class="h-full w-full object-cover"
            />
            <AssetThumbnail
              v-else
              :asset="{ assetId: image.assetId, alt: image.alt, name: image.caption }"
              :get-thumb="getThumb"
              :alt="image.alt || image.caption"
            />
          </div>

          <div class="min-w-0 flex-1">
            <div class="flex items-center gap-1.5">
              <span
                v-if="sceneThumbs[image.id]"
                class="shrink-0 rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-bold text-blue-600 dark:bg-blue-950/50 dark:text-blue-300"
                :title="t('gallery.looks.scene')"
              >
                <AppIcon name="tablet" :size="10" class="inline-block align-[-1px]" />
              </span>
              <span
                v-if="image.overlay?.items?.length"
                class="shrink-0 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold text-slate-500 dark:bg-slate-800 dark:text-slate-400"
                :title="t('overlay.title')"
              >
                <AppIcon name="sparkles" :size="10" class="inline-block align-[-1px]" />
              </span>
              <span
                class="truncate text-[10px] text-slate-500 dark:text-slate-400"
                :title="imageLabel(image)"
              >
                {{ imageLabel(image) }}
              </span>
            </div>
            <div class="mt-1 flex items-center justify-end gap-0.5">
              <!-- Scene corners are corrected per image: a card that sits badly
                   in a photo gets fixed here without moving every other one. -->
              <button
                v-if="sceneActive"
                type="button"
                class="grid h-6 w-6 place-items-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                :title="t('gallery.calibrateImage')"
                :aria-label="t('gallery.calibrateImage')"
                @click.stop="$emit('calibrate-image', image)"
              >
                <AppIcon name="maximize" :size="12" />
              </button>
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
