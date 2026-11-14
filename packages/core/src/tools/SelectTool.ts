import type { Position, Rect } from "../types";
import type { CellBuffer, CellChange, GridLayer } from "../document";
import type { ICommand } from "../history/types";
import type { ToolContext, ToolType } from "./types";
import { Tool } from "./Tool";
import { DrawCommand } from "../history/DrawCommand";
import { CompositeCommand } from "../history/CompositeCommand";
import EventEmitter from "../utils/EventEmitter";

/** A rectangular block of cell values, row-major (clipboard contents, moved pixels). */
export interface Region {
  width: number;
  height: number;
  values: number[];
}

/** A rectangular selection, shared by the select tool, clipboard actions and overlays. */
export class Selection {
  readonly events = new EventEmitter<{ changed: (rect: Rect | null) => void }>();
  private _rect: Rect | null = null;

  get rect(): Rect | null {
    return this._rect;
  }

  set(rect: Rect | null): void {
    const next = rect && rect.width > 0 && rect.height > 0 ? { ...rect } : null;
    const prev = this._rect;
    if (
      prev === next ||
      (prev &&
        next &&
        prev.x === next.x &&
        prev.y === next.y &&
        prev.width === next.width &&
        prev.height === next.height)
    ) {
      return;
    }
    this._rect = next;
    this.events.emit("changed", next);
  }

  contains(x: number, y: number): boolean {
    const r = this._rect;
    return !!r && x >= r.x && y >= r.y && x < r.x + r.width && y < r.y + r.height;
  }
}

/** Undoable selection change (paired with pixel edits in move/paste commands). */
export class SetSelectionCommand implements ICommand {
  readonly label = "Select";

  constructor(
    private readonly selection: Selection,
    private readonly from: Rect | null,
    private readonly to: Rect | null
  ) {}

  execute(): void {
    this.selection.set(this.to);
  }

  undo(): void {
    this.selection.set(this.from);
  }
}

/** The rect from `a` to `b` (inclusive), clipped to the layer. */
export function rectBetween(
  a: Position,
  b: Position,
  layer: { width: number; height: number }
): Rect | null {
  const x0 = Math.max(0, Math.min(a.x, b.x));
  const y0 = Math.max(0, Math.min(a.y, b.y));
  const x1 = Math.min(layer.width - 1, Math.max(a.x, b.x));
  const y1 = Math.min(layer.height - 1, Math.max(a.y, b.y));
  return x1 < x0 || y1 < y0 ? null : { x: x0, y: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

/** Copies the cells under `rect` (cells outside the layer read as empty). */
export function readRegion(layer: GridLayer<CellBuffer>, rect: Rect): Region {
  const values: number[] = [];
  for (let y = 0; y < rect.height; y++) {
    for (let x = 0; x < rect.width; x++) values.push(layer.get(rect.x + x, rect.y + y));
  }
  return { width: rect.width, height: rect.height, values };
}

/** Changes that clear `rect` to the layer's empty value. */
export function clearRegionChanges(layer: GridLayer<CellBuffer>, rect: Rect): CellChange<number>[] {
  const changes: CellChange<number>[] = [];
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    for (let x = rect.x; x < rect.x + rect.width; x++) {
      if (!layer.isWithinBounds(x, y)) continue;
      const oldValue = layer.get(x, y);
      if (oldValue !== layer.emptyValue)
        changes.push({ x, y, oldValue, newValue: layer.emptyValue });
    }
  }
  return changes;
}

/**
 * Changes that paste `region` with its top-left at `at`. Empty cells in the
 * region are skipped, so transparent areas don't erase what's underneath.
 */
export function pasteRegionChanges(
  layer: GridLayer<CellBuffer>,
  region: Region,
  at: Position
): CellChange<number>[] {
  const changes: CellChange<number>[] = [];
  for (let y = 0; y < region.height; y++) {
    for (let x = 0; x < region.width; x++) {
      const value = region.values[y * region.width + x];
      const tx = at.x + x;
      const ty = at.y + y;
      if (value === layer.emptyValue || !layer.isWithinBounds(tx, ty)) continue;
      const oldValue = layer.get(tx, ty);
      if (oldValue !== value) changes.push({ x: tx, y: ty, oldValue, newValue: value });
    }
  }
  return changes;
}

/**
 * Drag to select a rectangle; drag inside the selection to move its pixels
 * (live preview, one undo step that also restores the selection). A click
 * without dragging clears the selection.
 */
export class SelectTool<Buffer extends CellBuffer = CellBuffer> extends Tool<Buffer> {
  public override readonly modifiesLayer = false;
  private mode: "select" | "move" | null = null;
  private anchor: Position = { x: 0, y: 0 };
  private dragged = false;
  private source: Rect | null = null;
  private block: Region | null = null;
  private applied: CellChange<number>[] = [];
  private startSelection: Rect | null = null;

  constructor(
    private readonly selection: Selection,
    name: ToolType = "select",
    private readonly options: {
      /** Called when a move starts on a layer that can't be edited (locked, hidden). */
      onBlocked?: (layer: GridLayer<CellBuffer>) => void;
    } = {}
  ) {
    super(name, "crosshair");
  }

  onMouseDown(coords: Position, ctx: ToolContext<Buffer>): void {
    this.anchor = coords;
    this.dragged = false;
    this.startSelection = this.selection.rect;
    const rect = this.selection.rect;
    const inside = !!rect && this.selection.contains(coords.x, coords.y);
    if (inside && !ctx.layer.isEditable) {
      // Keep the selection (a new drag would silently replace it) and say why.
      this.mode = null;
      this.options.onBlocked?.(ctx.layer);
      return;
    }
    if (rect && inside) {
      this.mode = "move";
      this.source = rect;
      this.block = readRegion(ctx.layer, rect);
      this.applied = [];
    } else {
      this.mode = "select";
      this.selection.set(rectBetween(coords, coords, ctx.layer));
    }
  }

  onMouseMove(coords: Position, ctx: ToolContext<Buffer>): void {
    if (!this.mode || !ctx.isDrawing) return;
    if (coords.x !== this.anchor.x || coords.y !== this.anchor.y) this.dragged = true;
    if (this.mode === "select") {
      this.selection.set(rectBetween(this.anchor, coords, ctx.layer));
    } else {
      this.previewMove(coords.x - this.anchor.x, coords.y - this.anchor.y, ctx);
    }
  }

  onMouseUp(coords: Position, ctx: ToolContext<Buffer>): void {
    if (this.mode === "select") {
      if (!this.dragged) this.selection.set(null);
    } else if (this.mode === "move") {
      this.previewMove(coords.x - this.anchor.x, coords.y - this.anchor.y, ctx);
      if (this.applied.length > 0) {
        ctx.history.record(
          new CompositeCommand(
            [
              new DrawCommand<Buffer>(ctx.doc, ctx.layer.id, this.applied, "Move pixels"),
              new SetSelectionCommand(this.selection, this.startSelection, this.selection.rect),
            ],
            "Move selection"
          )
        );
      }
    }
    this.reset();
  }

  cancel(ctx: ToolContext<Buffer>): void {
    if (this.mode === "move" && this.applied.length) {
      ctx.layer.applyChanges(this.applied, "backward");
      ctx.doc.notifyCellsChanged(ctx.layer.id);
    }
    this.selection.set(this.startSelection);
    this.reset();
  }

  private reset(): void {
    this.mode = null;
    this.source = null;
    this.block = null;
    this.applied = [];
  }

  private previewMove(dx: number, dy: number, ctx: ToolContext<Buffer>): void {
    const { source, block } = this;
    if (!source || !block) return;
    const { layer } = ctx;
    if (this.applied.length) layer.applyChanges(this.applied, "backward");

    // Lift the pixels, then drop them at the offset; keep one change per cell
    // with its original value so undo restores everything.
    const byIndex = new Map<number, CellChange<number>>();
    const apply = (changes: CellChange<number>[]) => {
      for (const change of changes) {
        const index = layer.getIndex(change.x, change.y);
        const existing = byIndex.get(index);
        if (existing) existing.newValue = change.newValue;
        else byIndex.set(index, { ...change });
        layer.set(change.x, change.y, change.newValue);
      }
    };
    apply(clearRegionChanges(layer, source));
    apply(pasteRegionChanges(layer, block, { x: source.x + dx, y: source.y + dy }));
    this.applied = [...byIndex.values()].filter((c) => c.oldValue !== c.newValue);
    ctx.doc.notifyCellsChanged(layer.id);
    this.selection.set({ ...source, x: source.x + dx, y: source.y + dy });
  }
}

/** Pixel transforms for a region (flip and quarter turns). */
export type RegionTransform = "flipX" | "flipY" | "rotateCW" | "rotateCCW";

/**
 * Returns `region` flipped or rotated. Rotations swap width and height;
 * a clockwise turn moves the top-left cell to the top-right.
 */
export function transformRegion(region: Region, transform: RegionTransform): Region {
  const { width, height, values } = region;
  const rotate = transform === "rotateCW" || transform === "rotateCCW";
  const outW = rotate ? height : width;
  const outH = rotate ? width : height;
  const out = Array.from({ length: outW * outH }, () => 0);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let nx = x;
      let ny = y;
      if (transform === "flipX") nx = width - 1 - x;
      else if (transform === "flipY") ny = height - 1 - y;
      else if (transform === "rotateCW") {
        nx = height - 1 - y;
        ny = x;
      } else {
        nx = y;
        ny = width - 1 - x;
      }
      out[ny * outW + nx] = values[y * width + x];
    }
  }
  return { width: outW, height: outH, values: out };
}
