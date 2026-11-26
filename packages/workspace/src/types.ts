import type { Dimensions, Position, Rect } from "@gs2d/core";
import type { RenderPass } from "@gs2d/render";
import type { Workspace } from "./Workspace";

export interface ScenePointerEvent {
  pointerId: number;
  /** 0 = primary, 1 = middle, 2 = secondary. */
  button: number;
  local: Position;
  world: Position;
  grid: Position;
  shiftKey: boolean;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  /** Original DOM event, for anything not covered above. */
  native: MouseEvent;
}

/**
 * What a `Workspace` is currently showing and editing. Pixel has
 * one scene per document; Levels swaps between a world scene and
 * a level scene inside the same workspace.
 */
export interface WorkspaceScene {
  /** World size of one grid cell; used for pointer → grid mapping. */
  readonly cellSize: Dimensions;
  /**
   * Pointer → grid mapping when cells are not all `cellSize` (e.g. the
   * active layer has its own grid). Defaults to the camera's mapping.
   */
  worldToGrid?(world: Position): Position;
  /** Content bounds in world units for fit-to-view and pan clamping. `null` = unbounded. */
  getBounds(): Rect | null;
  /** Passes drawn for this scene (the workspace appends its own overlays such as rulers). */
  getPasses(): RenderPass[];
  /** Whether panning is clamped to keep content in view. Defaults to `true`. */
  readonly clampCamera?: boolean;

  attach?(workspace: Workspace): void;
  detach?(): void;

  onPointerDown?(event: ScenePointerEvent): void;
  onPointerMove?(event: ScenePointerEvent): void;
  onPointerUp?(event: ScenePointerEvent): void;
  /** The stroke was interrupted (pointercancel, Escape, scene switch). */
  onPointerCancel?(): void;
  onDoubleClick?(event: ScenePointerEvent): void;
  /** CSS cursor for the canvas. */
  getCursor?(): string;
}

export type WorkspaceEventMap = {
  "pointer:move": (payload: { world: Position; grid: Position; inside: boolean }) => void;
  "camera:changed": (payload: { x: number; y: number; zoom: number }) => void;
  "scene:changed": (payload: { scene: WorkspaceScene | null }) => void;
  resized: (payload: { width: number; height: number }) => void;
};
