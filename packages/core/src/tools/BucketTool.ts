import type { Position } from "../types";
import type { ToolContext } from "./types";
import { Tool } from "./Tool";
import { FloodFill } from "../algorithms/FloodFill";
import { DrawCommand } from "../history/DrawCommand";

export class BucketTool<
  Buffer extends Uint32Array | Int32Array = Uint32Array,
> extends Tool<Buffer> {
  constructor() {
    super("bucket", "crosshair");
  }

  onMouseDown(coords: Position, ctx: ToolContext<Buffer>): void {
    const changes = FloodFill.execute(ctx.layer, coords.x, coords.y, ctx.value);

    if (changes.length > 0) {
      ctx.history.record(new DrawCommand<Buffer>(ctx.layer, changes));
    }
  }
}
