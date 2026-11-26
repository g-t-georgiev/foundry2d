import type { CameraState } from "@gs2d/core";

/**
 * Helpers for the `editor` block of work files: view and tool state that is
 * saved with a project so it reopens as it was left (camera, tool, toggles).
 * It is separate from the document data and optional; readers are lenient
 * and drop anything invalid, so a damaged block never blocks opening a file.
 */

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const isFiniteNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** The `editor` object of a work file, or an empty one. */
export function editorBlock(json: unknown): Record<string, unknown> {
  return isRecord(json) && isRecord(json.editor) ? json.editor : {};
}

export function readCamera(v: unknown): CameraState | undefined {
  if (!isRecord(v) || !isFiniteNumber(v.zoom) || !isFiniteNumber(v.x) || !isFiniteNumber(v.y)) {
    return undefined;
  }
  return v.zoom > 0 ? { zoom: v.zoom, x: v.x, y: v.y } : undefined;
}

export const readBoolean = (v: unknown): boolean | undefined =>
  typeof v === "boolean" ? v : undefined;

export const readString = (v: unknown): string | undefined =>
  typeof v === "string" ? v : undefined;

export const readInteger = (v: unknown): number | undefined =>
  Number.isInteger(v) ? (v as number) : undefined;

export function readRecord(v: unknown): Record<string, unknown> | undefined {
  return isRecord(v) ? v : undefined;
}

/**
 * Runs `apply` and ignores errors. Used when restoring saved UI state into a
 * validating store, so one stale value (an old tool name) doesn't stop the
 * rest from being restored.
 */
export function tryRestore(apply: () => void): void {
  try {
    apply();
  } catch (error) {
    console.warn("Skipped saved editor state", error);
  }
}
