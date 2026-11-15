import type { Position, Rect } from "../types";
import type { CellBuffer, CellChange, GridLayer } from "../document";
import type { ICommand } from "../history/types";
import type { ToolContext, ToolType } from "./types";
import { Tool } from "./Tool";
import { DrawCommand } from "../history/DrawCommand";
import { CompositeCommand } from "../history/CompositeCommand";
import EventEmitter from "../utils/EventEmitter";
import { combineShapes, selectionOp, type SelectionOp } from "./selectionShapes";

/** A rectangular block of cell values, row-major (clipboard contents, moved pixels). */
export interface Region {
  width: number;
  height: number;
  values: number[];
}

/**
 * A selection's shape: its bounding rectangle and, for non-rectangular
 * selections (lasso, magic wand), a mask with one byte per cell of the
 * rectangle (row-major, 1 = selected). `mask: null` means the whole
 * rectangle.
 */
export interface SelectionShape {
  rect: Rect;
  mask: Uint8Array | null;
}

const sameRect = (a: Rect, b: Rect) =>
  a.x === b.x && a.y === b.y && a.width === b.width && a.height === b.height;

const sameMask = (a: Uint8Array | null, b: Uint8Array | null) => {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
};

/**
 * The current selection, shared by the selection tools, clipboard actions
 * and overlays. Rectangular selections have no mask; lasso and magic-wand
 * selections carry one (see `SelectionShape`).
 */
export class Selection {
  readonly events = new EventEmitter<{ changed: (rect: Rect | null) => void }>();
  private _rect: Rect | null = null;
  private _mask: Uint8Array | null = null;

  get rect(): Rect | null {
    return this._rect;
  }

  /** Per-cell mask of the bounding rect, or `null` for a plain rectangle. */
  get mask(): Uint8Array | null {
    return this._mask;
  }

  /** A copy of the current shape (for undo), or `null` when nothing is selected. */
  get shape(): SelectionShape | null {
    return this._rect ? { rect: { ...this._rect }, mask: this._mask?.slice() ?? null } : null;
  }

  /** Selects a rectangle, optionally with a mask of the same size. */
  set(rect: Rect | null, mask: Uint8Array | null = null): void {
    const next = rect && rect.width > 0 && rect.height > 0 ? { ...rect } : null;
    const nextMask = next && mask && !mask.every((v) => v === 1) ? mask.slice() : null;
    const prev = this._rect;
    if (
      (prev === next || (prev && next && sameRect(prev, next))) &&
      sameMask(this._mask, nextMask)
    ) {
      return;
    }
    this._rect = next;
    this._mask = nextMask;
    this.events.emit("changed", next);
  }

  setShape(shape: SelectionShape | null): void {
    this.set(shape?.rect ?? null, shape?.mask ?? null);
  }

  contains(x: number, y: number): boolean {
    const r = this._rect;
    if (!r || x < r.x || y < r.y || x >= r.x + r.width || y >= r.y + r.height) return false;
    return !this._mask || this._mask[(y - r.y) * r.width + (x - r.x)] === 1;
  }
}

/** Normalises the `from`/`to` of a selection change (a rect means no mask). */
const toShape = (value: Rect | SelectionShape | null): SelectionShape | null =>
  value === null ? null : "rect" in value ? value : { rect: value, mask: null };

/** Undoable selection change (paired with pixel edits in move/paste commands). */
export class SetSelectionCommand implements ICommand {
  readonly label = "Select";

  private readonly from: SelectionShape | null;
  private readonly to: SelectionShape | null;

  /** `from` and `to` are rectangles or full shapes (pass `selection.shape` to keep masks). */
  constructor(
    private readonly selection: Selection,
    from: Rect | SelectionShape | null,
    to: Rect | SelectionShape | null
  ) {
    this.from = toShape(from);
    this.to = toShape(to);
  }

  execute(): void {
    this.selection.setShape(this.to);
  }

  undo(): void {
    this.selection.setShape(this.from);
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

/**
 * Copies the cells under `rect` (cells outside the layer read as empty).
 * With a `mask`, unselected cells read as empty too.
 */
export function readRegion(
  layer: GridLayer<CellBuffer>,
  rect: Rect,
  mask: Uint8Array | null = null
): Region {
  const values: number[] = [];
  for (let y = 0; y < rect.height; y++) {
    for (let x = 0; x < rect.width; x++) {
      const selected = !mask || mask[y * rect.width + x] === 1;
      values.push(selected ? layer.get(rect.x + x, rect.y + y) : layer.emptyValue);
    }
  }
  return { width: rect.width, height: rect.height, values };
}

/** Changes that clear `rect` (only its selected cells, with a `mask`) to the empty value. */
export function clearRegionChanges(
  layer: GridLayer<CellBuffer>,
  rect: Rect,
  mask: Uint8Array | null = null
): CellChange<number>[] {
  const changes: CellChange<number>[] = [];
  for (let y = rect.y; y < rect.y + rect.height; y++) {
    for (let x = rect.x; x < rect.x + rect.width; x++) {
      if (!layer.isWithinBounds(x, y)) continue;
      if (mask && mask[(y - rect.y) * rect.width + (x - rect.x)] !== 1) continue;
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

/** A resize handle of a selection: a corner or the middle of an edge. */
export type SelectionHandle = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

/**
 * Where the resize handles of a selection sit: in the cells just outside
 * its corners and edge midpoints, so a press there can't be confused with
 * one inside (which moves the pixels).
 */
export function selectionHandles(rect: Rect): { id: SelectionHandle; x: number; y: number }[] {
  const left = rect.x - 1;
  const right = rect.x + rect.width;
  const top = rect.y - 1;
  const bottom = rect.y + rect.height;
  const midX = rect.x + Math.floor((rect.width - 1) / 2);
  const midY = rect.y + Math.floor((rect.height - 1) / 2);
  return [
    { id: "nw", x: left, y: top },
    { id: "n", x: midX, y: top },
    { id: "ne", x: right, y: top },
    { id: "e", x: right, y: midY },
    { id: "se", x: right, y: bottom },
    { id: "s", x: midX, y: bottom },
    { id: "sw", x: left, y: bottom },
    { id: "w", x: left, y: midY },
  ];
}

/** `region` scaled to `width` × `height` cells (nearest neighbour). */
export function scaleRegion(region: Region, width: number, height: number): Region {
  const values: number[] = [];
  for (let y = 0; y < height; y++) {
    const sy = Math.min(region.height - 1, Math.floor(((y + 0.5) * region.height) / height));
    for (let x = 0; x < width; x++) {
      const sx = Math.min(region.width - 1, Math.floor(((x + 0.5) * region.width) / width));
      values.push(region.values[sy * region.width + sx]);
    }
  }
  return { width, height, values };
}

/**
 * Drag to select a rectangle; drag inside the selection to move its pixels
 * (live preview, one undo step that also restores the selection). Shift
 * adds the rectangle to the selection and Alt subtracts it (they never
 * move). A click without dragging clears the selection.
 */
export class SelectTool<Buffer extends CellBuffer = CellBuffer> extends Tool<Buffer> {
  public override readonly modifiesLayer = false;
  private mode: "select" | "move" | "scale" | null = null;
  private handle: SelectionHandle | null = null;
  private anchor: Position = { x: 0, y: 0 };
  private dragged = false;
  private source: Rect | null = null;
  private block: Region | null = null;
  private applied: CellChange<number>[] = [];
  private startSelection: SelectionShape | null = null;
  /** The mask carried along while moving a non-rectangular selection. */
  private moveMask: Uint8Array | null = null;
  private op: SelectionOp = "replace";

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
    this.startSelection = this.selection.shape;
    this.op = selectionOp(ctx);
    const rect = this.selection.rect;
    // With Shift or Alt the press always draws a new rectangle to combine.
    const handle =
      this.op === "replace" && rect
        ? (selectionHandles(rect).find((h) => h.x === coords.x && h.y === coords.y)?.id ?? null)
        : null;
    const inside = this.op === "replace" && !!rect && this.selection.contains(coords.x, coords.y);
    if ((handle || inside) && !ctx.layer.isEditable) {
      // Keep the selection (a new drag would silently replace it) and say why.
      this.mode = null;
      this.options.onBlocked?.(ctx.layer);
      return;
    }
    if (rect && handle) {
      this.mode = "scale";
      this.handle = handle;
      this.source = rect;
      this.moveMask = this.selection.mask?.slice() ?? null;
      this.block = readRegion(ctx.layer, rect, this.moveMask);
      this.applied = [];
      return;
    }
    if (rect && inside) {
      this.mode = "move";
      this.source = rect;
      this.moveMask = this.selection.mask?.slice() ?? null;
      this.block = readRegion(ctx.layer, rect, this.moveMask);
      this.applied = [];
    } else {
      this.mode = "select";
      this.selectTo(coords, ctx);
    }
  }

  onMouseMove(coords: Position, ctx: ToolContext<Buffer>): void {
    if (!this.mode || !ctx.isDrawing) return;
    if (coords.x !== this.anchor.x || coords.y !== this.anchor.y) this.dragged = true;
    if (this.mode === "select") {
      this.selectTo(coords, ctx);
    } else if (this.mode === "scale") {
      this.previewScale(coords, ctx);
    } else {
      this.previewMove(coords.x - this.anchor.x, coords.y - this.anchor.y, ctx);
    }
  }

  onMouseUp(coords: Position, ctx: ToolContext<Buffer>): void {
    if (this.mode === "select") {
      // A plain click clears; with Shift or Alt it leaves the selection as it was.
      if (!this.dragged) {
        this.selection.setShape(this.op === "replace" ? null : this.startSelection);
      }
    } else if (this.mode === "move" || this.mode === "scale") {
      if (this.mode === "move") {
        this.previewMove(coords.x - this.anchor.x, coords.y - this.anchor.y, ctx);
      } else if (this.dragged) {
        this.previewScale(coords, ctx);
      }
      if (this.applied.length > 0) {
        const scaled = this.mode === "scale";
        ctx.history.record(
          new CompositeCommand(
            [
              new DrawCommand<Buffer>(
                ctx.doc,
                ctx.layer.id,
                this.applied,
                scaled ? "Scale pixels" : "Move pixels"
              ),
              new SetSelectionCommand(this.selection, this.startSelection, this.selection.shape),
            ],
            scaled ? "Scale selection" : "Move selection"
          )
        );
      }
    }
    this.reset();
  }

  cancel(ctx: ToolContext<Buffer>): void {
    if ((this.mode === "move" || this.mode === "scale") && this.applied.length) {
      ctx.layer.applyChanges(this.applied, "backward");
      ctx.doc.notifyCellsChanged(ctx.layer.id);
    }
    this.selection.setShape(this.startSelection);
    this.reset();
  }

  /** The rectangle from the anchor to `coords`, combined with the selection at the press. */
  private selectTo(coords: Position, ctx: ToolContext<Buffer>): void {
    const rect = rectBetween(this.anchor, coords, ctx.layer);
    const shape = rect ? { rect, mask: null } : null;
    this.selection.setShape(combineShapes(this.startSelection, shape, this.op, ctx.layer));
  }

  private reset(): void {
    this.mode = null;
    this.handle = null;
    this.source = null;
    this.block = null;
    this.applied = [];
  }

  /**
   * Scales the lifted pixels into the rectangle the dragged handle gives:
   * the handle's edges follow the pointer (the handle sits one cell outside),
   * the opposite edges stay, and the size never drops below one cell.
   */
  private previewScale(coords: Position, ctx: ToolContext<Buffer>): void {
    const { source, block, handle } = this;
    if (!source || !block || !handle) return;
    let left = source.x;
    let top = source.y;
    let right = source.x + source.width - 1;
    let bottom = source.y + source.height - 1;
    if (handle.includes("w")) left = Math.min(coords.x + 1, right);
    if (handle.includes("e")) right = Math.max(coords.x - 1, left);
    if (handle.includes("n")) top = Math.min(coords.y + 1, bottom);
    if (handle.includes("s")) bottom = Math.max(coords.y - 1, top);
    const rect = { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };

    const { layer } = ctx;
    if (this.applied.length) layer.applyChanges(this.applied, "backward");
    const scaled = scaleRegion(block, rect.width, rect.height);
    const mask = this.moveMask
      ? Uint8Array.from(
          scaleRegion(
            { width: source.width, height: source.height, values: Array.from(this.moveMask) },
            rect.width,
            rect.height
          ).values
        )
      : null;
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
    apply(clearRegionChanges(layer, source, this.moveMask));
    apply(pasteRegionChanges(layer, scaled, { x: rect.x, y: rect.y }));
    this.applied = [...byIndex.values()].filter((c) => c.oldValue !== c.newValue);
    ctx.doc.notifyCellsChanged(layer.id);
    this.selection.set(rect, mask);
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
    apply(clearRegionChanges(layer, source, this.moveMask));
    apply(pasteRegionChanges(layer, block, { x: source.x + dx, y: source.y + dy }));
    this.applied = [...byIndex.values()].filter((c) => c.oldValue !== c.newValue);
    ctx.doc.notifyCellsChanged(layer.id);
    this.selection.set({ ...source, x: source.x + dx, y: source.y + dy }, this.moveMask);
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
