import type { CellBuffer } from "../document";
import type { ToolContext } from "./types";
import { PenTool } from "./PenTool";

export class EraserTool<Buffer extends CellBuffer = CellBuffer> extends PenTool<Buffer> {
  constructor() {
    super("eraser", "crosshair");
  }

  protected override get label(): string {
    return "Erase";
  }

  protected override resolveValue(ctx: ToolContext<Buffer>): number {
    return ctx.layer.emptyValue;
  }
}
