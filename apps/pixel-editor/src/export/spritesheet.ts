import { buildAtlas, type PackAlgorithm, type RgbaImage } from "@foundry2d/atlas";
import type { SheetData, SheetFrame } from "@foundry2d/formats";

export type { FrameTag, SheetFrame } from "@foundry2d/formats";

/**
 * The pixel editor's spritesheet layouts, packed by `@foundry2d/atlas`
 * (the Sprite Packer's engine): strips and grids keep frame order;
 * "packed" uses MaxRects.
 */
export type SheetLayout = "horizontal" | "vertical" | "grid" | "packed";

const ALGORITHM: Record<SheetLayout, PackAlgorithm> = {
  horizontal: "horizontal",
  vertical: "vertical",
  grid: "grid",
  packed: "maxrects",
};

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

/** The packed image plus its frames; `sheetData` turns it into what the data formats read. */
export interface Spritesheet {
  image: RgbaImage;
  frames: SheetFrame[];
}

/** Size and frames of a sheet, for the `@foundry2d/formats` writers. */
export const sheetData = (sheet: Spritesheet): SheetData => ({
  width: sheet.image.width,
  height: sheet.image.height,
  frames: sheet.frames,
});

/** Packs frames into one image plus per-frame placement data. */
export function buildSpritesheet(inputs: SheetInput[], options: SheetOptions): Spritesheet {
  if (inputs.length === 0) throw new Error("No frames to pack");
  const padding = Math.max(0, Math.floor(options.padding));
  const atlas = buildAtlas(inputs, {
    algorithm: ALGORITHM[options.layout],
    columns: options.columns,
    padding,
    border: padding,
    extrude: options.extrude,
    trim: options.trim,
    // One sheet, as before: the exporter has no multi-sheet output.
    maxWidth: 32768,
    maxHeight: 32768,
  });
  const [sheet] = atlas.sheets;
  return { image: sheet.image, frames: sheet.frames };
}
