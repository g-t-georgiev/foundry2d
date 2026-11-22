import type { SheetData, SheetFrame, Turn } from "@foundry2d/formats";
import { pack, type PackOptions } from "./pack";
import {
  blit,
  createImage,
  cropImage,
  extrudeEdges,
  imageHash,
  opaqueBounds,
  rotateImageCCW,
  rotateImageCW,
  sameImage,
  scaleImage,
  type RgbaImage,
} from "./raster";

export interface AtlasInput {
  /** Frame key in the data, e.g. "walk_0.png". */
  name: string;
  image: RgbaImage;
  /** Milliseconds (animations). */
  duration?: number;
  /** Pivot inside the untrimmed sprite, 0..1 from the top-left. */
  pivot?: { x: number; y: number };
}

export interface AtlasOptions extends PackOptions {
  /** Cut transparent borders off each sprite (the original size and offset are kept in the data). */
  trim?: boolean;
  /** Pixels of each sprite's edge repeated outward, against texture bleeding. */
  extrude?: number;
  /** Store identical sprites once; their frames share the same rectangle. */
  alias?: boolean;
  /** Which way rotated sprites are turned (the data format decides); clockwise by default. */
  turn?: Turn;
}

export interface AtlasSheet {
  image: RgbaImage;
  /** Frames on this sheet, in input order (aliases included). */
  frames: SheetFrame[];
  /** Which way its rotated frames are turned. */
  turn: Turn;
}

export interface Atlas {
  sheets: AtlasSheet[];
  /** How many inputs were stored as aliases of an identical one. */
  aliased: number;
  /** Used pixels ÷ sheet pixels, over all sheets (0..1). */
  fillRate: number;
}

interface Piece {
  image: RgbaImage;
  offset: { x: number; y: number };
  trimmed: boolean;
  /** Index of the identical piece this one reuses, or -1. */
  aliasOf: number;
}

function prepare(input: AtlasInput, trim: boolean): Omit<Piece, "aliasOf"> {
  const full = input.image;
  if (!trim) return { image: full, offset: { x: 0, y: 0 }, trimmed: false };
  // A fully transparent sprite still needs a 1×1 slot to be addressable.
  const bounds = opaqueBounds(full) ?? { x: 0, y: 0, width: 1, height: 1 };
  const trimmed = bounds.width !== full.width || bounds.height !== full.height;
  return {
    image: trimmed ? cropImage(full, bounds) : full,
    offset: { x: bounds.x, y: bounds.y },
    trimmed,
  };
}

/** The sheet's size and frames, for the `@foundry2d/formats` writers. */
export const sheetData = (sheet: AtlasSheet): SheetData => ({
  width: sheet.image.width,
  height: sheet.image.height,
  frames: sheet.frames,
  turn: sheet.turn,
});

/** The sheet enlarged by a whole factor (nearest neighbour), frames included. */
export function scaleSheet(sheet: AtlasSheet, factor: number): AtlasSheet {
  const k = Math.max(1, Math.floor(factor));
  if (k === 1) return sheet;
  return {
    ...sheet,
    image: scaleImage(sheet.image, k),
    frames: sheet.frames.map((f) => ({
      ...f,
      frame: { x: f.frame.x * k, y: f.frame.y * k, w: f.frame.w * k, h: f.frame.h * k },
      spriteSourceSize: {
        x: f.spriteSourceSize.x * k,
        y: f.spriteSourceSize.y * k,
        w: f.spriteSourceSize.w * k,
        h: f.spriteSourceSize.h * k,
      },
      sourceSize: { w: f.sourceSize.w * k, h: f.sourceSize.h * k },
    })),
  };
}

/**
 * Packs sprites into one or more sheets: trims, aliases identical sprites,
 * extrudes edges, packs (see `pack`) and draws the sheets. Frame data uses
 * TexturePacker's conventions: `frame` is the sprite's rectangle with its
 * unrotated width and height; a rotated sprite is stored turned by 90°, so
 * on the sheet it covers `frame.h × frame.w`.
 */
export function buildAtlas(inputs: AtlasInput[], options: AtlasOptions): Atlas {
  if (inputs.length === 0) throw new Error("No sprites to pack.");
  const e = Math.max(0, Math.floor(options.extrude ?? 0));
  const turn = options.turn ?? "cw";
  const turned = turn === "cw" ? rotateImageCW : rotateImageCCW;

  const pieces: Piece[] = [];
  const byHash = new Map<string, number[]>();
  for (const input of inputs) {
    const piece = prepare(input, options.trim ?? false);
    let aliasOf = -1;
    if (options.alias) {
      const hash = imageHash(piece.image);
      const same = byHash.get(hash) ?? [];
      aliasOf = same.find((i) => sameImage(pieces[i].image, piece.image)) ?? -1;
      if (aliasOf < 0) byHash.set(hash, [...same, pieces.length]);
    }
    pieces.push({ ...piece, aliasOf });
  }

  const unique = pieces.map((_, i) => i).filter((i) => pieces[i].aliasOf < 0);
  const packed = pack(
    unique.map((i) => ({ w: pieces[i].image.width + e * 2, h: pieces[i].image.height + e * 2 })),
    options
  );
  const sheets: AtlasSheet[] = packed.bins.map((bin) => ({
    image: createImage(bin.width, bin.height),
    frames: [],
    turn,
  }));

  // Draw the unique sprites and remember where each landed.
  const where = new Map<number, { bin: number; x: number; y: number; rotated: boolean }>();
  let used = 0;
  unique.forEach((pieceIndex, k) => {
    const placement = packed.placements[k];
    const piece = pieces[pieceIndex];
    const image = placement.rotated ? turned(piece.image) : piece.image;
    const x = placement.x + e;
    const y = placement.y + e;
    const sheet = sheets[placement.bin].image;
    blit(sheet, image, x, y);
    extrudeEdges(sheet, { x, y, width: image.width, height: image.height }, e);
    used += image.width * image.height;
    where.set(pieceIndex, { bin: placement.bin, x, y, rotated: placement.rotated });
  });

  inputs.forEach((input, i) => {
    const piece = pieces[i];
    const at = where.get(piece.aliasOf >= 0 ? piece.aliasOf : i)!;
    sheets[at.bin].frames.push({
      filename: input.name,
      frame: { x: at.x, y: at.y, w: piece.image.width, h: piece.image.height },
      rotated: at.rotated,
      trimmed: piece.trimmed,
      spriteSourceSize: {
        x: piece.offset.x,
        y: piece.offset.y,
        w: piece.image.width,
        h: piece.image.height,
      },
      sourceSize: { w: input.image.width, h: input.image.height },
      duration: input.duration ?? 100,
      ...(input.pivot ? { pivot: { ...input.pivot } } : {}),
    });
  });

  const total = sheets.reduce((sum, s) => sum + s.image.width * s.image.height, 0);
  return {
    sheets,
    aliased: pieces.filter((p) => p.aliasOf >= 0).length,
    fillRate: total ? used / total : 0,
  };
}
