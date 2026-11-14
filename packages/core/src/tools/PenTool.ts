import { boundsOfChanges } from "../document/bounds";
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
    this.notifyStep(0, ctx);
  }

  onMouseMove(coords: Position, ctx: ToolContext<Buffer>): void {
    if (!ctx.isDrawing) return;

    const value = this.resolveValue(ctx);
    const before = this.currentStroke.length;
    const from = this.lastCoords ?? coords;
    for (const pt of MathUtils.plotLine(from.x, from.y, coords.x, coords.y)) {
      this.drawPoint(pt, ctx, value);
    }
    this.lastCoords = coords;
    this.notifyStep(before, ctx);
  }

  /** Reports the cells this step changed (stroke entries from `from` on). */
  private notifyStep(from: number, ctx: ToolContext<Buffer>): void {
    const rect = boundsOfChanges(this.currentStroke.slice(from));
    if (rect) ctx.doc.notifyCellsChanged(ctx.layer.id, rect);
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
      ctx.doc.notifyCellsChanged(ctx.layer.id, boundsOfChanges(this.currentStroke));
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
    const { width, height } = ctx.layer;
    const mirrorX = ctx.mirror?.x ?? false;
    const mirrorY = ctx.mirror?.y ?? false;

    for (let dy = 0; dy < size; dy++) {
      for (let dx = 0; dx < size; dx++) {
        const x = coords.x - half + dx;
        const y = coords.y - half + dy;
        this.drawCell(x, y, ctx, value);
        if (mirrorX) this.drawCell(width - 1 - x, y, ctx, value);
        if (mirrorY) this.drawCell(x, height - 1 - y, ctx, value);
        if (mirrorX && mirrorY) this.drawCell(width - 1 - x, height - 1 - y, ctx, value);
      }
    }
  }

  /** Sets one cell, recording its original value the first time it is touched in a stroke. */
  private drawCell(px: number, py: number, ctx: ToolContext<Buffer>, value: number): void {
    if (!ctx.layer.isWithinBounds(px, py)) return;
    const oldValue = ctx.layer.get(px, py);
    if (oldValue === value) return;
    const index = ctx.layer.getIndex(px, py);
    if (!this.touched.has(index)) {
      this.touched.add(index);
      this.currentStroke.push({ x: px, y: py, oldValue, newValue: value });
    }
    ctx.layer.set(px, py, value);
  }
}
