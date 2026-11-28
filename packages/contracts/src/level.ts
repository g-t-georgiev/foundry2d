import {
  checkBase,
  checkPivot,
  isInt,
  isRecord,
  isText,
  result,
  type AssetBase,
  type ValidationResult,
} from "./common";

/**
 * One level: grids of named values (walls, pellets…), tile layers and
 * placed entities with their fields. Written by Levels; a game reads cells
 * by name through each grid's `values`, so renumbering values in the editor
 * never breaks it.
 */
export interface LevelAsset extends AssetBase<"level"> {
  /** Pixels per cell. */
  tileSize: number;
  columns: number;
  rows: number;
  /** Background colour, "#rrggbb". */
  background?: string;
  /** Value grids by layer name. */
  grids: Record<string, LevelGrid>;
  /** Tile layers by name. */
  tiles?: Record<string, LevelTiles>;
  entities?: LevelEntity[];
  /** The level's own fields (time limit, music…). */
  fields?: Record<string, FieldValue>;
}

export interface LevelGrid {
  /** What each value means: name → value (0 is always empty). */
  values: Record<string, number>;
  /** Row by row, `columns × rows` long (the grid's own size when it has one). */
  cells: number[];
  /** Set when the layer has its own grid: its cell size in pixels and size in cells. */
  grid?: { size: number; columns: number; rows: number };
}

export interface LevelTiles {
  /** The sprite sheet the tiles come from. */
  sheet: string;
  /** Tile sprite names in the sheet, by tile id (cells hold id + 1). */
  tileNames: string[];
  /** Row by row: tile id + 1 (0 empty), flip X in bit 29 and flip Y in bit 30. */
  cells: number[];
  grid?: { size: number; columns: number; rows: number };
}

export type FieldValue =
  | number
  | boolean
  | string
  | null
  | { x: number; y: number }
  | { entity: string; level: string }
  | FieldValue[];

export interface LevelEntity {
  /** Entity type, e.g. "Ghost". */
  type: string;
  /** Stable instance id. */
  id: string;
  /** The layer it is on. */
  layer: string;
  /** Position of its pivot, in pixels. */
  x: number;
  y: number;
  width: number;
  height: number;
  pivot?: { x: number; y: number };
  fields?: Record<string, FieldValue>;
}

const cellsCheck = (
  cells: unknown,
  size: number,
  where: string,
  errors: string[]
): cells is number[] => {
  if (!Array.isArray(cells) || cells.some((c) => !Number.isInteger(c) || c < 0)) {
    errors.push(`${where}.cells must be whole numbers, 0 or more.`);
    return false;
  }
  if (cells.length !== size) errors.push(`${where}.cells must hold ${size} cells.`);
  return true;
};

const gridSize = (raw: unknown, fallback: number, where: string, errors: string[]): number => {
  if (raw === undefined) return fallback;
  if (!isRecord(raw) || !isInt(raw.size, 1) || !isInt(raw.columns, 1) || !isInt(raw.rows, 1)) {
    errors.push(`${where}.grid must be { size, columns, rows } positive whole numbers.`);
    return fallback;
  }
  return raw.columns * raw.rows;
};

export function validateLevel(raw: unknown): ValidationResult {
  if (!isRecord(raw)) return result(["A level must be a JSON object."]);
  const errors: string[] = [];
  checkBase(raw, "level", errors);
  if (!isInt(raw.tileSize, 1) || !isInt(raw.columns, 1) || !isInt(raw.rows, 1)) {
    errors.push("tileSize, columns and rows must be positive whole numbers.");
  }
  const size = isInt(raw.columns, 1) && isInt(raw.rows, 1) ? raw.columns * raw.rows : 0;
  const bg = raw.background;
  if (bg !== undefined && !(typeof bg === "string" && /^#[0-9a-f]{6}$/i.test(bg))) {
    errors.push('background must be "#rrggbb".');
  }
  if (!isRecord(raw.grids)) errors.push("grids must be an object of named grids.");
  else {
    for (const [name, grid] of Object.entries(raw.grids)) {
      const where = `grids["${name}"]`;
      if (!isRecord(grid)) {
        errors.push(`${where} must be an object.`);
        continue;
      }
      const values = isRecord(grid.values) ? Object.values(grid.values) : null;
      if (!values || values.some((v) => !isInt(v, 1))) {
        errors.push(`${where}.values must map names to whole numbers from 1.`);
      } else if (new Set(values).size !== values.length) {
        errors.push(`${where}.values must give every name its own number.`);
      }
      const count = gridSize(grid.grid, size, where, errors);
      if (cellsCheck(grid.cells, count, where, errors) && values) {
        const allowed = new Set([0, ...values]);
        const unknown = [...new Set(grid.cells)].filter((c) => !allowed.has(c));
        if (unknown.length)
          errors.push(`${where}.cells use values without a name: ${unknown.join(", ")}.`);
      }
    }
  }
  if (raw.tiles !== undefined) {
    if (!isRecord(raw.tiles)) errors.push("tiles must be an object of named tile layers.");
    else {
      for (const [name, layer] of Object.entries(raw.tiles)) {
        const where = `tiles["${name}"]`;
        if (!isRecord(layer) || !isText(layer.sheet) || !Array.isArray(layer.tileNames)) {
          errors.push(`${where} needs a sheet and tileNames.`);
          continue;
        }
        const count = gridSize(layer.grid, size, where, errors);
        if (cellsCheck(layer.cells, count, where, errors)) {
          const max = layer.tileNames.length;
          const bad = layer.cells.some((c) => (c & ~((1 << 29) | (1 << 30))) > max);
          if (bad) errors.push(`${where}.cells use tile ids past tileNames.`);
        }
      }
    }
  }
  if (raw.entities !== undefined) {
    if (!Array.isArray(raw.entities)) errors.push("entities must be a list.");
    else {
      const ids = new Set<string>();
      raw.entities.forEach((e: unknown, i) => {
        const where = `entities[${i}]`;
        if (
          !isRecord(e) ||
          !isText(e.type) ||
          !isText(e.id) ||
          !isText(e.layer) ||
          ![e.x, e.y, e.width, e.height].every((n) => typeof n === "number" && Number.isFinite(n))
        ) {
          errors.push(`${where} needs type, id, layer, x, y, width and height.`);
          return;
        }
        if (ids.has(e.id)) errors.push(`${where}.id "${e.id}" is used twice.`);
        ids.add(e.id);
        checkPivot(e.pivot, where, errors);
        if (e.fields !== undefined && !isRecord(e.fields))
          errors.push(`${where}.fields must be an object.`);
      });
    }
  }
  if (raw.fields !== undefined && !isRecord(raw.fields)) errors.push("fields must be an object.");
  return result(errors);
}

/** A grid's cell as its value's name, or `null` when empty. */
export function cellName(
  grid: LevelGrid,
  column: number,
  row: number,
  columns: number
): string | null {
  const value = grid.cells[row * (grid.grid?.columns ?? columns) + column] ?? 0;
  if (value === 0) return null;
  return Object.entries(grid.values).find(([, v]) => v === value)?.[0] ?? null;
}
