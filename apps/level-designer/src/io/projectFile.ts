import { decodeRLE, encodeRLE } from "@foundry2d/core";
import { LevelProject, layerIdFor } from "../model/LevelProject";
import type { IntGridValueDef, LayerDef } from "../model/types";

export const PROJECT_FORMAT = "foundry2d.level";
export const PROJECT_VERSION = 1;
export const PROJECT_EXTENSION = ".f2dlevel.json";

export interface SerializedLevelLayer {
  defUid: number;
  visible: boolean;
  opacity: number;
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
}

export interface LevelProjectFile {
  format: typeof PROJECT_FORMAT;
  version: number;
  name: string;
  gridSize: number;
  nextUid: number;
  defs: { layers: LayerDef[] };
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
    nextUid: project.uidCounter,
    defs: { layers: structuredClone(project.defs.layers) },
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
            data: encodeRLE(layer.data),
          };
        }),
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

  for (const [i, raw] of defs.entries()) {
    if (!isRecord(raw) || !isInt(raw.uid) || typeof raw.identifier !== "string") {
      throw new ProjectFormatError(`Layer definition #${i} is invalid.`);
    }
    if (raw.type !== "IntGrid") {
      throw new ProjectFormatError(
        `Layer "${raw.identifier}" has unsupported type ${String(raw.type)}.`
      );
    }
    project.defs.layers.push({
      uid: raw.uid,
      identifier: raw.identifier,
      type: "IntGrid",
      intGridValues: parseValues(raw.intGridValues, `Layer "${raw.identifier}"`),
    });
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
      if (typeof entry.opacity === "number")
        layer.opacity = Math.min(1, Math.max(0, entry.opacity));
    }
    if (isInt(raw.activeDefUid)) level.doc.setActiveLayer(layerIdFor(raw.activeDefUid));
  }

  return project;
}
