// Surfaces whose phase has not shipped stay implemented but out of the UI, so
// every visible entry point actually does something. Flip a flag to bring one back.
export const UI_FLAGS = {
  opsWorkspace: true,
  posterMode: false,
  generateSegment: false,
};

export function isWorkspaceVisible(id) {
  return id !== "ops" || UI_FLAGS.opsWorkspace;
}

export function isCreationModeVisible(id) {
  return id !== "poster" || UI_FLAGS.posterMode;
}

export function isInspectorSegmentVisible(id) {
  return id !== "generate" || UI_FLAGS.generateSegment;
}
