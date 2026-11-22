import type { AtlasOptions, MaxRectsHeuristic, PackAlgorithm } from "@foundry2d/atlas";
import { SHEET_FORMATS, type SheetFormatId } from "@foundry2d/formats";

export type DataFormat = SheetFormatId | "none";

/** Everything the packer is told, saved with the project. */
export interface PackSettings {
  algorithm: PackAlgorithm;
  heuristic: MaxRectsHeuristic;
  allowRotation: boolean;
  /** Pixels between sprites. */
  padding: number;
  /** Pixels around the sheet edge. */
  border: number;
  extrude: number;
  trim: boolean;
  alias: boolean;
  maxWidth: number;
  maxHeight: number;
  powerOfTwo: boolean;
  square: boolean;
  /** Grid columns; 0 picks them. */
  columns: number;
  dataFormat: DataFormat;
}

export const DEFAULT_SETTINGS: Readonly<PackSettings> = {
  algorithm: "maxrects",
  heuristic: "short-side",
  allowRotation: false,
  padding: 2,
  border: 0,
  extrude: 0,
  trim: true,
  alias: true,
  maxWidth: 2048,
  maxHeight: 2048,
  powerOfTwo: false,
  square: false,
  columns: 0,
  dataFormat: "json-hash",
};

export const ALGORITHMS: readonly PackAlgorithm[] = [
  "maxrects",
  "shelf",
  "grid",
  "horizontal",
  "vertical",
];
export const HEURISTICS: readonly MaxRectsHeuristic[] = [
  "short-side",
  "long-side",
  "area",
  "bottom-left",
];
/** Canvas sides past this fail in some browsers. */
export const MAX_SHEET_SIDE = 8192;

const LIMITS = {
  padding: [0, 256],
  border: [0, 256],
  extrude: [0, 64],
  maxWidth: [1, MAX_SHEET_SIDE],
  maxHeight: [1, MAX_SHEET_SIDE],
  columns: [0, 4096],
} as const;

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** Settings from untrusted data (a file or a form): bad or missing values keep `base`'s. */
export function parseSettings(
  raw: unknown,
  base: Readonly<PackSettings> = DEFAULT_SETTINGS
): PackSettings {
  const r = isRecord(raw) ? raw : {};
  const bool = (key: "allowRotation" | "trim" | "alias" | "powerOfTwo" | "square") =>
    typeof r[key] === "boolean" ? r[key] : base[key];
  const int = (key: keyof typeof LIMITS) => {
    const value = r[key];
    if (typeof value !== "number" || !Number.isFinite(value)) return base[key];
    const [min, max] = LIMITS[key];
    return Math.min(max, Math.max(min, Math.round(value)));
  };
  const one = <T extends string>(key: string, allowed: readonly T[], fallback: T): T =>
    allowed.find((a) => a === r[key]) ?? fallback;
  return {
    algorithm: one("algorithm", ALGORITHMS, base.algorithm),
    heuristic: one("heuristic", HEURISTICS, base.heuristic),
    allowRotation: bool("allowRotation"),
    padding: int("padding"),
    border: int("border"),
    extrude: int("extrude"),
    trim: bool("trim"),
    alias: bool("alias"),
    maxWidth: int("maxWidth"),
    maxHeight: int("maxHeight"),
    powerOfTwo: bool("powerOfTwo"),
    square: bool("square"),
    columns: int("columns"),
    dataFormat: one<DataFormat>(
      "dataFormat",
      [...SHEET_FORMATS.map((f) => f.id), "none"],
      base.dataFormat
    ),
  };
}

/**
 * Why sprites can't be rotated with these settings, or `null` when they can.
 * The choice itself is kept, so it comes back with a format that allows it.
 */
export function rotationBlocked(settings: PackSettings): string | null {
  if (settings.algorithm !== "maxrects" && settings.algorithm !== "shelf") {
    return "Strips and grids keep sprites upright.";
  }
  const format = SHEET_FORMATS.find((f) => f.id === settings.dataFormat);
  return format && !format.supportsRotation ? `${format.label} can't describe rotation.` : null;
}

/** The engine's options for these settings. */
export function atlasOptions(settings: PackSettings): AtlasOptions {
  const { dataFormat: _format, ...options } = settings;
  return { ...options, allowRotation: settings.allowRotation && !rotationBlocked(settings) };
}
