import type { Position } from "../types";
import type { CellBuffer, CellChange } from "../document";
import type { ToolContext, ToolType } from "./types";
import { Tool } from "./Tool";
import { DrawCommand } from "../history/DrawCommand";
import { MathUtils } from "../utils/MathUtils";

/**
 * Base for drag-to-draw shapes. The shape is previewed live on the layer
 * (reverted and redrawn on every move) and committed as one undo step.
 * Subclasses only say which cells a shape from `start` to `end` covers.
 */
export abstract class ShapeTool<Buffer extends CellBuffer = CellBuffer> extends Tool<Buffer> {
  private start: Position | null = null;
  private applied: CellChange<number>[] = [];

  constructor(name: ToolType, cursor = "crosshair") {
    super(name, cursor);
  }

  /** Cells covered by the shape; may include cells outside the layer. */
  protected abstract cells(start: Position, end: Position): Iterable<Position>;

  protected abstract get label(): string;

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
      ctx.history.record(new DrawCommand<Buffer>(ctx.doc, ctx.layer.id, this.applied, this.label));
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
    const seen = new Set<number>();
    for (const { x, y } of this.cells(start, end)) {
      if (!layer.isWithinBounds(x, y)) continue;
      const index = layer.getIndex(x, y);
      if (seen.has(index)) continue;
      seen.add(index);
      const oldValue = layer.get(x, y);
      if (oldValue === value) continue;
      this.applied.push({ x, y, oldValue, newValue: value });
      layer.set(x, y, value);
    }
    ctx.doc.notifyCellsChanged(layer.id);
  }
}

const bounds = (a: Position, b: Position) => ({
  x0: Math.min(a.x, b.x),
  y0: Math.min(a.y, b.y),
  x1: Math.max(a.x, b.x),
  y1: Math.max(a.y, b.y),
});

/** Axis-aligned rectangle, filled or outlined. */
export class RectangleTool<Buffer extends CellBuffer = CellBuffer> extends ShapeTool<Buffer> {
  constructor(
    name: ToolType = "rect",
    /** Fill the whole area (`true`) or draw only the border. */
    public readonly filled = true
  ) {
    super(name);
  }

  protected get label(): string {
    return this.filled ? "Fill rectangle" : "Rectangle";
  }

  protected *cells(start: Position, end: Position): Iterable<Position> {
    const { x0, y0, x1, y1 } = bounds(start, end);
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (this.filled || x === x0 || x === x1 || y === y0 || y === y1) yield { x, y };
      }
    }
  }
}

/** Straight line (Bresenham), one cell wide. */
export class LineTool<Buffer extends CellBuffer = CellBuffer> extends ShapeTool<Buffer> {
  constructor(name: ToolType = "line") {
    super(name);
  }

  protected get label(): string {
    return "Line";
  }

  protected cells(start: Position, end: Position): Iterable<Position> {
    return MathUtils.plotLine(start.x, start.y, end.x, end.y);
  }
}

/**
 * Ellipse inscribed in the dragged rectangle. Uses the implicit equation on
 * cell centres, which gives symmetric pixel-art ellipses for both odd and
 * even sizes. The outline is every inside cell with an outside 4-neighbour.
 */
export class EllipseTool<Buffer extends CellBuffer = CellBuffer> extends ShapeTool<Buffer> {
  constructor(
    name: ToolType = "ellipse",
    public readonly filled = false
  ) {
    super(name);
  }

  protected get label(): string {
    return this.filled ? "Fill ellipse" : "Ellipse";
  }

  protected *cells(start: Position, end: Position): Iterable<Position> {
    const { x0, y0, x1, y1 } = bounds(start, end);
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const rx = (x1 - x0) / 2 + 0.5;
    const ry = (y1 - y0) / 2 + 0.5;
    const inside = (x: number, y: number) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2 <= 1;

    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        if (!inside(x, y)) continue;
        if (
          this.filled ||
          !inside(x - 1, y) ||
          !inside(x + 1, y) ||
          !inside(x, y - 1) ||
          !inside(x, y + 1)
        ) {
          yield { x, y };
        }
      }
    }
  }
}
