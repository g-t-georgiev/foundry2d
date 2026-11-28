import type {
  FieldValue as ContractField,
  LevelAsset,
  LevelEntity,
  LevelGrid,
  LevelTiles,
  SpriteFrame,
  SpriteSheetAsset,
} from "@gs2d/contracts";
import { layerIdFor, type Level, type LevelProject } from "../model/LevelProject";
import { tileSourceRect, tilesetGrid } from "../model/tiles";
import type { TilesetDef } from "../model/types";
import { entitiesForLayer, exportFields, type GameFieldValue } from "./gameFormat";

/**
 * Levels' export to Game Studio 2D's contracts (roadmap 12.1): a `level`
 * file per level, and a `spritesheet` file per tileset its tile layers
 * use, naming each tile `tile_<id>`. Tile stacks of auto-layers aren't in
 * the contract: a cell keeps its top tile.
 */

/** A tile's sprite name in its tileset's sheet. */
export const tileName = (tileId: number) => `tile_${tileId}`;

/** The tileset image's file name in an export. */
export const tilesetImageName = (tileset: TilesetDef) =>
  tileset.image.fileName ?? `${tileset.identifier}.png`;

/** A tileset as a sprite sheet: one sprite per tile of its grid. */
export function tilesetSheet(tileset: TilesetDef): SpriteSheetAsset {
  const { columns, rows } = tilesetGrid(tileset);
  const frames: Record<string, SpriteFrame> = {};
  for (let id = 0; id < columns * rows; id++) {
    const rect = tileSourceRect(tileset, id)!;
    frames[tileName(id)] = { x: rect.x, y: rect.y, w: rect.width, h: rect.height };
  }
  return {
    version: 1,
    kind: "spritesheet",
    id: tileset.identifier,
    name: tileset.identifier,
    image: tilesetImageName(tileset),
    width: tileset.image.width,
    height: tileset.image.height,
    frames,
  };
}

/** "#abc" and "#aabbcc" as "#aabbcc"; anything else as `undefined`. */
function hexColor(color: string): string | undefined {
  const c = color.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(c)) return c;
  if (/^#[0-9a-f]{3}$/.test(c)) return c.replace(/[0-9a-f]/g, (d) => d + d);
  return undefined;
}

function contractField(value: GameFieldValue): ContractField {
  if (Array.isArray(value)) return value.map(contractField);
  if (value && typeof value === "object" && "iid" in value) {
    return { entity: value.iid, level: value.level };
  }
  return value;
}

const contractFields = (fields: Record<string, GameFieldValue>) =>
  Object.fromEntries(Object.entries(fields).map(([k, v]) => [k, contractField(v)]));

export function toLevelContract(project: LevelProject, level: Level): LevelAsset {
  const grids: Record<string, LevelGrid> = {};
  const tiles: Record<string, LevelTiles> = {};
  const entities: LevelEntity[] = [];
  for (const def of project.defs.layers) {
    if (def.type === "Entities") {
      for (const e of entitiesForLayer(project, level, def.uid)) {
        const entityDef = project.defs.entities.find((d) => d.identifier === e.id);
        entities.push({
          type: e.id,
          id: e.iid,
          layer: def.identifier,
          x: e.x,
          y: e.y,
          width: e.width,
          height: e.height,
          ...(entityDef && { pivot: { x: entityDef.pivotX, y: entityDef.pivotY } }),
          ...(Object.keys(e.fields).length && { fields: contractFields(e.fields) }),
        });
      }
      continue;
    }
    const layer = level.doc.getLayer(layerIdFor(def.uid));
    if (!layer) continue;
    const grid =
      def.gridSize !== undefined
        ? { grid: { size: def.gridSize, columns: layer.width, rows: layer.height } }
        : {};
    if (def.type === "IntGrid") {
      const values = Object.fromEntries(def.intGridValues.map((v) => [v.identifier, v.value]));
      const named = new Set(def.intGridValues.map((v) => v.value));
      // A value without a name means nothing to a game.
      const cells = Array.from(layer.data, (c) => (named.has(c) ? c : 0));
      grids[def.identifier] = { values, cells, ...grid };
    } else {
      const tileset = project.getTileset(def.tilesetUid);
      if (!tileset) continue;
      const { columns, rows } = tilesetGrid(tileset);
      tiles[def.identifier] = {
        sheet: tileset.identifier,
        tileNames: Array.from({ length: columns * rows }, (_, id) => tileName(id)),
        cells: Array.from(layer.data),
        ...grid,
      };
    }
  }
  const background = hexColor(project.levelBackground(level));
  const fields = project.defs.levelFields.length
    ? contractFields(exportFields(project, project.defs.levelFields, level))
    : undefined;
  return {
    version: 1,
    kind: "level",
    id: level.identifier,
    name: level.identifier,
    tileSize: project.gridSize,
    columns: level.width,
    rows: level.height,
    ...(background && { background }),
    grids,
    ...(Object.keys(tiles).length && { tiles }),
    ...(entities.length && { entities }),
    ...(fields && { fields }),
  };
}

/** The tilesets a level's tile layers use. */
export function levelTilesets(project: LevelProject): TilesetDef[] {
  const used = new Map<number, TilesetDef>();
  for (const def of project.defs.layers) {
    const tileset = def.type === "Tiles" ? project.getTileset(def.tilesetUid) : undefined;
    if (tileset) used.set(tileset.uid, tileset);
  }
  return [...used.values()];
}

/** JSON for a contract file, with lists of numbers (cells) on one line each. */
export function contractJson(value: unknown): string {
  const text = JSON.stringify(value, null, 2).replace(
    /\[\s*(-?\d[\d\s,.e+-]*?)\s*\]/g,
    (_, list: string) => `[${list.split(/\s*,\s*/).join(", ")}]`
  );
  return `${text}\n`;
}
