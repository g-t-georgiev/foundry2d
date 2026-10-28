import type { ToolContext } from "./types";
import { PenTool } from "./PenTool";

export class EraserTool<
  Buffer extends Uint32Array | Int32Array = Uint32Array,
> extends PenTool<Buffer> {
  constructor() {
    super("eraser", "crosshair");
  }

  protected override resolveValue(ctx: ToolContext<Buffer>): number {
    return ctx.layer.emptyValue;
  }
}
