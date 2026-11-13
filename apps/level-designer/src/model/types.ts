/** One value of an IntGrid layer (0 is always "empty" and never defined). */
export interface IntGridValueDef {
  /** Integer written into the grid; 1..n. */
  value: number;
  /** Code-friendly name, e.g. "wall". */
  identifier: string;
  /** CSS hex color used in the editor. */
  color: string;
}

export type LayerType = "IntGrid" | "Tiles";

/** A tileset image sliced into square tiles (LDtk model). */
export interface TilesetDef {
  uid: number;
  identifier: string;
  /** Tile width and height in source pixels. */
  tileSize: number;
  /** Gap between tiles in the image, in pixels. */
  spacing: number;
  /** Margin around the whole tile grid, in pixels. */
  padding: number;
  /**
   * Source image. Embedded as a PNG data URL so projects stay self-contained;
   * Phase 5 moves images to an asset store referenced by hash.
   */
  image: { dataUrl: string; width: number; height: number; fileName?: string };
}

/**
 * A layer definition is shared by every level in the project (LDtk model):
 * levels only store per-layer cell data, visibility and opacity.
 */
export interface LayerDef {
  uid: number;
  /** Code-friendly key; also the key used in game exports. */
  identifier: string;
  type: LayerType;
  /** Values of IntGrid layers (empty for other types). */
  intGridValues: IntGridValueDef[];
  /** Tileset of a Tiles layer (`null` until one is assigned). */
  tilesetUid?: number | null;
}

export interface ProjectDefs {
  /** Bottom → top stacking order, same as document layer order. */
  layers: LayerDef[];
  tilesets: TilesetDef[];
}

/**
 * World arrangement, as in LDtk: `free` places levels anywhere, `gridvania`
 * snaps them to a world grid, and the linear layouts derive positions from
 * the level order.
 */
export type WorldLayout = "free" | "gridvania" | "linearH" | "linearV";
export const WORLD_LAYOUTS: readonly WorldLayout[] = ["free", "gridvania", "linearH", "linearV"];
