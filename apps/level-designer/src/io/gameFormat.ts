import type { LevelProject } from "../model/LevelProject";
import { layerIdFor, type Level } from "../model/LevelProject";
import { tilesetGrid } from "../model/tiles";
import { entityRect, fieldValue, isEntityRef } from "../model/entities";
import type { EntityDef, EntityInstance, FieldDef, FieldScalar, FieldValue } from "../model/types";

/** An EntityRef value in a game export: the instance id and its level's identifier. */
export interface GameEntityRef {
  iid: string;
  level: string;
}

/** A field value in a game export (EntityRef values resolved, missing ones dropped). */
export type GameFieldValue =
  | Exclude<FieldScalar, { entityIid: string }>
  | GameEntityRef
  | null
  | GameFieldValue[];

/** A field value for export: references carry the level identifier. */
function exportValue(project: LevelProject, value: FieldValue): GameFieldValue {
  const one = (v: FieldScalar): GameFieldValue => {
    if (!isEntityRef(v)) return v;
    const target = project.findEntity(v);
    return target ? { iid: v.entityIid, level: target.level.identifier } : null;
  };
  if (Array.isArray(value)) return value.map(one).filter((v) => v !== null);
  return value === null ? null : one(value);
}

/** Field values by identifier for export, defaults filled in. */
export function exportFields(
  project: LevelProject,
  fields: readonly FieldDef[],
  holder: Pick<EntityInstance, "fields">
): Record<string, GameFieldValue> {
  return Object.fromEntries(
    fields.map((f) => [
      f.identifier,
      exportValue(project, fieldValue(holder, f, project.defs.enums)),
    ])
  );
}

const entityFields = (project: LevelProject, def: EntityDef, instance: EntityInstance) =>
  exportFields(project, def.fields, instance);

/** One placed entity in a game export. */
export interface GameEntity {
  /** Entity definition identifier, e.g. "Ghost". */
  id: string;
  /** Stable instance id. */
  iid: string;
  /** Pivot position in pixels. */
  x: number;
  y: number;
  /** Cell containing the pivot. */
  cx: number;
  cy: number;
  /** Top-left corner and size of the entity box, in pixels. */
  left: number;
  top: number;
  width: number;
  height: number;
  /**
   * Field values by field identifier. Point fields are cells (`{ x, y }`),
   * EntityRef fields are `{ iid, level }`, array fields are lists.
   */
  fields: Record<string, GameFieldValue>;
}

/**
 * The flat format the Pac-Man game reads (same shape the original level
 * editor exported): one row-major array per layer, keyed by identifier.
 */
export interface GameLevelFile {
  metadata: {
    name: string;
    columns: number;
    rows: number;
    tileSize: number;
    /** The level's background colour (its own, or the project default). */
    bgColor: string;
  };
  /** Level field values by field identifier (present when the project defines level fields). */
  fields?: Record<string, GameFieldValue>;
  layers: Record<string, number[]>;
  /**
   * Present when the level has Tiles layers. Their cells hold
   * `tileId + 1` with flip flags in bits 29 (X) and 30 (Y); 0 is empty.
   */
  tileLayers?: Record<
    string,
    {
      tileset: string;
      tileSize: number;
      columns: number;
      image: string | null;
      /** Identifier of the IntGrid layer an auto-layer is generated from. */
      autoSource?: string;
    }
  >;
  /** Present when the project has Entities layers: instances keyed by layer identifier. */
  entities?: Record<string, GameEntity[]>;
}

/** The entities of one layer in export shape. */
export function entitiesForLayer(
  project: LevelProject,
  level: Level,
  layerUid: number
): GameEntity[] {
  const { gridSize } = project;
  return level.entities.flatMap((instance) => {
    const def = project.getEntityDef(instance.defUid);
    if (!def || instance.layerUid !== layerUid) return [];
    const box = entityRect(def, instance);
    return [
      {
        id: def.identifier,
        iid: instance.iid,
        x: instance.x,
        y: instance.y,
        cx: Math.floor(instance.x / gridSize),
        cy: Math.floor(instance.y / gridSize),
        left: box.x,
        top: box.y,
        width: box.width,
        height: box.height,
        fields: entityFields(project, def, instance),
      },
    ];
  });
}

export function toGameFormat(project: LevelProject, level: Level): GameLevelFile {
  const layers: Record<string, number[]> = {};
  const entities: NonNullable<GameLevelFile["entities"]> = {};
  for (const def of project.defs.layers) {
    if (def.type === "Entities") {
      entities[def.identifier] = entitiesForLayer(project, level, def.uid);
      continue;
    }
    const layer = level.doc.getLayer(layerIdFor(def.uid));
    if (layer) layers[def.identifier] = Array.from(layer.data);
  }
  const tileLayers: NonNullable<GameLevelFile["tileLayers"]> = {};
  for (const def of project.defs.layers) {
    if (def.type !== "Tiles") continue;
    const tileset = project.getTileset(def.tilesetUid);
    tileLayers[def.identifier] = {
      tileset: tileset?.identifier ?? "",
      tileSize: tileset?.tileSize ?? project.gridSize,
      columns: tileset ? tilesetGrid(tileset).columns : 0,
      image: tileset?.image.fileName ?? null,
      ...(project.isAutoLayer(def) ? { autoSource: project.autoSourceOf(def)!.identifier } : {}),
    };
  }
  return {
    ...(Object.keys(tileLayers).length ? { tileLayers } : {}),
    ...(Object.keys(entities).length ? { entities } : {}),
    metadata: {
      name: project.name,
      columns: level.width,
      rows: level.height,
      tileSize: project.gridSize,
      bgColor: project.levelBackground(level),
    },
    ...(project.defs.levelFields.length
      ? {
          fields: exportFields(project, project.defs.levelFields, level),
        }
      : {}),
    layers,
  };
}

/** Formats a layer as a row-per-line array literal, ready to paste into code. */
export function formatLayerAsArray(data: ArrayLike<number>, columns: number, rows: number): string {
  const lines: string[] = [];
  for (let row = 0; row < rows; row++) {
    const start = row * columns;
    lines.push(`  ${Array.from({ length: columns }, (_, i) => data[start + i]).join(", ")}`);
  }
  return `[\n${lines.join(",\n")}\n]`;
}

export { fromGameFormat, importGameLevel, isGameFormat } from "./gameImport";

// ------------------------------------------------------------------ CSV

/** A value as CSV text: Points as `x;y`, references as the iid, lists joined by `|`. */
function csvText(value: unknown): string {
  if (Array.isArray(value)) return value.map(csvText).join("|");
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value && typeof value === "object") {
    if ("x" in value && "y" in value) return `${Number(value.x)};${Number(value.y)}`;
    if ("iid" in value) return String(value.iid);
  }
  return "";
}

/** Quotes a CSV field when needed (RFC 4180). */
function csvField(value: unknown): string {
  const text = csvText(value);
  const needsQuotes = /[",\r\n]/.test(text);
  return needsQuotes ? `"${text.replace(/"/g, '""')}"` : text;
}

const csvLine = (values: unknown[]) => values.map(csvField).join(",");

/** One CSV file of a level export. */
export interface CsvFile {
  name: string;
  text: string;
}

/**
 * CSV export of a level, one file per layer (like Tiled's CSV layer format):
 * - IntGrid and Tiles layers: one row per line of cells (Tiles cells use the
 *   same encoding as the JSON export: `tileId + 1`, flips in bits 29/30);
 * - Entities layers: a header row, then one row per entity with its
 *   position, size and one column per field (Point fields as `x;y`).
 */
export function toCsvFiles(project: LevelProject, level: Level): CsvFile[] {
  const files: CsvFile[] = [];
  for (const def of project.defs.layers) {
    if (def.type === "Entities") {
      const entities = entitiesForLayer(project, level, def.uid);
      const fieldNames = [...new Set(entities.flatMap((e) => Object.keys(e.fields)))];
      const columns = ["id", "iid", "x", "y", "cx", "cy", "left", "top", "width", "height"];
      const rows = entities.map((e) =>
        csvLine([
          e.id,
          e.iid,
          e.x,
          e.y,
          e.cx,
          e.cy,
          e.left,
          e.top,
          e.width,
          e.height,
          ...fieldNames.map((f) => e.fields[f]),
        ])
      );
      files.push({
        name: `${def.identifier}.csv`,
        text: [csvLine([...columns, ...fieldNames]), ...rows].join("\n") + "\n",
      });
      continue;
    }
    const layer = level.doc.getLayer(layerIdFor(def.uid));
    if (!layer) continue;
    const lines: string[] = [];
    for (let y = 0; y < layer.height; y++) {
      lines.push(Array.from(layer.data.subarray(y * layer.width, (y + 1) * layer.width)).join(","));
    }
    files.push({ name: `${def.identifier}.csv`, text: lines.join("\n") + "\n" });
  }
  return files;
}
