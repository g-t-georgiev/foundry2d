import type { AutoRule } from "./autoRules";

/** One value of an IntGrid layer (0 is always "empty" and never defined). */
export interface IntGridValueDef {
  /** Integer written into the grid; 1..n. */
  value: number;
  /** Code-friendly name, e.g. "wall". */
  identifier: string;
  /** CSS hex color used in the editor. */
  color: string;
}

export type LayerType = "IntGrid" | "Tiles" | "Entities";

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
  /**
   * Auto-layer: a Tiles layer with a source is generated from that IntGrid
   * layer by `autoRules` and can't be painted by hand.
   */
  autoSourceUid?: number | null;
  autoRules?: AutoRule[];
  /** Varies random choices (tile variants, chance); "Reshuffle" changes it. */
  autoSeed?: number;
}

export interface ProjectDefs {
  /** Bottom → top stacking order, same as document layer order. */
  layers: LayerDef[];
  tilesets: TilesetDef[];
  entities: EntityDef[];
  enums: EnumDef[];
  /** Custom fields every level has (LDtk's level fields), e.g. music or a time limit. */
  levelFields: FieldDef[];
}

// ------------------------------------------------------------------ entities

/** Value types an entity field can hold. */
export type FieldType = "Int" | "Float" | "Bool" | "String" | "Color" | "Enum" | "Point";
export const FIELD_TYPES: readonly FieldType[] = [
  "Int",
  "Float",
  "Bool",
  "String",
  "Color",
  "Enum",
  "Point",
];

/** A level cell, used by Point fields. */
export interface GridPoint {
  x: number;
  y: number;
}

/**
 * Field value by type: numbers for Int/Float, booleans, strings for
 * String/Color (CSS hex) and Enum (the value id), a cell for Point.
 * `null` means "not set" (allowed for Enum and Point).
 */
export type FieldValue = number | boolean | string | GridPoint | null;

export interface FieldDef {
  uid: number;
  /** Code-friendly key; used in game exports. */
  identifier: string;
  type: FieldType;
  /** Value given to new instances (and used when a stored value is invalid). */
  defaultValue: FieldValue;
  /** Enum used by Enum fields. */
  enumUid?: number | null;
  /** Bounds for Int and Float fields. */
  min?: number | null;
  max?: number | null;
}

export type EntityShape = "rectangle" | "ellipse" | "tile";
export const ENTITY_SHAPES: readonly EntityShape[] = ["rectangle", "ellipse", "tile"];

/** An entity type, shared by every level (LDtk model). */
export interface EntityDef {
  uid: number;
  identifier: string;
  /** CSS hex color for the editor shape and label. */
  color: string;
  /** Size in level pixels. */
  width: number;
  height: number;
  /** Anchor inside the shape, 0..1 on each axis; the instance position is this point. */
  pivotX: number;
  pivotY: number;
  shape: EntityShape;
  /** Tile drawn for the "tile" shape. */
  tile?: { tilesetUid: number; tileId: number } | null;
  /** Instances allowed per level; 0 means no limit. */
  maxPerLevel: number;
  fields: FieldDef[];
}

export interface EnumValueDef {
  /** Code-friendly id, unique within the enum; stored in Enum fields. */
  id: string;
  color: string;
}

export interface EnumDef {
  uid: number;
  identifier: string;
  values: EnumValueDef[];
}

/** A placed entity. Belongs to one level and one Entities layer. */
export interface EntityInstance {
  /** Stable unique id (kept across saves; new for duplicates). */
  iid: string;
  defUid: number;
  layerUid: number;
  /** Pivot position in level pixels. */
  x: number;
  y: number;
  /** Values by field uid; missing entries use the field default. */
  fields: Record<string, FieldValue>;
}

/**
 * World arrangement, as in LDtk: `free` places levels anywhere, `gridvania`
 * snaps them to a world grid, and the linear layouts derive positions from
 * the level order.
 */
export type WorldLayout = "free" | "gridvania" | "linearH" | "linearV";
export const WORLD_LAYOUTS: readonly WorldLayout[] = ["free", "gridvania", "linearH", "linearV"];
