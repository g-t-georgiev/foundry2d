import type { Position } from "../types";
import type { CellBuffer, GridDocument, GridLayer } from "../document";
import type { HistoryManager } from "../history";

export interface ToolContext<Buffer extends CellBuffer = CellBuffer> {
  doc: GridDocument<Buffer>;
  layer: GridLayer<Buffer>;
  history: HistoryManager;
  /** Active value to draw (0xAABBGGRR integer for pixel art, tile/IntGrid id for tilemaps). */
  value: number;
  /** Brush diameter in cells (1, 2, 4...). */
  size: number;
  isDrawing: boolean;
  /** Invoked by inspection tools such as the eyedropper. */
  onPickValue?: (value: number) => void;
}

/** Built-in tool names. Apps can register tools with any other string name. */
export type BuiltinToolType = "pen" | "eraser" | "bucket" | "eyedropper";
export type ToolType = BuiltinToolType | (string & {});

export interface ITool<Buffer extends CellBuffer = CellBuffer> {
  readonly name: ToolType;
  readonly cursor: string;
  /** Whether the tool writes cells. Writing tools are blocked on hidden/locked layers. */
  readonly modifiesLayer: boolean;
  onMouseDown(coords: Position, ctx: ToolContext<Buffer>): void;
  onMouseMove?(coords: Position, ctx: ToolContext<Buffer>): void;
  onMouseUp?(coords: Position, ctx: ToolContext<Buffer>): void;
  /** Called when the stroke is interrupted (tool switch, pointer cancel). */
  cancel?(ctx: ToolContext<Buffer>): void;
}
