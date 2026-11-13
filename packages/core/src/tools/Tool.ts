import type { Position } from "../types";
import type { CellBuffer } from "../document";
import type { ITool, ToolContext, ToolType } from "./types";

export abstract class Tool<Buffer extends CellBuffer = CellBuffer> implements ITool<Buffer> {
  public readonly modifiesLayer: boolean = true;

  constructor(
    public readonly name: ToolType,
    public readonly cursor: string = "crosshair"
  ) {}

  abstract onMouseDown(coords: Position, ctx: ToolContext<Buffer>): void;
  onMouseMove?(coords: Position, ctx: ToolContext<Buffer>): void;
  onMouseUp?(coords: Position, ctx: ToolContext<Buffer>): void;
  cancel?(ctx: ToolContext<Buffer>): void;
}
