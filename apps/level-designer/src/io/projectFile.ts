import { decodeRLE, encodeRLE } from "@foundry2d/core";
import { LevelProject, layerIdFor } from "../model/LevelProject";
import {
  ENTITY_SHAPES,
  FIELD_TYPES,
  WORLD_LAYOUTS,
  type EntityDef,
  type EntityInstance,
  type EntityShape,
  type EnumDef,
  type FieldDef,
  type FieldType,
  type FieldValue,
  type IntGridValueDef,
  type LayerDef,
  type TilesetDef,
  type WorldLayout,
} from "../model/types";
import { initialDefault, isHexColor, newIid, validateFieldValue } from "../model/entities";
import { AUTO_RULE_SIZES, type AutoRule, type AutoRuleSize } from "../model/autoRules";

export const PROJECT_FORMAT = "foundry2d.level";
/** 2 added entity definitions, enums and entity instances. */
export const PROJECT_VERSION = 2;
export const PROJECT_EXTENSION = ".f2dlevel.json";

export interface SerializedLevelLayer {
  defUid: number;
  visible: boolean;
  opacity: number;
  /** Hand-locked layers (auto-layers are always locked and don't store it). */
  locked?: boolean;
  /** RLE-encoded cells: `[count, value, ...]`. */
  data: number[];
}

export interface SerializedLevel {
  uid: number;
  identifier: string;
  worldX: number;
  worldY: number;
  width: number;
  height: number;
  activeDefUid: number | null;
  layers: SerializedLevelLayer[];
  /** Entity instances (version 2+). */
  entities?: EntityInstance[];
}

export interface LevelProjectFile {
  format: typeof PROJECT_FORMAT;
  version: number;
  name: string;
  gridSize: number;
  worldLayout: WorldLayout;
  worldGrid: { width: number; height: number };
  nextUid: number;
  defs: {
    layers: LayerDef[];
    tilesets: TilesetDef[];
    entities?: EntityDef[];
    enums?: EnumDef[];
  };
  levels: SerializedLevel[];
}

export class ProjectFormatError extends Error {
  override name = "ProjectFormatError";
}

export function serializeProject(project: LevelProject): LevelProjectFile {
  return {
    format: PROJECT_FORMAT,
    version: PROJECT_VERSION,
    name: project.name,
    gridSize: project.gridSize,
    worldLayout: project.worldLayout,
    worldGrid: { ...project.worldGrid },
    nextUid: project.uidCounter,
    defs: {
      layers: structuredClone(project.defs.layers),
      tilesets: structuredClone(project.defs.tilesets),
      entities: structuredClone(project.defs.entities),
      enums: structuredClone(project.defs.enums),
    },
    levels: project.levels.map((level) => {
      const active = level.doc.activeLayerId;
      return {
        uid: level.uid,
        identifier: level.identifier,
        worldX: level.worldX,
        worldY: level.worldY,
        width: level.width,
        height: level.height,
        activeDefUid: project.getLayerDefForLayer(active ?? "")?.uid ?? null,
        layers: project.defs.layers.map((def) => {
          const layer = level.doc.getLayer(layerIdFor(def.uid))!;
          return {
            defUid: def.uid,
            visible: layer.visible,
            opacity: layer.opacity,
            ...(layer.locked && !project.isAutoLayer(def) ? { locked: true } : {}),
            data: encodeRLE(layer.data),
          };
        }),
        entities: structuredClone(level.entities),
      };
    }),
  };
}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const isInt = (v: unknown): v is number => typeof v === "number" && Number.isInteger(v);

function parseValues(raw: unknown, where: string): IntGridValueDef[] {
  if (!Array.isArray(raw)) throw new ProjectFormatError(`${where}: intGridValues must be a list.`);
  return raw.map((v, i) => {
    if (!isRecord(v) || !isInt(v.value) || v.value <= 0) {
      throw new ProjectFormatError(`${where}: value #${i} is invalid.`);
    }
    return {
      value: v.value,
      identifier: typeof v.identifier === "string" ? v.identifier : `value_${v.value}`,
      color: typeof v.color === "string" ? v.color : "#ff00ff",
    };
  });
}

function parseTileset(raw: unknown, index: number): TilesetDef {
  const where = `Tileset #${index}`;
  if (!isRecord(raw) || !isInt(raw.uid) || typeof raw.identifier !== "string") {
    throw new ProjectFormatError(`${where} is invalid.`);
  }
  const image = raw.image;
  if (
    !isRecord(image) ||
    typeof image.dataUrl !== "string" ||
    !image.dataUrl.startsWith("data:image/") ||
    !isInt(image.width) ||
    !isInt(image.height)
  ) {
    throw new ProjectFormatError(`${where} ("${raw.identifier}") has no valid embedded image.`);
  }
  const int = (v: unknown, fallback: number, min: number) => (isInt(v) && v >= min ? v : fallback);
  return {
    uid: raw.uid,
    identifier: raw.identifier,
    tileSize: int(raw.tileSize, 8, 1),
    spacing: int(raw.spacing, 0, 0),
    padding: int(raw.padding, 0, 0),
    image: {
      dataUrl: image.dataUrl,
      width: image.width,
      height: image.height,
      ...(typeof image.fileName === "string" ? { fileName: image.fileName } : {}),
    },
  };
}

const num = (v: unknown, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) ? v : fallback;

function parseEnum(raw: unknown, index: number): EnumDef {
  if (!isRecord(raw) || !isInt(raw.uid) || typeof raw.identifier !== "string") {
    throw new ProjectFormatError(`Enum #${index} is invalid.`);
  }
  const seen = new Set<string>();
  const values = (Array.isArray(raw.values) ? raw.values : []).flatMap((v) => {
    if (!isRecord(v) || typeof v.id !== "string" || !v.id || seen.has(v.id)) return [];
    seen.add(v.id);
    return [{ id: v.id, color: isHexColor(v.color) ? v.color : "#888888" }];
  });
  return { uid: raw.uid, identifier: raw.identifier, values };
}

function parseField(raw: unknown, where: string, enums: EnumDef[]): FieldDef {
  if (
    !isRecord(raw) ||
    !isInt(raw.uid) ||
    typeof raw.identifier !== "string" ||
    !FIELD_TYPES.includes(raw.type as FieldType)
  ) {
    throw new ProjectFormatError(`${where}: a field is invalid.`);
  }
  const type = raw.type as FieldType;
  const field: FieldDef = { uid: raw.uid, identifier: raw.identifier, type, defaultValue: null };
  if (type === "Enum") {
    field.enumUid =
      isInt(raw.enumUid) && enums.some((e) => e.uid === raw.enumUid) ? raw.enumUid : null;
  }
  if (type === "Int" || type === "Float") {
    field.min = typeof raw.min === "number" ? raw.min : null;
    field.max = typeof raw.max === "number" ? raw.max : null;
  }
  field.defaultValue =
    validateFieldValue(field, raw.defaultValue, enums) ??
    initialDefault(
      type,
      enums.find((e) => e.uid === field.enumUid)
    );
  return field;
}

function parseEntityDef(raw: unknown, index: number, project: LevelProject): EntityDef {
  if (!isRecord(raw) || !isInt(raw.uid) || typeof raw.identifier !== "string") {
    throw new ProjectFormatError(`Entity definition #${index} is invalid.`);
  }
  const where = `Entity "${raw.identifier}"`;
  const tile =
    isRecord(raw.tile) &&
    isInt(raw.tile.tilesetUid) &&
    isInt(raw.tile.tileId) &&
    project.getTileset(raw.tile.tilesetUid)
      ? { tilesetUid: raw.tile.tilesetUid, tileId: raw.tile.tileId }
      : null;
  let shape: EntityShape = ENTITY_SHAPES.includes(raw.shape as EntityShape)
    ? (raw.shape as EntityShape)
    : "rectangle";
  if (shape === "tile" && !tile) shape = "rectangle";
  const fields = (Array.isArray(raw.fields) ? raw.fields : []).map((f) =>
    parseField(f, where, project.defs.enums)
  );
  const clamp01 = (v: unknown) => Math.min(1, Math.max(0, num(v, 0.5)));
  return {
    uid: raw.uid,
    identifier: raw.identifier,
    color: isHexColor(raw.color) ? raw.color : "#4c9ffe",
    width: Math.max(1, Math.round(num(raw.width, project.gridSize))),
    height: Math.max(1, Math.round(num(raw.height, project.gridSize))),
    pivotX: clamp01(raw.pivotX),
    pivotY: clamp01(raw.pivotY),
    shape,
    tile,
    maxPerLevel: Math.max(0, Math.round(num(raw.maxPerLevel, 0))),
    fields,
  };
}

/** Keeps instances whose definition and layer exist; drops invalid field values. */
function parseEntities(raw: unknown, project: LevelProject): EntityInstance[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const result: EntityInstance[] = [];
  for (const entry of raw) {
    if (!isRecord(entry) || !isInt(entry.defUid) || !isInt(entry.layerUid)) continue;
    const def = project.getEntityDef(entry.defUid);
    if (!def || project.getLayerDef(entry.layerUid)?.type !== "Entities") continue;
    let iid = typeof entry.iid === "string" && entry.iid ? entry.iid : newIid();
    if (seen.has(iid)) iid = newIid();
    seen.add(iid);
    const fields: Record<string, FieldValue> = {};
    const stored = isRecord(entry.fields) ? entry.fields : {};
    for (const field of def.fields) {
      const value = validateFieldValue(field, stored[String(field.uid)], project.defs.enums);
      if (value !== undefined) fields[String(field.uid)] = value;
    }
    result.push({
      iid,
      defUid: def.uid,
      layerUid: entry.layerUid,
      x: num(entry.x, 0),
      y: num(entry.y, 0),
      fields,
    });
  }
  return result;
}

function parseAutoRules(raw: unknown[], project: LevelProject): AutoRule[] {
  return raw.flatMap((entry) => {
    if (!isRecord(entry) || !isInt(entry.uid)) return [];
    const size = AUTO_RULE_SIZES.includes(entry.size as AutoRuleSize)
      ? (entry.size as AutoRuleSize)
      : 3;
    const pattern = Array.isArray(entry.pattern) ? entry.pattern : [];
    project.reserveUid(entry.uid);
    return [
      {
        uid: entry.uid,
        active: entry.active !== false,
        size,
        pattern: Array.from({ length: size * size }, (_, i) =>
          isInt(pattern[i]) ? pattern[i] : 0
        ),
        tileIds: (Array.isArray(entry.tileIds) ? entry.tileIds : []).filter(
          (t): t is number => isInt(t) && t >= 0
        ),
        chance: Math.min(1, Math.max(0, num(entry.chance, 1))),
        flipX: entry.flipX === true,
        flipY: entry.flipY === true,
      },
    ];
  });
}

export function isProjectFile(json: unknown): boolean {
  return isRecord(json) && json.format === PROJECT_FORMAT;
}

/** Validates and decodes a native project file. */
export function deserializeProject(json: unknown): LevelProject {
  if (!isRecord(json) || json.format !== PROJECT_FORMAT) {
    throw new ProjectFormatError("Not a Foundry2D level project.");
  }
  if (!isInt(json.version) || json.version > PROJECT_VERSION) {
    throw new ProjectFormatError(`Unsupported project version: ${String(json.version)}`);
  }
  if (!isInt(json.gridSize) || json.gridSize < 1) {
    throw new ProjectFormatError("Project grid size is invalid.");
  }
  const defs = isRecord(json.defs) ? json.defs.layers : undefined;
  if (!Array.isArray(defs) || defs.length === 0) {
    throw new ProjectFormatError("Project has no layer definitions.");
  }
  if (!Array.isArray(json.levels) || json.levels.length === 0) {
    throw new ProjectFormatError("Project has no levels.");
  }

  const project = new LevelProject(
    typeof json.name === "string" ? json.name : "level",
    json.gridSize
  );

  const rawTilesets = isRecord(json.defs) ? json.defs.tilesets : undefined;
  if (rawTilesets !== undefined && !Array.isArray(rawTilesets)) {
    throw new ProjectFormatError("Project tilesets must be a list.");
  }
  for (const [i, raw] of (rawTilesets ?? []).entries()) {
    const tileset = parseTileset(raw, i);
    project.defs.tilesets.push(tileset);
    project.reserveUid(tileset.uid);
  }

  const rawEnums = isRecord(json.defs) ? json.defs.enums : undefined;
  for (const [i, raw] of (Array.isArray(rawEnums) ? rawEnums : []).entries()) {
    const def = parseEnum(raw, i);
    project.defs.enums.push(def);
    project.reserveUid(def.uid);
  }
  const rawEntities = isRecord(json.defs) ? json.defs.entities : undefined;
  for (const [i, raw] of (Array.isArray(rawEntities) ? rawEntities : []).entries()) {
    const def = parseEntityDef(raw, i, project);
    project.defs.entities.push(def);
    project.reserveUid(def.uid);
    for (const field of def.fields) project.reserveUid(field.uid);
  }

  for (const [i, raw] of defs.entries()) {
    if (!isRecord(raw) || !isInt(raw.uid) || typeof raw.identifier !== "string") {
      throw new ProjectFormatError(`Layer definition #${i} is invalid.`);
    }
    if (raw.type === "IntGrid") {
      project.defs.layers.push({
        uid: raw.uid,
        identifier: raw.identifier,
        type: "IntGrid",
        intGridValues: parseValues(raw.intGridValues, `Layer "${raw.identifier}"`),
      });
    } else if (raw.type === "Tiles") {
      const tilesetUid =
        isInt(raw.tilesetUid) && project.getTileset(raw.tilesetUid) ? raw.tilesetUid : null;
      project.defs.layers.push({
        uid: raw.uid,
        identifier: raw.identifier,
        type: "Tiles",
        intGridValues: [],
        tilesetUid,
        // The source is checked once every layer is known (it may come later).
        ...(isInt(raw.autoSourceUid) ? { autoSourceUid: raw.autoSourceUid } : {}),
        ...(Array.isArray(raw.autoRules)
          ? { autoRules: parseAutoRules(raw.autoRules, project) }
          : {}),
        ...(isInt(raw.autoSeed) ? { autoSeed: raw.autoSeed >>> 0 } : {}),
      });
    } else if (raw.type === "Entities") {
      project.defs.layers.push({
        uid: raw.uid,
        identifier: raw.identifier,
        type: "Entities",
        intGridValues: [],
      });
    } else {
      throw new ProjectFormatError(
        `Layer "${raw.identifier}" has unsupported type ${String(raw.type)}.`
      );
    }
    project.reserveUid(raw.uid);
  }

  for (const [i, raw] of json.levels.entries()) {
    if (
      !isRecord(raw) ||
      !isInt(raw.uid) ||
      !isInt(raw.width) ||
      !isInt(raw.height) ||
      raw.width < 1 ||
      raw.height < 1
    ) {
      throw new ProjectFormatError(`Level #${i} is invalid.`);
    }
    project.reserveUid(raw.uid);
  }
  if (isInt(json.nextUid)) project.reserveUid(json.nextUid - 1);
  if (WORLD_LAYOUTS.includes(json.worldLayout as WorldLayout)) {
    project.worldLayout = json.worldLayout as WorldLayout;
  }
  if (isRecord(json.worldGrid) && isInt(json.worldGrid.width) && isInt(json.worldGrid.height)) {
    project.worldGrid = {
      width: Math.max(1, json.worldGrid.width),
      height: Math.max(1, json.worldGrid.height),
    };
  }

  for (const raw of json.levels as Record<string, unknown>[]) {
    const width = raw.width as number;
    const height = raw.height as number;
    const level = project.createLevel(
      typeof raw.identifier === "string" ? raw.identifier : "level",
      width,
      height,
      {
        uid: raw.uid as number,
        worldX: isInt(raw.worldX) ? raw.worldX : 0,
        worldY: isInt(raw.worldY) ? raw.worldY : 0,
      }
    );

    const layers = Array.isArray(raw.layers) ? raw.layers : [];
    for (const entry of layers) {
      if (!isRecord(entry) || !isInt(entry.defUid)) continue;
      const layer = level.doc.getLayer(layerIdFor(entry.defUid));
      if (!layer) continue;
      if (Array.isArray(entry.data)) {
        try {
          layer.data = decodeRLE(entry.data as number[], width * height, Int32Array);
        } catch (error) {
          throw new ProjectFormatError(
            `Level "${level.identifier}" layer data is corrupt: ${(error as Error).message}`,
            { cause: error }
          );
        }
        layer.version++;
      }
      if (typeof entry.visible === "boolean") layer.visible = entry.visible;
      if (entry.locked === true) layer.locked = true;
      if (typeof entry.opacity === "number")
        layer.opacity = Math.min(1, Math.max(0, entry.opacity));
    }
    level.entities = parseEntities(raw.entities, project);
    if (isInt(raw.activeDefUid)) level.doc.setActiveLayer(layerIdFor(raw.activeDefUid));
  }

  for (const def of project.defs.layers) {
    if (def.autoSourceUid !== undefined && !project.isAutoLayer(def)) def.autoSourceUid = null;
  }
  // Locks follow the (now validated) auto-layer flags, and generated tiles are
  // rebuilt so they always match the rules, whatever the file stored.
  for (const level of project.levels) {
    for (const def of project.defs.layers) {
      const layer = level.doc.getLayer(layerIdFor(def.uid));
      if (layer && project.isAutoLayer(def)) layer.locked = true;
    }
  }
  project.regenerateAutoLayers();
  return project;
}
