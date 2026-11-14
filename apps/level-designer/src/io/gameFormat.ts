import { LevelProject, layerIdFor, type Level } from "../model/LevelProject";
import { createProjectFromPreset } from "../model/presets";
import { ProjectFormatError } from "./projectFile";
import { tilesetGrid } from "../model/tiles";
import { entityRect, namedFieldValues } from "../model/entities";
import type { FieldValue } from "../model/types";

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
  /** Field values by field identifier (Point fields are cells: `{ x, y }`). */
  fields: Record<string, FieldValue>;
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
  };
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
        fields: namedFieldValues(def, instance, project.defs.enums),
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
    },
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

/**
 * Imports a game-format file. Layers whose keys match the Pac-Man seed keep
 * its value names and colors (as do legacy keys such as `spawns`); other keys get a generated IntGrid def with
 * one entry per distinct value found.
 */
export function fromGameFormat(json: unknown): LevelProject {
  if (!isGameFormat(json)) throw new ProjectFormatError("Not a game level file.");
  const { metadata, layers } = json;
  const columns = Number(metadata.columns);
  const rows = Number(metadata.rows);
  if (!Number.isInteger(columns) || !Number.isInteger(rows) || columns < 1 || rows < 1) {
    throw new ProjectFormatError("Game file has invalid columns/rows.");
  }

  const seed = createProjectFromPreset("pacman");
  const project = new LevelProject(
    typeof metadata.name === "string" && metadata.name ? metadata.name : "level",
    Number.isInteger(metadata.tileSize) && metadata.tileSize > 0 ? metadata.tileSize : seed.gridSize
  );

  const entries = Object.entries(layers);
  if (entries.length === 0) throw new ProjectFormatError("Game file has no layers.");

  for (const [key, data] of entries) {
    if (!Array.isArray(data) || data.length !== columns * rows) {
      throw new ProjectFormatError(`Layer "${key}" should have ${columns * rows} cells.`);
    }
    const known = seed.defs.layers.find((d) => d.identifier === key);
    const values =
      known?.intGridValues ??
      LEGACY_LAYER_VALUES[key] ??
      [...new Set(data.filter((v): v is number => Number.isInteger(v) && v > 0))]
        .sort((a, b) => a - b)
        .map((value) => ({ value, identifier: `value_${value}`, color: "#ff00ff" }));
    project.addIntGridLayer(key, values);
  }

  const level = project.createLevel("level_0", columns, rows);
  for (const [i, [, data]] of entries.entries()) {
    const layer = level.doc.getLayer(layerIdFor(project.defs.layers[i].uid))!;
    layer.data.set(data.map((v) => (Number.isInteger(v) ? v : 0)));
    layer.version++;
  }
  level.doc.setActiveLayer(level.doc.layers[0]?.id ?? null);
  return project;
}
