import { blit, createImage, cropImage, opaqueBounds, type Rect, type RgbaImage } from "./raster";

export type SheetLayout = "horizontal" | "vertical" | "grid" | "packed";

export interface SheetOptions {
  layout: SheetLayout;
  /** Columns for the grid layout (default: as square as possible). */
  columns?: number;
  /** Empty pixels between sprites (and around the sheet edge). */
  padding: number;
  /** Pixels of each sprite's edge repeated outward, against texture bleeding. */
  extrude: number;
  /** Cut transparent borders off each frame (offsets are kept in the JSON). */
  trim: boolean;
}

export interface SheetInput {
  /** Frame key in the JSON, e.g. "walk_0.png". */
  name: string;
  image: RgbaImage;
  /** Milliseconds. */
  duration: number;
}

/** One frame's placement, using TexturePacker's field names. */
export interface SheetFrame {
  filename: string;
  frame: { x: number; y: number; w: number; h: number };
  rotated: false;
  trimmed: boolean;
  spriteSourceSize: { x: number; y: number; w: number; h: number };
  sourceSize: { w: number; h: number };
  duration: number;
}

export interface Spritesheet {
  image: RgbaImage;
  frames: SheetFrame[];
}

interface Piece {
  input: SheetInput;
  image: RgbaImage;
  offset: { x: number; y: number };
  trimmed: boolean;
}

function prepare(input: SheetInput, trim: boolean): Piece {
  const full = input.image;
  if (!trim) return { input, image: full, offset: { x: 0, y: 0 }, trimmed: false };
  // A fully transparent frame still needs a 1×1 slot to be addressable.
  const bounds = opaqueBounds(full) ?? { x: 0, y: 0, width: 1, height: 1 };
  const trimmed = bounds.width !== full.width || bounds.height !== full.height;
  return {
    input,
    image: trimmed ? cropImage(full, bounds) : full,
    offset: { x: bounds.x, y: bounds.y },
    trimmed,
  };
}

/** Positions for `sizes` (cell content sizes incl. extrusion) in the chosen layout. */
function place(
  sizes: { w: number; h: number }[],
  options: SheetOptions
): { positions: { x: number; y: number }[]; width: number; height: number } {
  const pad = options.padding;
  const n = sizes.length;

  if (options.layout === "packed") {
    // Shelf packing: tallest first, rows no wider than ~sqrt(total area).
    const order = sizes
      .map((_, i) => i)
      .sort((a, b) => sizes[b].h - sizes[a].h || sizes[b].w - sizes[a].w);
    const area = sizes.reduce((sum, s) => sum + (s.w + pad) * (s.h + pad), 0);
    const maxW = Math.max(...sizes.map((s) => s.w));
    const limit = Math.max(maxW + pad * 2, Math.ceil(Math.sqrt(area) * 1.1) + pad);
    const positions: { x: number; y: number }[] = Array.from({ length: n }, () => ({ x: 0, y: 0 }));
    let x = pad;
    let y = pad;
    let rowH = 0;
    let width = 0;
    for (const i of order) {
      const s = sizes[i];
      if (x > pad && x + s.w + pad > limit) {
        y += rowH + pad;
        x = pad;
        rowH = 0;
      }
      positions[i] = { x, y };
      x += s.w + pad;
      rowH = Math.max(rowH, s.h);
      width = Math.max(width, x);
    }
    return { positions, width, height: y + rowH + pad };
  }

  // Uniform cells for horizontal, vertical and grid layouts.
  const cellW = Math.max(...sizes.map((s) => s.w));
  const cellH = Math.max(...sizes.map((s) => s.h));
  const columns =
    options.layout === "horizontal"
      ? n
      : options.layout === "vertical"
        ? 1
        : Math.max(1, Math.min(n, options.columns ?? Math.ceil(Math.sqrt(n))));
  const rows = Math.ceil(n / columns);
  const positions = sizes.map((_, i) => ({
    x: pad + (i % columns) * (cellW + pad),
    y: pad + Math.floor(i / columns) * (cellH + pad),
  }));
  return {
    positions,
    width: pad + columns * (cellW + pad),
    height: pad + rows * (cellH + pad),
  };
}

/** Repeats the outermost pixels of the rect `r` outward by `e` pixels. */
function extrudeEdges(sheet: RgbaImage, r: Rect, e: number): void {
  if (e <= 0) return;
  const px = (x: number, y: number) => (y * sheet.width + x) * 4;
  const copy = (fx: number, fy: number, tx: number, ty: number) => {
    if (tx < 0 || ty < 0 || tx >= sheet.width || ty >= sheet.height) return;
    sheet.data.copyWithin(px(tx, ty), px(fx, fy), px(fx, fy) + 4);
  };
  for (let i = 1; i <= e; i++) {
    for (let x = r.x; x < r.x + r.width; x++) {
      copy(x, r.y, x, r.y - i);
      copy(x, r.y + r.height - 1, x, r.y + r.height - 1 + i);
    }
  }
  for (let i = 1; i <= e; i++) {
    for (let y = r.y - e; y < r.y + r.height + e; y++) {
      copy(r.x, y, r.x - i, y);
      copy(r.x + r.width - 1, y, r.x + r.width - 1 + i, y);
    }
  }
}

/** Packs frames into one image plus per-frame placement data. */
export function buildSpritesheet(inputs: SheetInput[], options: SheetOptions): Spritesheet {
  if (inputs.length === 0) throw new Error("No frames to pack");
  const e = Math.max(0, Math.floor(options.extrude));
  const pieces = inputs.map((input) => prepare(input, options.trim));
  const sizes = pieces.map((p) => ({ w: p.image.width + e * 2, h: p.image.height + e * 2 }));
  const layout = place(sizes, { ...options, padding: Math.max(0, Math.floor(options.padding)) });
  const sheet = createImage(layout.width, layout.height);

  const frames = pieces.map((piece, i) => {
    const x = layout.positions[i].x + e;
    const y = layout.positions[i].y + e;
    blit(sheet, piece.image, x, y);
    const rect = { x, y, width: piece.image.width, height: piece.image.height };
    extrudeEdges(sheet, rect, e);
    return {
      filename: piece.input.name,
      frame: { x, y, w: rect.width, h: rect.height },
      rotated: false as const,
      trimmed: piece.trimmed,
      spriteSourceSize: { x: piece.offset.x, y: piece.offset.y, w: rect.width, h: rect.height },
      sourceSize: { w: piece.input.image.width, h: piece.input.image.height },
      duration: piece.input.duration,
    };
  });
  return { image: sheet, frames };
}

export type SheetDataFormat = "json-hash" | "json-array";

export interface FrameTag {
  name: string;
  from: number;
  to: number;
  direction: "forward" | "reverse" | "pingpong";
}

/**
 * TexturePacker "JSON Hash" / "JSON Array" data, as read by Phaser, PixiJS
 * and others (and written by Aseprite, whose `frameTags` we also emit).
 */
export function texturePackerJson(
  sheet: Spritesheet,
  options: { format: SheetDataFormat; image: string; scale: number; frameTags?: FrameTag[] }
): unknown {
  const meta = {
    app: "https://github.com/g-t-georgiev/foundry2d",
    version: "1.0",
    image: options.image,
    format: "RGBA8888",
    size: { w: sheet.image.width, h: sheet.image.height },
    scale: String(options.scale),
    frameTags: options.frameTags ?? [],
  };
  if (options.format === "json-array") return { frames: sheet.frames, meta };
  const frames: Record<string, Omit<SheetFrame, "filename">> = {};
  for (const { filename, ...rest } of sheet.frames) frames[filename] = rest;
  return { frames, meta };
}
