import type { Position } from "../types";
import type { CellBuffer, CellChange } from "../document";
import type { ToolContext, ToolType } from "./types";
import { Tool } from "./Tool";
import { DrawCommand } from "../history/DrawCommand";

/**
 * Drag to draw a rectangle. The shape is previewed live on the layer
 * (reverted and redrawn on every move) and committed as one undo step.
 */
export class RectangleTool<Buffer extends CellBuffer = CellBuffer> extends Tool<Buffer> {
  private start: Position | null = null;
  private applied: CellChange<number>[] = [];

  constructor(
    name: ToolType = "rect",
    /** Fill the whole area (`true`) or draw only the border. */
    public readonly filled = true
  ) {
    super(name, "crosshair");
  }

  onMouseDown(coords: Position, ctx: ToolContext<Buffer>): void {
    this.start = coords;
    this.applied = [];
    this.preview(coords, ctx);
  }

  onMouseMove(coords: Position, ctx: ToolContext<Buffer>): void {
    if (!this.start || !ctx.isDrawing) return;
    this.preview(coords, ctx);
  }

  onMouseUp(coords: Position, ctx: ToolContext<Buffer>): void {
    if (!this.start) return;
    this.preview(coords, ctx);
    if (this.applied.length > 0) {
      ctx.history.record(
        new DrawCommand<Buffer>(
          ctx.doc,
          ctx.layer.id,
          this.applied,
          this.filled ? "Fill rectangle" : "Rectangle"
        )
      );
    }
    this.start = null;
    this.applied = [];
  }

  cancel(ctx: ToolContext<Buffer>): void {
    this.revert(ctx);
    ctx.doc.notifyCellsChanged(ctx.layer.id);
    this.start = null;
  }

  private revert(ctx: ToolContext<Buffer>): void {
    if (this.applied.length) ctx.layer.applyChanges(this.applied, "backward");
    this.applied = [];
  }

  private preview(end: Position, ctx: ToolContext<Buffer>): void {
    const start = this.start!;
    this.revert(ctx);

    const { layer, value } = ctx;
    const x0 = Math.max(0, Math.min(start.x, end.x));
    const y0 = Math.max(0, Math.min(start.y, end.y));
    const x1 = Math.min(layer.width - 1, Math.max(start.x, end.x));
    const y1 = Math.min(layer.height - 1, Math.max(start.y, end.y));

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (!this.filled && x !== x0 && x !== x1 && y !== y0 && y !== y1) continue;
        const oldValue = layer.get(x, y);
        if (oldValue === value) continue;
        this.applied.push({ x, y, oldValue, newValue: value });
        layer.set(x, y, value);
      }
    }
    ctx.doc.notifyCellsChanged(layer.id);
  }
}
