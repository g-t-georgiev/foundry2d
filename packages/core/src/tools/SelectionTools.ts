import type { Position } from "../types";
import type { CellBuffer, GridLayer } from "../document";
import type { ToolContext, ToolType } from "./types";
import { Tool } from "./Tool";
import { MathUtils } from "../utils";
import type { Selection, SelectionShape } from "./SelectTool";

/** Shrinks a full-size mask to its bounding box; `null` when nothing is set. */
function cropMask(full: Uint8Array, width: number, height: number): SelectionShape | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!full[y * width + x]) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  const rect = { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
  const mask = new Uint8Array(rect.width * rect.height);
  for (let y = 0; y < rect.height; y++) {
    for (let x = 0; x < rect.width; x++) {
      mask[y * rect.width + x] = full[(y + rect.y) * width + (x + rect.x)];
    }
  }
  return { rect, mask };
}

/**
 * Cells enclosed by a freehand outline: a cell is selected when its centre
 * is inside the polygon (even-odd rule) or the outline passes through it,
 * so thin shapes still select the cells that were traced.
 */
export function polygonShape(
  points: readonly Position[],
  bounds: { width: number; height: number }
): SelectionShape | null {
  if (points.length === 0) return null;
  const { width, height } = bounds;
  const full = new Uint8Array(width * height);
  const mark = (x: number, y: number) => {
    if (x >= 0 && y >= 0 && x < width && y < height) full[y * width + x] = 1;
  };
  // The outline itself (closed back to the start).
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    for (const p of MathUtils.plotLine(a.x, a.y, b.x, b.y)) mark(p.x, p.y);
  }
  // Interior: test cell centres against the polygon through cell centres.
  if (points.length >= 3) {
    const xs = points.map((p) => p.x + 0.5);
    const ys = points.map((p) => p.y + 0.5);
    for (let y = 0; y < height; y++) {
      const cy = y + 0.5;
      for (let x = 0; x < width; x++) {
        const cx = x + 0.5;
        let inside = false;
        for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
          if (ys[i] > cy !== ys[j] > cy) {
            const crossX = ((xs[j] - xs[i]) * (cy - ys[i])) / (ys[j] - ys[i]) + xs[i];
            if (cx < crossX) inside = !inside;
          }
        }
        if (inside) full[y * width + x] = 1;
      }
    }
  }
  return cropMask(full, width, height);
}

/**
 * Cells with the same value as the one at (x, y): the 4-connected area
 * around it (`contiguous`), or every such cell on the layer.
 */
export function colorShape(
  layer: GridLayer<CellBuffer>,
  x: number,
  y: number,
  contiguous: boolean
): SelectionShape | null {
  if (!layer.isWithinBounds(x, y)) return null;
  const { width, height } = layer;
  const target = layer.get(x, y);
  const full = new Uint8Array(width * height);
  if (!contiguous) {
    for (let i = 0; i < full.length; i++) if (layer.data[i] === target) full[i] = 1;
    return cropMask(full, width, height);
  }
  const stack = [y * width + x];
  full[y * width + x] = 1;
  while (stack.length) {
    const i = stack.pop()!;
    const cx = i % width;
    const cy = (i - cx) / width;
    const visit = (nx: number, ny: number) => {
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) return;
      const n = ny * width + nx;
      if (full[n] || layer.data[n] !== target) return;
      full[n] = 1;
      stack.push(n);
    };
    visit(cx + 1, cy);
    visit(cx - 1, cy);
    visit(cx, cy + 1);
    visit(cx, cy - 1);
  }
  return cropMask(full, width, height);
}

/**
 * Freehand selection: drag an outline; the enclosed cells are selected
 * (live while dragging). A click without dragging clears the selection.
 */
export class LassoTool<Buffer extends CellBuffer = CellBuffer> extends Tool<Buffer> {
  public override readonly modifiesLayer = false;
  private points: Position[] = [];
  private start: SelectionShape | null = null;

  constructor(
    private readonly selection: Selection,
    name: ToolType = "lasso"
  ) {
    super(name, "crosshair");
  }

  onMouseDown(coords: Position, _ctx: ToolContext<Buffer>): void {
    this.start = this.selection.shape;
    this.points = [coords];
  }

  onMouseMove(coords: Position, ctx: ToolContext<Buffer>): void {
    if (!ctx.isDrawing || this.points.length === 0) return;
    const last = this.points[this.points.length - 1];
    if (last.x === coords.x && last.y === coords.y) return;
    this.points.push(coords);
    this.selection.setShape(polygonShape(this.points, ctx.layer));
  }

  onMouseUp(_coords: Position, ctx: ToolContext<Buffer>): void {
    if (this.points.length < 2) this.selection.set(null);
    else this.selection.setShape(polygonShape(this.points, ctx.layer));
    this.points = [];
  }

  cancel(_ctx: ToolContext<Buffer>): void {
    this.selection.setShape(this.start);
    this.points = [];
  }
}

/**
 * Click to select the area of the same colour (4-connected); with Shift,
 * that colour everywhere on the layer.
 */
export class MagicWandTool<Buffer extends CellBuffer = CellBuffer> extends Tool<Buffer> {
  public override readonly modifiesLayer = false;

  constructor(
    private readonly selection: Selection,
    name: ToolType = "wand"
  ) {
    super(name, "crosshair");
  }

  onMouseDown(coords: Position, ctx: ToolContext<Buffer>): void {
    const global = ctx.modifiers?.shift === true;
    this.selection.setShape(colorShape(ctx.layer, coords.x, coords.y, !global));
  }

  onMouseMove(): void {}

  onMouseUp(): void {}
}
