/** One value of an IntGrid layer (0 is always "empty" and never defined). */
export interface IntGridValueDef {
  /** Integer written into the grid; 1..n. */
  value: number;
  /** Code-friendly name, e.g. "wall". */
  identifier: string;
  /** CSS hex color used in the editor. */
  color: string;
}

export type LayerType = "IntGrid";

/**
 * A layer definition is shared by every level in the project (LDtk model):
 * levels only store per-layer cell data, visibility and opacity.
 */
export interface LayerDef {
  uid: number;
  /** Code-friendly key; also the key used in game exports. */
  identifier: string;
  type: LayerType;
  intGridValues: IntGridValueDef[];
}

export interface ProjectDefs {
  /** Bottom → top stacking order, same as document layer order. */
  layers: LayerDef[];
}
