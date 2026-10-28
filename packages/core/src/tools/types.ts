import type { Position } from "../types";
import type { GridDocument, GridLayer } from "../document";
import type { HistoryManager } from "../history";

export interface ToolContext<Buffer extends Uint32Array | Int32Array> {
  doc: GridDocument<Buffer>;
  layer: GridLayer<Buffer>;
  history: HistoryManager;
  /** Active value to draw (0xAABBGGRR integer for pixel art, Tile ID for tilemaps) */
  value: number;
  /** Brush / Pen diameter (1, 2, 4...) */
  size: number;
  isDrawing: boolean;
  /** Callback invoked by inspection tools like the Eyedropper */
  onPickValue?: (value: number) => void;
}

export type ToolType = "pen" | "eraser" | "bucket" | "eyedropper";
export interface ITool<Buffer extends Uint32Array | Int32Array> {
  readonly name: ToolType;
  readonly cursor: string;
  onMouseDown(coords: Position, ctx: ToolContext<Buffer>): void;
  onMouseMove?(coords: Position, ctx: ToolContext<Buffer>): void;
  onMouseUp?(coords: Position, ctx: ToolContext<Buffer>): void;
}
