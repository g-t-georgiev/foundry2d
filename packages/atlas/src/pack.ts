/**
 * Rectangle packing for spritesheets: MaxRects (Jukka Jylänki's algorithm,
 * with its usual fit heuristics), shelves, grids and strips. Works on sizes
 * only; `buildAtlas` turns the result into images.
 *
 * Sizes include extrusion but not padding: `padding` is the gap between
 * sprites, `border` the margin around the sheet edge.
 */

export interface PackSize {
  w: number;
  h: number;
}

export interface Placement {
  /** Index into the sizes passed in. */
  index: number;
  /** Sheet (bin) number. */
  bin: number;
  /** Top-left of the sprite on its sheet (inside the border). */
  x: number;
  y: number;
  /** Stored turned 90° clockwise (its width and height swap on the sheet). */
  rotated: boolean;
}

export interface PackResult {
  bins: { width: number; height: number }[];
  /** One per input size, in input order. */
  placements: Placement[];
}

export type PackAlgorithm = "maxrects" | "shelf" | "grid" | "horizontal" | "vertical";

/** MaxRects free-rectangle choice: best short side, best long side, best area, or bottom-left. */
export type MaxRectsHeuristic = "short-side" | "long-side" | "area" | "bottom-left";

export interface PackOptions {
  algorithm: PackAlgorithm;
  heuristic?: MaxRectsHeuristic;
  /** MaxRects and shelf: may turn sprites 90° to fit better. */
  allowRotation?: boolean;
  /** Pixels between sprites. */
  padding?: number;
  /** Pixels around the sheet edge. */
  border?: number;
  /** Largest sheet; sprites that don't fit go on further sheets. */
  maxWidth?: number;
  maxHeight?: number;
  /** Sheet sizes rounded up to powers of two. */
  powerOfTwo?: boolean;
  /** Square sheets. */
  square?: boolean;
  /** Grid columns (default: as square as possible). */
  columns?: number;
}

const DEFAULT_MAX = 4096;

interface Free {
  x: number;
  y: number;
  w: number;
  h: number;
}

const nextPow2 = (n: number) => (n <= 1 ? 1 : 2 ** Math.ceil(Math.log2(n)));
const floorPow2 = (n: number) => (n < 1 ? 0 : 2 ** Math.floor(Math.log2(n)));

/** One MaxRects bin of a fixed size. */
class MaxRectsBin {
  private free: Free[];
  /** Right and bottom edges of everything placed (for shrinking the sheet afterwards). */
  usedW = 0;
  usedH = 0;

  constructor(
    readonly width: number,
    readonly height: number,
    private readonly heuristic: MaxRectsHeuristic,
    private readonly rotate: boolean
  ) {
    this.free = [{ x: 0, y: 0, w: width, h: height }];
  }

  insert(w: number, h: number): { x: number; y: number; rotated: boolean } | null {
    let best: { x: number; y: number; w: number; h: number; s1: number; s2: number } | null = null;
    const consider = (rw: number, rh: number) => {
      for (const f of this.free) {
        if (rw > f.w || rh > f.h) continue;
        const leftW = f.w - rw;
        const leftH = f.h - rh;
        let s1: number;
        let s2: number;
        switch (this.heuristic) {
          case "long-side":
            s1 = Math.max(leftW, leftH);
            s2 = Math.min(leftW, leftH);
            break;
          case "area":
            s1 = f.w * f.h - rw * rh;
            s2 = Math.min(leftW, leftH);
            break;
          case "bottom-left":
            s1 = f.y + rh;
            s2 = f.x;
            break;
          default:
            s1 = Math.min(leftW, leftH);
            s2 = Math.max(leftW, leftH);
        }
        if (!best || s1 < best.s1 || (s1 === best.s1 && s2 < best.s2)) {
          best = { x: f.x, y: f.y, w: rw, h: rh, s1, s2 };
        }
      }
    };
    consider(w, h);
    if (this.rotate && w !== h) consider(h, w);
    if (!best) return null;
    const placed: { x: number; y: number; w: number; h: number } = best;
    this.split(placed);
    this.usedW = Math.max(this.usedW, placed.x + placed.w);
    this.usedH = Math.max(this.usedH, placed.y + placed.h);
    return { x: placed.x, y: placed.y, rotated: placed.w !== w };
  }

  /** Splits every free rectangle the placed one overlaps, then drops contained ones. */
  private split(r: Free): void {
    const next: Free[] = [];
    for (const f of this.free) {
      if (r.x >= f.x + f.w || r.x + r.w <= f.x || r.y >= f.y + f.h || r.y + r.h <= f.y) {
        next.push(f);
        continue;
      }
      if (r.x > f.x) next.push({ x: f.x, y: f.y, w: r.x - f.x, h: f.h });
      if (r.x + r.w < f.x + f.w) {
        next.push({ x: r.x + r.w, y: f.y, w: f.x + f.w - (r.x + r.w), h: f.h });
      }
      if (r.y > f.y) next.push({ x: f.x, y: f.y, w: f.w, h: r.y - f.y });
      if (r.y + r.h < f.y + f.h) {
        next.push({ x: f.x, y: r.y + r.h, w: f.w, h: f.y + f.h - (r.y + r.h) });
      }
    }
    // Prune rectangles contained in another.
    this.free = next.filter(
      (a, i) =>
        !next.some(
          (b, j) =>
            i !== j &&
            a.x >= b.x &&
            a.y >= b.y &&
            a.x + a.w <= b.x + b.w &&
            a.y + a.h <= b.y + b.h &&
            // Of two identical rectangles keep the first.
            (a.x !== b.x || a.y !== b.y || a.w !== b.w || a.h !== b.h || j < i)
        )
    );
  }
}

/** Sheet size for the space used: border added, then rounded and squared per the options. */
function sheetSize(usedW: number, usedH: number, options: Required<PackOptions>) {
  let width = usedW + options.border * 2;
  let height = usedH + options.border * 2;
  if (options.powerOfTwo) {
    width = nextPow2(width);
    height = nextPow2(height);
  }
  if (options.square) width = height = Math.max(width, height);
  return { width, height };
}

function withDefaults(options: PackOptions): Required<PackOptions> {
  const o: Required<PackOptions> = {
    heuristic: "short-side",
    allowRotation: false,
    padding: 0,
    border: 0,
    maxWidth: DEFAULT_MAX,
    maxHeight: DEFAULT_MAX,
    powerOfTwo: false,
    square: false,
    columns: 0,
    ...options,
  };
  o.padding = Math.max(0, Math.floor(o.padding));
  o.border = Math.max(0, Math.floor(o.border));
  o.maxWidth = Math.floor(o.maxWidth);
  o.maxHeight = Math.floor(o.maxHeight);
  // The largest sheet these options can really produce, so rounding never goes past the maximum:
  // square sheets are limited by the smaller side, power-of-two ones by the next lower power.
  if (o.square) o.maxWidth = o.maxHeight = Math.min(o.maxWidth, o.maxHeight);
  if (o.powerOfTwo) {
    o.maxWidth = floorPow2(o.maxWidth);
    o.maxHeight = floorPow2(o.maxHeight);
  }
  return o;
}

const tooBig = (w: number, h: number) =>
  new Error(`A ${w}×${h} sprite is bigger than the maximum sheet size.`);

/** Inner capacity of a sheet for padded sprites (the last sprite needs no trailing gap). */
const capacity = (max: number, o: Required<PackOptions>) => max - o.border * 2 + o.padding;

/**
 * MaxRects into as few sheets as possible: each sheet starts at the smallest
 * near-square size that could hold the remaining sprites and grows until
 * they fit or it reaches the maximum; what doesn't fit goes on the next.
 */
function packMaxRects(sizes: PackSize[], o: Required<PackOptions>): PackResult {
  const pad = o.padding;
  const capW = capacity(o.maxWidth, o);
  const capH = capacity(o.maxHeight, o);
  const order = sizes
    .map((s, i) => ({ i, w: s.w + pad, h: s.h + pad }))
    .sort((a, b) => Math.max(b.w, b.h) - Math.max(a.w, a.h) || b.w * b.h - a.w * a.h);
  for (const s of order) {
    const fits = (s.w <= capW && s.h <= capH) || (o.allowRotation && s.h <= capW && s.w <= capH);
    if (!fits) throw tooBig(s.w - pad, s.h - pad);
  }

  /** The space inside the sheet that a `w × h` space rounds up to (never past the maximum). */
  const roundUp = (w: number, h: number) => {
    const sheet = sheetSize(w - pad, h - pad, o);
    return {
      w: Math.min(capW, capacity(sheet.width, o)),
      h: Math.min(capH, capacity(sheet.height, o)),
    };
  };

  const bins: PackResult["bins"] = [];
  const placements: Placement[] = [];
  let remaining = order;
  while (remaining.length) {
    const area = remaining.reduce((sum, s) => sum + s.w * s.h, 0);
    const narrowest = (s: PackSize, side: number) => (o.allowRotation ? Math.min(s.w, s.h) : side);
    let w = Math.max(...remaining.map((s) => narrowest(s, s.w)), Math.ceil(Math.sqrt(area)));
    w = Math.min(capW, w);
    let h = Math.max(...remaining.map((s) => narrowest(s, s.h)), Math.ceil(area / w));
    h = Math.min(capH, h);
    for (;;) {
      const space = roundUp(w, h);
      const bin = new MaxRectsBin(space.w, space.h, o.heuristic, o.allowRotation);
      const placed: {
        s: (typeof order)[number];
        at: { x: number; y: number; rotated: boolean };
      }[] = [];
      const left: typeof order = [];
      for (const s of remaining) {
        const at = bin.insert(s.w, s.h);
        if (at) placed.push({ s, at });
        else left.push(s);
      }
      const full = w >= capW && h >= capH;
      if (left.length === 0 || full) {
        if (placed.length === 0) throw new Error("A sprite could not be placed.");
        const index = bins.length;
        bins.push(sheetSize(bin.usedW - pad, bin.usedH - pad, o));
        for (const { s, at } of placed) {
          placements[s.i] = {
            index: s.i,
            bin: index,
            x: at.x + o.border,
            y: at.y + o.border,
            rotated: at.rotated,
          };
        }
        remaining = left;
        break;
      }
      // Grow the shorter side by about 10%, or the other one when it is at its limit.
      const growWidth = w < capW && (w <= h || h >= capH);
      if (growWidth) w = Math.min(capW, Math.ceil(w * 1.1) + 1);
      else h = Math.min(capH, Math.ceil(h * 1.1) + 1);
    }
  }
  return { bins, placements };
}

/** Shelves (rows), tallest sprites first, rows no wider than about the square root of the area. */
function packShelf(sizes: PackSize[], o: Required<PackOptions>): PackResult {
  const pad = o.padding;
  const capW = capacity(o.maxWidth, o);
  const capH = capacity(o.maxHeight, o);
  const order = sizes
    .map((s, i) => {
      // With rotation, lay each sprite on its long side to keep shelves low (where that fits).
      const turnedFits = s.h + pad <= capW && s.w + pad <= capH;
      const uprightFits = s.w + pad <= capW && s.h + pad <= capH;
      const rotated = o.allowRotation && turnedFits && (s.h > s.w || !uprightFits);
      return { i, w: (rotated ? s.h : s.w) + pad, h: (rotated ? s.w : s.h) + pad, rotated };
    })
    .sort((a, b) => b.h - a.h || b.w - a.w);
  const area = order.reduce((sum, s) => sum + s.w * s.h, 0);
  const limit = Math.min(
    capW,
    Math.max(...order.map((s) => s.w), Math.ceil(Math.sqrt(area) * 1.1))
  );

  const bins: PackResult["bins"] = [];
  const placements: Placement[] = [];
  let bin = 0;
  let x = 0;
  let y = 0;
  let rowH = 0;
  let usedW = 0;
  const close = () => {
    bins.push(sheetSize(usedW - pad, y + rowH - pad, o));
  };
  for (const s of order) {
    if (s.w > capW || s.h > capH) throw tooBig(s.w - pad, s.h - pad);
    if (x > 0 && x + s.w > limit) {
      y += rowH;
      x = 0;
      rowH = 0;
    }
    if (y + s.h > capH) {
      close();
      bin++;
      x = y = rowH = usedW = 0;
    }
    placements[s.i] = { index: s.i, bin, x: x + o.border, y: y + o.border, rotated: s.rotated };
    x += s.w;
    rowH = Math.max(rowH, s.h);
    usedW = Math.max(usedW, x);
  }
  if (order.length) close();
  return { bins, placements };
}

/** Uniform cells in input order: a grid, one row, or one column. */
function packCells(sizes: PackSize[], o: Required<PackOptions>): PackResult {
  const pad = o.padding;
  const cellW = Math.max(...sizes.map((s) => s.w)) + pad;
  const cellH = Math.max(...sizes.map((s) => s.h)) + pad;
  const capW = capacity(o.maxWidth, o);
  const capH = capacity(o.maxHeight, o);
  const fitCols = Math.max(1, Math.floor(capW / cellW));
  const fitRows = Math.max(1, Math.floor(capH / cellH));
  if (cellW > capW || cellH > capH) throw tooBig(cellW - pad, cellH - pad);
  const n = sizes.length;
  let columns =
    o.algorithm === "horizontal"
      ? n
      : o.algorithm === "vertical"
        ? 1
        : o.columns > 0
          ? o.columns
          : Math.ceil(Math.sqrt(n));
  columns = Math.max(1, Math.min(columns, fitCols));
  const rowsPerSheet = o.algorithm === "horizontal" ? 1 : fitRows;
  const perSheet = columns * rowsPerSheet;

  const bins: PackResult["bins"] = [];
  const placements: Placement[] = sizes.map((_, i) => {
    const bin = Math.floor(i / perSheet);
    const k = i % perSheet;
    return {
      index: i,
      bin,
      x: o.border + (k % columns) * cellW,
      y: o.border + Math.floor(k / columns) * cellH,
      rotated: false,
    };
  });
  for (let b = 0; b * perSheet < n; b++) {
    const count = Math.min(perSheet, n - b * perSheet);
    const cols = Math.min(columns, count);
    const rows = Math.ceil(count / columns);
    bins.push(sheetSize(cols * cellW - pad, rows * cellH - pad, o));
  }
  return { bins, placements };
}

/** Packs `sizes` into one or more sheets. */
export function pack(sizes: PackSize[], options: PackOptions): PackResult {
  if (sizes.length === 0) return { bins: [], placements: [] };
  const o = withDefaults(options);
  if (o.algorithm === "maxrects") return packMaxRects(sizes, o);
  if (o.algorithm === "shelf") return packShelf(sizes, o);
  return packCells(sizes, o);
}
