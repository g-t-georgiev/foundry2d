import type { Position } from "../types";
import type { CellBuffer, CellChange } from "../document";
import type { ToolContext, ToolType } from "./types";
import { Tool } from "./Tool";
import { DrawCommand } from "../history/DrawCommand";
import { MathUtils } from "../utils/MathUtils";

/** A rectangular block of cell values, row-major. */
export interface StampPattern {
  width: number;
  height: number;
  values: readonly number[];
}

/**
 * Paints a multi-cell pattern (e.g. a block of tiles) with its top-left
 * corner at the pointer. Dragging repeats the pattern on a grid aligned to
 * the first placement, so stamps tile seamlessly. One stroke = one undo step.
 */
export class StampTool<Buffer extends CellBuffer = CellBuffer> extends Tool<Buffer> {
  private anchor: Position | null = null;
  private last: Position | null = null;
  private placed = new Set<string>();
  private touched = new Set<number>();
  private stroke: CellChange<number>[] = [];

  constructor(
    private readonly getPattern: () => StampPattern | null,
    name: ToolType = "stamp"
  ) {
    super(name, "crosshair");
  }

  onMouseDown(coords: Position, ctx: ToolContext<Buffer>): void {
    this.anchor = coords;
    this.last = coords;
    this.placed.clear();
    this.touched.clear();
    this.stroke = [];
    this.place(coords, ctx);
  }

  onMouseMove(coords: Position, ctx: ToolContext<Buffer>): void {
    if (!this.anchor || !ctx.isDrawing) return;
    // Walk every cell between samples so fast drags leave no gaps.
    const from = this.last ?? coords;
    for (const point of MathUtils.plotLine(from.x, from.y, coords.x, coords.y)) {
      this.place(point, ctx);
    }
    this.last = coords;
  }

  onMouseUp(_coords: Position, ctx: ToolContext<Buffer>): void {
    if (this.stroke.length > 0) {
      ctx.history.record(new DrawCommand<Buffer>(ctx.doc, ctx.layer.id, this.stroke, "Stamp"));
    }
    this.anchor = null;
    this.last = null;
    this.stroke = [];
  }

  cancel(ctx: ToolContext<Buffer>): void {
    if (this.stroke.length > 0) {
      ctx.layer.applyChanges(this.stroke, "backward");
      ctx.doc.notifyCellsChanged(ctx.layer.id);
    }
    this.anchor = null;
    this.stroke = [];
  }

  private place(coords: Position, ctx: ToolContext<Buffer>): void {
    const pattern = this.getPattern();
    const anchor = this.anchor;
    if (!pattern || !anchor || pattern.width < 1 || pattern.height < 1) return;

    // Snap to the pattern grid that starts at the first placement.
    const ox = anchor.x + Math.floor((coords.x - anchor.x) / pattern.width) * pattern.width;
    const oy = anchor.y + Math.floor((coords.y - anchor.y) / pattern.height) * pattern.height;
    const key = `${ox},${oy}`;
    if (this.placed.has(key)) return;
    this.placed.add(key);

    const { layer } = ctx;
    for (let y = 0; y < pattern.height; y++) {
      for (let x = 0; x < pattern.width; x++) {
        const px = ox + x;
        const py = oy + y;
        if (!layer.isWithinBounds(px, py)) continue;
        const value = pattern.values[y * pattern.width + x];
        const oldValue = layer.get(px, py);
        if (oldValue === value) continue;
        const index = layer.getIndex(px, py);
        if (!this.touched.has(index)) {
          this.touched.add(index);
          this.stroke.push({ x: px, y: py, oldValue, newValue: value });
        } else {
          // Overwritten twice in one stroke: keep the original old value.
          const change = this.stroke.find((c) => c.x === px && c.y === py);
          if (change) change.newValue = value;
        }
        layer.set(px, py, value);
      }
    }
    ctx.doc.notifyCellsChanged(layer.id);
  }
}
