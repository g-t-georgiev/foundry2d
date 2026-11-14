import { LevelProject, layerIdFor, type Level } from "../model/LevelProject";
import { createProjectFromPreset } from "../model/presets";
import { isHexColor, isPoint, newIid, validateFieldValue } from "../model/entities";
import type { EntityDef, EntityInstance, EntityRef, FieldDef, FieldType } from "../model/types";
import { ProjectFormatError } from "./projectFile";
import type { GameLevelFile } from "./gameFormat";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

export function isGameFormat(json: unknown): json is GameLevelFile {
  return isRecord(json) && isRecord(json.metadata) && isRecord(json.layers);
}

/**
 * Value names of layers the original Pac-Man editor exported that the current
 * presets no longer have (the `spawns` layer became entities in Phase 7).
 */
const LEGACY_LAYER_VALUES: Record<string, { value: number; identifier: string; color: string }[]> =
  {
    spawns: [
      { value: 1, identifier: "pacman", color: "#ffff00" },
      { value: 2, identifier: "blinky", color: "#ff0000" },
      { value: 3, identifier: "inky", color: "#00eeff" },
      { value: 4, identifier: "pinky", color: "#ff00ea" },
      { value: 5, identifier: "clyde", color: "#ff7300" },
    ],
  };

/** Colours for entity types created from a game file (unknown to the Pac-Man seed). */
const ENTITY_COLORS = ["#4c9ffe", "#f59e0b", "#10b981", "#ef4444", "#a855f7", "#14b8a6"];

/** Checks the size and every layer's cell count; returns columns and rows. */
function checkGameFile(json: unknown): { file: GameLevelFile; columns: number; rows: number } {
  if (!isGameFormat(json)) throw new ProjectFormatError("Not a game level file.");
  const columns = Number(json.metadata.columns);
  const rows = Number(json.metadata.rows);
  if (!Number.isInteger(columns) || !Number.isInteger(rows) || columns < 1 || rows < 1) {
    throw new ProjectFormatError("Game file has invalid columns/rows.");
  }
  const entries = Object.entries(json.layers);
  if (entries.length === 0 && !isRecord(json.entities)) {
    throw new ProjectFormatError("Game file has no layers.");
  }
  for (const [key, data] of entries) {
    const grid = layerGrid(json, key);
    const cells = grid ? grid.columns * grid.rows : columns * rows;
    if (!Array.isArray(data) || data.length !== cells) {
      throw new ProjectFormatError(`Layer "${key}" should have ${cells} cells.`);
    }
  }
  return { file: json, columns, rows };
}

/** A layer's own grid (when it differs from the level's), checked. */
function layerGrid(
  file: GameLevelFile,
  key: string
): { gridSize: number; columns: number; rows: number } | null {
  const grids: unknown = file.layerGrids;
  const grid = isRecord(grids) ? grids[key] : undefined;
  if (!isRecord(grid)) return null;
  const { gridSize, columns, rows } = grid;
  const ok = [gridSize, columns, rows].every((v) => Number.isInteger(v) && (v as number) > 0);
  return ok
    ? { gridSize: gridSize as number, columns: columns as number, rows: rows as number }
    : null;
}

/** Exported entities as plain records, by layer key. */
function fileEntities(file: GameLevelFile): [string, Record<string, unknown>[]][] {
  const entities: unknown = file.entities;
  if (!isRecord(entities)) return [];
  return Object.entries(entities).map(([key, list]) => [
    key,
    Array.isArray(list) ? list.filter(isRecord) : [],
  ]);
}

export interface GameImportResult {
  level: Level;
  /** What could not be matched to the project (unknown layers, entity types, fields). */
  warnings: string[];
}

/**
 * Adds a game-format level to `project`, matching the file's layers,
 * entity types and fields to the project's definitions by identifier.
 * Auto-layers are regenerated from their sources rather than read. Things
 * without a match are skipped and listed in `warnings`.
 *
 * The level is inserted (at the next free world spot); the caller records
 * the undo step.
 */
export function importGameLevel(
  project: LevelProject,
  json: unknown,
  identifier = "level"
): GameImportResult {
  const { file, columns, rows } = checkGameFile(json);
  const warnings: string[] = [];
  const tileSize = Number(file.metadata.tileSize);
  if (Number.isInteger(tileSize) && tileSize !== project.gridSize) {
    warnings.push(`The file uses ${tileSize} px cells, this project ${project.gridSize} px.`);
  }

  const position = project.nextFreePosition();
  const level = project.createLevel(identifier, columns, rows, {
    worldX: position.x,
    worldY: position.y,
  });

  // ---- Grid layers.
  const skippedLayers: string[] = [];
  const mismatchedGrids: string[] = [];
  for (const [key, data] of Object.entries(file.layers)) {
    const def = project.defs.layers.find((d) => d.identifier === key && d.type !== "Entities");
    if (!def) {
      skippedLayers.push(key);
      continue;
    }
    if (project.isAutoLayer(def)) continue; // regenerated below
    const fileGrid = layerGrid(file, key)?.gridSize ?? tileSize;
    if (Number.isInteger(fileGrid) && fileGrid !== project.layerGridSize(def)) {
      mismatchedGrids.push(key);
      continue;
    }
    const layer = level.doc.getLayer(layerIdFor(def.uid))!;
    if (data.length !== layer.data.length) {
      mismatchedGrids.push(key);
      continue;
    }
    layer.data.set(data.map((v) => (Number.isInteger(v) ? v : 0)));
    layer.version++;
  }
  project.regenerateAutoLayers(undefined, level);

  // ---- Entities: instances first, so references between them can be resolved.
  const taken = new Set(project.levels.flatMap((l) => l.entities.map((e) => e.iid)));
  const newIids = new Map<string, string>();
  const unknownTypes = new Set<string>();
  const unknownFields = new Set<string>();
  let skippedEntities = 0;
  const placed: { instance: EntityInstance; def: EntityDef; raw: Record<string, unknown> }[] = [];
  const entityLayers = project.defs.layers.filter((d) => d.type === "Entities");
  for (const [key, list] of fileEntities(file)) {
    const layerDef = entityLayers.find((d) => d.identifier === key) ?? entityLayers[0];
    if (!layerDef) {
      skippedEntities += list.length;
      continue;
    }
    for (const raw of list) {
      const def = project.defs.entities.find((d) => d.identifier === raw.id);
      if (!def || typeof raw.x !== "number" || typeof raw.y !== "number") {
        if (typeof raw.id === "string" && !def) unknownTypes.add(raw.id);
        else skippedEntities++;
        continue;
      }
      const fileIid = typeof raw.iid === "string" && raw.iid ? raw.iid : null;
      const iid = fileIid && !taken.has(fileIid) ? fileIid : newIid();
      taken.add(iid);
      if (fileIid) newIids.set(fileIid, iid);
      placed.push({
        instance: { iid, defUid: def.uid, layerUid: layerDef.uid, x: raw.x, y: raw.y, fields: {} },
        def,
        raw: isRecord(raw.fields) ? raw.fields : {},
      });
    }
  }

  // References: to entities of this file (by their new iid), else to a level of the project
  // with the exported level identifier; otherwise they stay as "missing".
  const resolveRef = (iid: string, levelName: string): EntityRef => {
    const own = newIids.get(iid);
    if (own) return { entityIid: own, levelUid: level.uid };
    const other = project.levels.find((l) => l !== level && l.identifier === levelName);
    return { entityIid: iid, levelUid: other?.uid ?? level.uid };
  };
  const readValue = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(readValue);
    if (isRecord(value) && typeof value.iid === "string" && typeof value.level === "string") {
      return resolveRef(value.iid, value.level);
    }
    return value;
  };
  const readFields = (
    fields: readonly FieldDef[],
    raw: Record<string, unknown>,
    target: Record<string, unknown>,
    owner: string
  ) => {
    for (const [name, value] of Object.entries(raw)) {
      const field = fields.find((f) => f.identifier === name);
      if (!field) {
        unknownFields.add(`${owner}.${name}`);
        continue;
      }
      const valid = validateFieldValue(field, readValue(value), project.defs.enums);
      if (valid !== undefined) target[String(field.uid)] = valid;
    }
  };

  for (const { instance, def, raw } of placed) {
    readFields(def.fields, raw, instance.fields, def.identifier);
    level.entities.push(instance);
  }
  if (isRecord(file.fields))
    readFields(project.defs.levelFields, file.fields, level.fields, "level");
  if (isHexColor(file.metadata.bgColor)) {
    const color = file.metadata.bgColor.toLowerCase();
    if (color !== project.defaultLevelBg) level.bgColor = color;
  }
  level.doc.setActiveLayer(level.doc.layers[0]?.id ?? null);

  if (skippedLayers.length) warnings.push(`No layer named ${list(skippedLayers)}; skipped.`);
  if (mismatchedGrids.length) {
    warnings.push(`Layer ${list(mismatchedGrids)} uses another grid size here; skipped.`);
  }
  if (unknownTypes.size) warnings.push(`No entity type named ${list([...unknownTypes])}; skipped.`);
  if (skippedEntities) warnings.push(`${skippedEntities} entities could not be placed.`);
  if (unknownFields.size) warnings.push(`No field named ${list([...unknownFields])}; skipped.`);
  return { level, warnings };
}

const list = (names: string[]) => names.map((n) => `"${n}"`).join(", ");

/**
 * The field type behind exported values: numbers (Int when all are whole),
 * booleans, colours, strings, cells and references, each possibly a list.
 * Null when there is nothing to go by.
 */
export function inferFieldType(values: unknown[]): { type: FieldType; isArray: boolean } | null {
  const present = values.filter((v) => v !== null && v !== undefined);
  if (present.length === 0) return null;
  const isArray = present.every(Array.isArray);
  const scalars = isArray ? present.flatMap((v) => v as unknown[]) : present;
  if (scalars.length === 0) return null;
  let type: FieldType | null = null;
  if (scalars.every((v) => typeof v === "number")) {
    type = scalars.every((v) => Number.isInteger(v)) ? "Int" : "Float";
  } else if (scalars.every((v) => typeof v === "boolean")) type = "Bool";
  else if (scalars.every(isHexColor)) type = "Color";
  else if (scalars.every((v) => typeof v === "string")) type = "String";
  else if (scalars.every(isPoint)) type = "Point";
  else if (scalars.every((v) => isRecord(v) && typeof v.iid === "string")) type = "EntityRef";
  return type ? { type, isArray } : null;
}

/** Adds fields inferred from exported values (`records`: one field object per holder). */
function addInferredFields(
  records: Record<string, unknown>[],
  add: (type: FieldType, identifier: string) => FieldDef | null,
  makeArray: (field: FieldDef) => void
): void {
  const names = [...new Set(records.flatMap((r) => Object.keys(r)))];
  for (const name of names) {
    const inferred = inferFieldType(records.map((r) => r[name]));
    if (!inferred) continue;
    const field = add(inferred.type, name);
    if (field && inferred.isArray) makeArray(field);
  }
}

/**
 * Opens a game-format file as a new project. Layers whose keys match the
 * Pac-Man seed keep its value names and colours (as do legacy keys such as
 * `spawns`); other IntGrid keys get one value per distinct number found.
 * Tile layers come back as Tiles layers without a tileset (the file names
 * only the image). Entity types, their fields and level fields are inferred
 * from the exported values; entity types the seed knows keep its colour and
 * shape.
 */
export function fromGameFormat(json: unknown): LevelProject {
  const { file } = checkGameFile(json);
  const { metadata } = file;
  const seed = createProjectFromPreset("pacman");
  const project = new LevelProject(
    typeof metadata.name === "string" && metadata.name ? metadata.name : "level",
    Number.isInteger(metadata.tileSize) && metadata.tileSize > 0 ? metadata.tileSize : seed.gridSize
  );
  if (isHexColor(metadata.bgColor)) project.defaultLevelBg = metadata.bgColor.toLowerCase();

  const tileLayers = isRecord(file.tileLayers) ? file.tileLayers : {};
  for (const [key, data] of Object.entries(file.layers)) {
    const grid = layerGrid(file, key);
    const own = grid && grid.gridSize !== project.gridSize ? { gridSize: grid.gridSize } : {};
    if (key in tileLayers) {
      Object.assign(project.addTilesLayer(key, null), own);
      continue;
    }
    const known = seed.defs.layers.find((d) => d.identifier === key);
    const values =
      known?.intGridValues ??
      LEGACY_LAYER_VALUES[key] ??
      [...new Set(data.filter((v): v is number => Number.isInteger(v) && v > 0))]
        .sort((a, b) => a - b)
        .map((value) => ({ value, identifier: `value_${value}`, color: "#ff00ff" }));
    Object.assign(project.addIntGridLayer(key, values), own);
  }

  // Entity layers and types, from the exported instances.
  const byType = new Map<string, Record<string, unknown>[]>();
  for (const [key, list] of fileEntities(file)) {
    project.addEntitiesLayer(key);
    for (const raw of list) {
      if (typeof raw.id !== "string" || !raw.id) continue;
      byType.set(raw.id, [...(byType.get(raw.id) ?? []), raw]);
    }
  }
  for (const [identifier, instances] of byType) {
    const first = instances[0];
    const known = seed.defs.entities.find((d) => d.identifier === identifier);
    const size = (v: unknown) =>
      typeof v === "number" && v > 0 ? Math.round(v) : project.gridSize;
    const width = size(first.width);
    const height = size(first.height);
    const pivot = (pos: unknown, edge: unknown, extent: number) =>
      typeof pos === "number" && typeof edge === "number"
        ? Math.min(1, Math.max(0, (pos - edge) / extent))
        : 0.5;
    const def = project.addEntityDef(identifier, {
      color: known?.color ?? ENTITY_COLORS[project.defs.entities.length % ENTITY_COLORS.length],
      shape: known && known.shape !== "tile" ? known.shape : "rectangle",
      width,
      height,
      pivotX: pivot(first.x, first.left, width),
      pivotY: pivot(first.y, first.top, height),
    });
    addInferredFields(
      instances.map((i) => (isRecord(i.fields) ? i.fields : {})),
      (type, name) => project.addField(def.uid, type, name),
      (field) => project.updateField(def.uid, field.uid, { isArray: true })
    );
  }
  if (isRecord(file.fields)) {
    addInferredFields(
      [file.fields],
      (type, name) => project.addLevelField(type, name),
      (field) => project.updateLevelField(field.uid, { isArray: true })
    );
  }

  importGameLevel(project, file, "level_0");
  return project;
}
