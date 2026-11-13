import type { Position } from "../types";
import type { CellBuffer, CellChange } from "../document";
import type { ToolContext, ToolType } from "./types";
import { Tool } from "./Tool";
import { MathUtils } from "../utils";
import { DrawCommand } from "../history/DrawCommand";

export class PenTool<Buffer extends CellBuffer = CellBuffer> extends Tool<Buffer> {
  protected lastCoords: Position | null = null;
  protected currentStroke: CellChange<number>[] = [];
  /** Index of every touched cell in this stroke, so each cell is recorded once with its original value. */
  protected touched = new Set<number>();

  constructor(name: ToolType = "pen", cursor = "crosshair") {
    super(name, cursor);
  }

  onMouseDown(coords: Position, ctx: ToolContext<Buffer>): void {
    this.lastCoords = coords;
    this.currentStroke = [];
    this.touched.clear();
    this.drawPoint(coords, ctx, this.resolveValue(ctx));
    ctx.doc.notifyCellsChanged(ctx.layer.id);
  }

  onMouseMove(coords: Position, ctx: ToolContext<Buffer>): void {
    if (!ctx.isDrawing) return;

    const value = this.resolveValue(ctx);
    const from = this.lastCoords ?? coords;
    for (const pt of MathUtils.plotLine(from.x, from.y, coords.x, coords.y)) {
      this.drawPoint(pt, ctx, value);
    }
    this.lastCoords = coords;
    ctx.doc.notifyCellsChanged(ctx.layer.id);
  }

  onMouseUp(_coords: Position, ctx: ToolContext<Buffer>): void {
    this.lastCoords = null;
    if (this.currentStroke.length > 0) {
      ctx.history.record(
        new DrawCommand<Buffer>(ctx.doc, ctx.layer.id, this.currentStroke, this.label)
      );
    }
    this.currentStroke = [];
    this.touched.clear();
  }

  /** Reverts the in-progress stroke. */
  cancel(ctx: ToolContext<Buffer>): void {
    if (this.currentStroke.length > 0) {
      ctx.layer.applyChanges(this.currentStroke, "backward");
      ctx.doc.notifyCellsChanged(ctx.layer.id);
    }
    this.lastCoords = null;
    this.currentStroke = [];
    this.touched.clear();
  }

  protected get label(): string {
    return "Draw";
  }

  protected resolveValue(ctx: ToolContext<Buffer>): number {
    return ctx.value;
  }

  protected drawPoint(coords: Position, ctx: ToolContext<Buffer>, value: number): void {
    const size = Math.max(1, ctx.size);
    const half = Math.floor(size / 2);

    for (let dy = 0; dy < size; dy++) {
      for (let dx = 0; dx < size; dx++) {
        const px = coords.x - half + dx;
        const py = coords.y - half + dy;
        if (!ctx.layer.isWithinBounds(px, py)) continue;

        const oldValue = ctx.layer.get(px, py);
        if (oldValue === value) continue;

        const index = ctx.layer.getIndex(px, py);
        if (!this.touched.has(index)) {
          this.touched.add(index);
          this.currentStroke.push({ x: px, y: py, oldValue, newValue: value });
        }
        ctx.layer.set(px, py, value);
      }
    }
  }
}
