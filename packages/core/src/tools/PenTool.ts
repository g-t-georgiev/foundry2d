import type { Position } from "../types";
import type { ToolContext, ToolType } from "./types";
import type { CellChange } from "../document";
import { Tool } from "./Tool";
import { MathUtils } from "../utils";
import { DrawCommand } from "../history/DrawCommand";

export class PenTool<Buffer extends Uint32Array | Int32Array = Uint32Array> extends Tool<Buffer> {
  protected lastCoords: Position | null = null;
  protected currentStroke: CellChange<number>[] = [];

  constructor(name: ToolType = "pen", cursor = "crosshair") {
    super(name, cursor);
  }

  onMouseDown(coords: Position, ctx: ToolContext<Buffer>): void {
    this.lastCoords = coords;
    this.currentStroke = [];
    this.drawPoint(coords, ctx, this.resolveValue(ctx));
  }

  onMouseMove(coords: Position, ctx: ToolContext<Buffer>): void {
    if (!ctx.isDrawing) return;

    const valueToDraw = this.resolveValue(ctx);

    if (this.lastCoords) {
      const points = MathUtils.plotLine(this.lastCoords.x, this.lastCoords.y, coords.x, coords.y);
      for (const pt of points) {
        this.drawPoint(pt, ctx, valueToDraw);
      }
    } else {
      this.drawPoint(coords, ctx, valueToDraw);
    }

    this.lastCoords = coords;
  }

  onMouseUp(_coords: Position, ctx: ToolContext<Buffer>): void {
    this.lastCoords = null;

    if (this.currentStroke.length > 0) {
      // Commit the changes to the undo/redo history
      ctx.history.record(new DrawCommand<Buffer>(ctx.layer, this.currentStroke));
    }

    this.currentStroke = [];
  }

  protected resolveValue(ctx: ToolContext<Buffer>): number {
    return ctx.value;
  }

  protected drawPoint(coords: Position, ctx: ToolContext<Buffer>, valueToDraw: number): void {
    const halfSize = Math.floor(ctx.size / 2);

    for (let dy = 0; dy < ctx.size; dy++) {
      for (let dx = 0; dx < ctx.size; dx++) {
        const px = coords.x - halfSize + dx;
        const py = coords.y - halfSize + dy;

        if (!ctx.layer.isWithinBounds(px, py)) continue;

        const oldValue = ctx.layer.get(px, py);
        if (oldValue === valueToDraw) continue;

        this.currentStroke.push({
          x: px,
          y: py,
          oldValue,
          newValue: valueToDraw,
        });

        // Mutates the raw TypedArray buffer directly
        ctx.layer.set(px, py, valueToDraw);
      }
    }
  }
}
