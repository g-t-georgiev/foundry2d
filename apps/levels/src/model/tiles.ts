import type { Rect } from "@gs2d/core";
import type { TilesetDef } from "./types";

/**
 * Tile cell encoding (Int32, sign bit unused):
 *
 *   bit 30      bit 29      bits 0..28
 *   flip Y      flip X      tileId + 1   (0 = empty cell)
 *
 * Storing `tileId + 1` keeps 0 as "empty", like IntGrid layers, so the
 * same documents, tools and RLE encoding work unchanged.
 */
export const TILE_FLIP_X = 1 << 29;
export const TILE_FLIP_Y = 1 << 30;
export const TILE_ID_MASK = TILE_FLIP_X - 1;

export interface DecodedTile {
  tileId: number;
  flipX: boolean;
  flipY: boolean;
}

export function encodeTile(tileId: number, flipX = false, flipY = false): number {
  if (tileId < 0 || tileId >= TILE_ID_MASK) throw new RangeError(`Tile id out of range: ${tileId}`);
  return ((tileId + 1) | (flipX ? TILE_FLIP_X : 0) | (flipY ? TILE_FLIP_Y : 0)) >>> 0;
}

export function decodeTile(value: number): DecodedTile | null {
  const id = value & TILE_ID_MASK;
  if (id === 0) return null;
  return {
    tileId: id - 1,
    flipX: (value & TILE_FLIP_X) !== 0,
    flipY: (value & TILE_FLIP_Y) !== 0,
  };
}

/** Number of whole tiles in a tileset image, honouring padding and spacing. */
export function tilesetGrid(tileset: TilesetDef): { columns: number; rows: number } {
  const { tileSize, spacing, padding, image } = tileset;
  const fit = (length: number) =>
    Math.max(0, Math.floor((length - padding * 2 + spacing) / (tileSize + spacing)));
  return { columns: fit(image.width), rows: fit(image.height) };
}

/** Source rectangle of a tile in the tileset image. */
export function tileSourceRect(tileset: TilesetDef, tileId: number): Rect | null {
  const { columns, rows } = tilesetGrid(tileset);
  if (columns === 0 || tileId < 0 || tileId >= columns * rows) return null;
  const col = tileId % columns;
  const row = Math.floor(tileId / columns);
  return {
    x: tileset.padding + col * (tileset.tileSize + tileset.spacing),
    y: tileset.padding + row * (tileset.tileSize + tileset.spacing),
    width: tileset.tileSize,
    height: tileset.tileSize,
  };
}

/** A rectangular selection of tiles in the tileset grid (tile units). */
export interface TileSelection {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Turns a tileset selection into a stamp pattern of encoded cells, applying
 * flips to both each tile and the arrangement (like mirroring the stamp).
 */
export function selectionToPattern(
  tileset: TilesetDef,
  selection: TileSelection,
  flipX: boolean,
  flipY: boolean
): { width: number; height: number; values: number[] } {
  const { columns } = tilesetGrid(tileset);
  const values: number[] = [];
  for (let y = 0; y < selection.height; y++) {
    for (let x = 0; x < selection.width; x++) {
      const sx = flipX ? selection.width - 1 - x : x;
      const sy = flipY ? selection.height - 1 - y : y;
      const tileId = (selection.y + sy) * columns + (selection.x + sx);
      values.push(encodeTile(tileId, flipX, flipY));
    }
  }
  return { width: selection.width, height: selection.height, values };
}
