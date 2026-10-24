<script setup>
import AssetLibraryBrowser from "../assets/AssetLibraryBrowser.vue";

defineProps({
  library: {
    type: Object,
    required: true,
  },
  workTitle: {
    type: String,
    default: "",
  },
});

defineEmits(["add-to-gallery", "insert"]);
</script>

<template>
  <section class="flex min-h-0 min-w-0 flex-1 overflow-hidden">
    <AssetLibraryBrowser
      embedded
      :open="true"
      :library="library"
      :work-title="workTitle"
      @add-to-gallery="$emit('add-to-gallery', $event)"
      @insert="$emit('insert', $event)"
    />
  </section>
</template>
