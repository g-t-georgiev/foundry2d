import type { Camera, Position } from "@gs2d/core";

/** Where the pointer is, in every coordinate space a pass might need. */
export interface PointerInfo {
  /** CSS pixels relative to the canvas' top-left corner. */
  local: Position;
  world: Position;
  grid: Position;
  /** Whether the pointer is over the canvas. */
  inside: boolean;
}

export interface RenderContext {
  ctx: CanvasRenderingContext2D;
  camera: Camera;
  /** Canvas size in CSS pixels. */
  viewWidth: number;
  viewHeight: number;
  devicePixelRatio: number;
  pointer: PointerInfo | null;
  theme: RenderTheme;
  /** `performance.now()` at frame start; useful for animated passes. */
  time: number;
}

/**
 * One step of the frame. World-space passes draw in world units (the camera
 * transform is applied); screen-space passes draw in CSS pixels.
 */
export interface RenderPass {
  readonly id: string;
  readonly space: "world" | "screen";
  enabled: boolean;
  render(rc: RenderContext): void;
  /** Releases cached resources. */
  dispose?(): void;
}

export interface RenderTheme {
  workspaceBackground: string;
  checkerLight: string;
  checkerDark: string;
  gridLine: string;
  gridLineMajor: string;
  bounds: string;
  cursorStroke: string;
  cursorEraseFill: string;
  rulerBar: string;
  rulerLabel: string;
  rulerTick: string;
  rulerHighlight: string;
  rulerCorner: string;
  selection: string;
  font: string;
}

export const defaultTheme: RenderTheme = {
  workspaceBackground: "#33353d",
  checkerLight: "#2a2d36",
  checkerDark: "#22242b",
  gridLine: "rgba(255, 255, 255, 0.12)",
  gridLineMajor: "rgba(255, 255, 255, 0.28)",
  bounds: "rgba(255, 255, 255, 0.3)",
  cursorStroke: "rgba(255, 255, 255, 0.85)",
  cursorEraseFill: "rgba(255, 100, 100, 0.35)",
  rulerBar: "#23262d",
  rulerLabel: "#9fa6ae",
  rulerTick: "#9fa6ae",
  rulerHighlight: "#66fffb",
  rulerCorner: "#363940",
  selection: "#66fffb",
  font: "sans-serif",
};
