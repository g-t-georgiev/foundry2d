import { boundsOfChanges } from "../document/bounds";
import type { Position } from "../types";
import type { CellBuffer } from "../document";
import type { ToolContext } from "./types";
import { Tool } from "./Tool";
import { FloodFill } from "../algorithms/FloodFill";
import { DrawCommand } from "../history/DrawCommand";

export class BucketTool<Buffer extends CellBuffer = CellBuffer> extends Tool<Buffer> {
  constructor() {
    super("bucket", "crosshair");
  }

  onMouseDown(coords: Position, ctx: ToolContext<Buffer>): void {
    const changes = FloodFill.execute(ctx.layer, coords.x, coords.y, ctx.value);
    if (changes.length === 0) return;
    ctx.doc.notifyCellsChanged(ctx.layer.id, boundsOfChanges(changes));
    ctx.history.record(new DrawCommand<Buffer>(ctx.doc, ctx.layer.id, changes, "Fill"));
  }
}
