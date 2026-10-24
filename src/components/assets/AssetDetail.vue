<script setup>
import { computed, ref, watch } from "vue";
import { useI18n } from "vue-i18n";
import AppIcon from "../AppIcon.vue";
import { formatBytes, formatDimensions } from "../../utils/imageFiles.js";

const props = defineProps({
  asset: {
    type: Object,
    default: null,
  },
  previewUrl: {
    type: String,
    default: "",
  },
  picker: {
    type: Boolean,
    default: false,
  },
  isDesktop: {
    type: Boolean,
    default: false,
  },
  workTitle: {
    type: String,
    default: "",
  },
});

const emit = defineEmits([
  "insert",
  "pick",
  "archive",
  "restore",
  "purge",
  "update-alt",
  "update-tags",
  "update-rights",
  "refresh-preview",
  "edit-image",
]);

const { t } = useI18n();
const alt = ref("");
const tags = ref("");
const rightsLicense = ref("unknown");
const rightsAuthor = ref("");

const dimensions = computed(() => formatDimensions(props.asset));
const canInsert = computed(() => Boolean(props.asset && !props.asset.deletedAt));
const licenses = ["unknown", "own", "cc0", "cc-by", "cc-by-sa", "permission"];

watch(
  () => props.asset?.assetId,
  () => {
    alt.value = props.asset?.alt || "";
    tags.value = (props.asset?.tags || []).join(", ");
    rightsLicense.value = props.asset?.rights?.license || "unknown";
    rightsAuthor.value = props.asset?.rights?.author || "";
  },
  { immediate: true },
);

function saveAlt() {
  if (!props.asset || alt.value === (props.asset.alt || "")) return;
  emit("update-alt", props.asset.assetId, alt.value.trim());
}

function saveTags() {
  if (!props.asset) return;
  const nextTags = tags.value
    .split(/[,，]/)
    .map((tag) => tag.trim())
    .filter(Boolean);
  emit("update-tags", props.asset.assetId, nextTags);
}

function saveRights() {
  if (!props.asset) return;
  emit("update-rights", props.asset.assetId, {
    license: rightsLicense.value,
    author: rightsAuthor.value.trim(),
  });
}
</script>

<template>
  <aside class="flex h-full min-h-0 w-full flex-col border-l border-slate-200/80 bg-white/70 dark:border-slate-800 dark:bg-slate-900/40">
    <template v-if="asset">
      <div class="shrink-0 border-b border-slate-200/80 p-4 dark:border-slate-800">
        <div class="flex items-center justify-between gap-2">
          <h3 class="truncate text-sm font-bold dark:text-slate-100" :title="asset.name || asset.fileName">
            {{ asset.name || asset.fileName }}
          </h3>
          <span
            v-if="asset.deletedAt"
            class="shrink-0 rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-bold text-rose-600 dark:bg-rose-950/50 dark:text-rose-300"
          >
            {{ t("assets.trash") }}
          </span>
        </div>
        <p class="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
          {{ asset.fileName }} · {{ formatBytes(asset.bytes) }}
        </p>
      </div>

      <div class="min-h-0 flex-1 overflow-y-auto">
        <div class="border-b border-slate-200/80 p-4 dark:border-slate-800">
          <div class="overflow-hidden rounded-xl border border-slate-200/90 bg-slate-100 dark:border-slate-700/80 dark:bg-slate-800">
            <img
              v-if="previewUrl"
              :src="previewUrl"
              :alt="asset.alt || asset.name"
              class="max-h-56 w-full object-contain"
              @error="$emit('refresh-preview')"
            />
            <div v-else class="flex h-36 items-center justify-center text-slate-500 dark:text-slate-400">
              <AppIcon name="image" :size="26" />
            </div>
          </div>

          <dl class="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-[11px]">
            <div>
              <dt class="text-slate-500 dark:text-slate-400">{{ t("assets.dimensions") }}</dt>
              <dd class="mt-0.5 font-semibold text-slate-700 dark:text-slate-200">{{ dimensions || "—" }}</dd>
            </div>
            <div>
              <dt class="text-slate-500 dark:text-slate-400">{{ t("assets.format") }}</dt>
              <dd class="mt-0.5 font-semibold uppercase text-slate-700 dark:text-slate-200">{{ asset.format }}</dd>
            </div>
            <div>
              <dt class="text-slate-500 dark:text-slate-400">{{ t("assets.source") }}</dt>
              <dd class="mt-0.5 font-semibold text-slate-700 dark:text-slate-200">
                {{ t(`assets.sources.${asset.source?.kind || "import"}`) }}
              </dd>
            </div>
            <div>
              <dt class="text-slate-500 dark:text-slate-400">{{ t("assets.usage") }}</dt>
              <dd class="mt-0.5 font-semibold text-slate-700 dark:text-slate-200">
                {{ asset.usage?.length || 0 }}
              </dd>
            </div>
          </dl>
        </div>

        <div class="space-y-4 border-b border-slate-200/80 p-4 dark:border-slate-800">
          <label class="block">
            <span class="text-[11px] font-semibold text-slate-500 dark:text-slate-400">{{ t("assets.altLabel") }}</span>
            <textarea
              v-model="alt"
              rows="2"
              class="mt-1 w-full resize-none rounded-lg border border-slate-200 bg-white px-2.5 py-2 text-xs text-slate-800 outline-none focus:border-blue-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              :placeholder="t('assets.altPlaceholder')"
              @blur="saveAlt"
            ></textarea>
          </label>

          <label class="block">
            <span class="text-[11px] font-semibold text-slate-500 dark:text-slate-400">{{ t("assets.tagsLabel") }}</span>
            <input
              v-model="tags"
              type="text"
              class="mt-1 h-8 w-full rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-800 outline-none focus:border-blue-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
              :placeholder="t('assets.tagsPlaceholder')"
              @blur="saveTags"
            />
            <span class="mt-1 block text-[10px] text-slate-500 dark:text-slate-400">{{ t("assets.tagsHint") }}</span>
          </label>

          <div class="grid grid-cols-2 gap-2">
            <label class="block">
              <span class="text-[11px] font-semibold text-slate-500 dark:text-slate-400">{{ t("assets.license") }}</span>
              <select
                v-model="rightsLicense"
                class="mt-1 h-8 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-800 outline-none focus:border-blue-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                @change="saveRights"
              >
                <option v-for="license in licenses" :key="license" :value="license">
                  {{ t(`assets.licenses.${license}`) }}
                </option>
              </select>
            </label>
            <label class="block">
              <span class="text-[11px] font-semibold text-slate-500 dark:text-slate-400">{{ t("assets.author") }}</span>
              <input
                v-model="rightsAuthor"
                type="text"
                class="mt-1 h-8 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs text-slate-800 outline-none focus:border-blue-400 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-100"
                @blur="saveRights"
              />
            </label>
          </div>

          <p
            v-if="(asset.rights?.license || 'unknown') === 'unknown'"
            class="rounded-lg bg-amber-50 px-2.5 py-2 text-[11px] leading-5 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300"
          >
            {{ t("assets.rightsWarning") }}
          </p>
        </div>

        <div class="border-b border-slate-200/80 p-4 dark:border-slate-800">
          <div class="flex items-center justify-between">
            <span class="text-[11px] font-semibold text-slate-500 dark:text-slate-400">{{ t("assets.usedBy") }}</span>
            <span class="text-[11px] font-bold text-slate-700 dark:text-slate-200">{{ asset.usage?.length || 0 }}</span>
          </div>
          <ul v-if="asset.usage?.length" class="mt-2 space-y-1.5">
            <li
              v-for="usage in asset.usage"
              :key="`${usage.workId}-${usage.ref}`"
              class="flex items-center gap-2 rounded-lg border border-slate-200/80 bg-white/80 px-2 py-1.5 text-[11px] dark:border-slate-700/80 dark:bg-slate-900/50"
            >
              <AppIcon name="file-text" :size="12" class="shrink-0 text-slate-400" />
              <span class="min-w-0 flex-1 truncate text-slate-600 dark:text-slate-300">
                {{ workTitle || usage.workId }}
              </span>
              <span class="shrink-0 text-slate-500 dark:text-slate-400">{{ usage.ref }}</span>
            </li>
          </ul>
          <p v-else class="mt-2 text-[11px] text-slate-500 dark:text-slate-400">{{ t("assets.notUsed") }}</p>
        </div>

        <div class="space-y-2 p-4">
          <div class="flex items-center justify-between gap-2">
            <span class="text-[11px] font-semibold text-slate-500 dark:text-slate-400">{{ t("assets.hash") }}</span>
            <code class="truncate text-[10px] text-slate-500 dark:text-slate-400" :title="asset.assetId">
              {{ asset.assetId }}
            </code>
          </div>
          <div v-if="asset.projectPaths?.length" class="text-[11px] text-slate-500 dark:text-slate-400">
            <span class="font-semibold">{{ t("assets.projectMirror") }}</span>
            <ul class="mt-1 space-y-0.5">
              <li v-for="path in asset.projectPaths" :key="path" class="truncate font-mono text-[10px]">
                {{ path }}
              </li>
            </ul>
          </div>
          <p v-else-if="!isDesktop" class="text-[11px] leading-5 text-slate-500 dark:text-slate-400">
            {{ t("assets.browserStorageHint") }}
          </p>
        </div>
      </div>

      <div class="shrink-0 space-y-2 border-t border-slate-200/80 p-4 dark:border-slate-800">
        <button
          v-if="picker"
          type="button"
          class="inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-blue-600 text-xs font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="!canInsert"
          @click="$emit('pick', asset)"
        >
          <AppIcon name="plus" :size="14" />
          {{ t("assets.addToGallery") }}
        </button>
        <button
          v-else
          type="button"
          class="inline-flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-blue-600 text-xs font-bold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="!canInsert"
          @click="$emit('insert', asset)"
        >
          <AppIcon name="file-text" :size="14" />
          {{ t("assets.insertMarkdown") }}
        </button>

        <button
          v-if="canInsert && asset.mediaType?.startsWith('image/')"
          type="button"
          class="inline-flex h-8 w-full items-center justify-center gap-2 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          @click="$emit('edit-image', asset)"
        >
          <AppIcon name="sliders" :size="13" />
          {{ t("assets.editImage") }}
        </button>

        <button
          v-if="asset.deletedAt"
          type="button"
          class="inline-flex h-8 w-full items-center justify-center gap-2 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          @click="$emit('restore', asset)"
        >
          <AppIcon name="rotate-ccw" :size="13" />
          {{ t("assets.restore") }}
        </button>
        <button
          v-else
          type="button"
          class="inline-flex h-8 w-full items-center justify-center gap-2 rounded-lg border border-slate-200 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          @click="$emit('archive', asset)"
        >
          <AppIcon name="archive" :size="13" />
          {{ t("assets.archive") }}
        </button>
        <button
          type="button"
          class="inline-flex h-8 w-full items-center justify-center gap-2 rounded-lg border border-rose-200 text-xs font-semibold text-rose-600 hover:bg-rose-50 dark:border-rose-900/60 dark:text-rose-300 dark:hover:bg-rose-950/40"
          @click="$emit('purge', asset)"
        >
          <AppIcon name="trash-2" :size="13" />
          {{ t("assets.deleteForever") }}
        </button>
      </div>
    </template>

    <div v-else class="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
      <span class="grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-400 dark:bg-slate-800 dark:text-slate-500">
        <AppIcon name="image" :size="22" />
      </span>
      <p class="text-xs font-semibold text-slate-500 dark:text-slate-400">{{ t("assets.selectHint") }}</p>
      <p class="text-[11px] leading-5 text-slate-500 dark:text-slate-400">{{ t("assets.detailHint") }}</p>
    </div>
  </aside>
</template>
