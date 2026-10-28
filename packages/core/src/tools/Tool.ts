import type { Position } from "../types";
import type { ITool, ToolContext, ToolType } from "./types";

export abstract class Tool<
  Buffer extends Uint32Array | Int32Array = Uint32Array,
> implements ITool<Buffer> {
  constructor(
    public readonly name: ToolType,
    public readonly cursor: string = "crosshair"
  ) {}

  abstract onMouseDown(coords: Position, ctx: ToolContext<Buffer>): void;
  onMouseMove?(coords: Position, ctx: ToolContext<Buffer>): void;
  onMouseUp?(coords: Position, ctx: ToolContext<Buffer>): void;
}
