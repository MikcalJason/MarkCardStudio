import { ref, watch } from "vue";

import {
  isCreationModeVisible,
  isInspectorSegmentVisible,
  isWorkspaceVisible,
} from "../config/uiFlags.js";

const UI_STATE_KEY = "markcard_ui_v1";
const WORKSPACES = ["create", "publish", "assets", "ops"];
const CREATION_MODES = ["write", "gallery", "poster"];
const INSPECTOR_SEGMENTS = ["design", "generate", "publish"];

function safeReadUiState() {
  try {
    const raw = localStorage.getItem(UI_STATE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * UI-only state for the workspace shell. Document state stays in useStudioDocument.
 */
export function useWorkspaceUi() {
  const activeWorkspace = ref("create");
  const creationMode = ref("write");
  const inspectorSegment = ref("design");
  const assetLibraryOpen = ref(false);
  const stickerPickerOpen = ref(false);
  const coverStudioOpen = ref(false);

  const saved = safeReadUiState();
  if (saved) {
    if (WORKSPACES.includes(saved.activeWorkspace) && isWorkspaceVisible(saved.activeWorkspace)) {
      activeWorkspace.value = saved.activeWorkspace;
    }
    if (CREATION_MODES.includes(saved.creationMode) && isCreationModeVisible(saved.creationMode)) {
      creationMode.value = saved.creationMode;
    }
    if (INSPECTOR_SEGMENTS.includes(saved.inspectorSegment) && isInspectorSegmentVisible(saved.inspectorSegment)) {
      inspectorSegment.value = saved.inspectorSegment;
    }
  }

  function persist() {
    try {
      localStorage.setItem(
        UI_STATE_KEY,
        JSON.stringify({
          activeWorkspace: activeWorkspace.value,
          creationMode: creationMode.value,
          inspectorSegment: inspectorSegment.value,
        }),
      );
    } catch {
      // UI state is optional; keep working from memory.
    }
  }

  watch([activeWorkspace, creationMode, inspectorSegment], persist);

  function setWorkspace(workspace) {
    if (!WORKSPACES.includes(workspace) || !isWorkspaceVisible(workspace)) return;
    activeWorkspace.value = workspace;
    if (workspace !== "create") {
      inspectorSegment.value = "design";
    }
  }

  function setCreationMode(mode) {
    if (!CREATION_MODES.includes(mode) || !isCreationModeVisible(mode)) return;
    creationMode.value = mode;
  }

  function setInspectorSegment(segment) {
    if (!INSPECTOR_SEGMENTS.includes(segment) || !isInspectorSegmentVisible(segment)) return;
    inspectorSegment.value = segment;
  }

  function openAssetLibrary() {
    assetLibraryOpen.value = true;
  }

  function closeAssetLibrary() {
    assetLibraryOpen.value = false;
  }

  function openStickerPicker() {
    stickerPickerOpen.value = true;
  }

  function closeStickerPicker() {
    stickerPickerOpen.value = false;
  }

  function openCoverStudio() {
    coverStudioOpen.value = true;
  }

  function closeCoverStudio() {
    coverStudioOpen.value = false;
  }

  return {
    activeWorkspace,
    creationMode,
    inspectorSegment,
    assetLibraryOpen,
    stickerPickerOpen,
    coverStudioOpen,
    setWorkspace,
    setCreationMode,
    setInspectorSegment,
    openAssetLibrary,
    closeAssetLibrary,
    openStickerPicker,
    closeStickerPicker,
    openCoverStudio,
    closeCoverStudio,
    WORKSPACES,
    CREATION_MODES,
    INSPECTOR_SEGMENTS,
  };
}
