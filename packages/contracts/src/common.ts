/**
 * What every Game Studio 2D asset file shares (roadmap 12.1). The contracts
 * follow the pilot game's `SoundAsset`: a version, an id, a name and a kind,
 * plain JSON a game reads without the studio, and a validator that lists
 * every problem instead of stopping at the first.
 */

/** The fields every asset has. */
export interface AssetBase<Kind extends string> {
  /** The contract's version; a game refuses versions it doesn't know. */
  version: 1;
  kind: Kind;
  /** Stable id, how other assets and the game refer to it (e.g. "pacman-sprites"). */
  id: string;
  /** For people. */
  name: string;
}

/**
 * Ties durations given in frames to a frame rate, as the pilot game's
 * sounds do (e.g. the arcade's 60.606 Hz).
 */
export interface TimingBasis {
  fpsBasis: number;
}

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

export const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

export const isInt = (v: unknown, min = 0): v is number =>
  Number.isInteger(v) && (v as number) >= min;

export const isFinitePositive = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v > 0;

export const isText = (v: unknown): v is string => typeof v === "string" && v.length > 0;

/** Checks the shared fields; `kind` must be the given one. */
export function checkBase(raw: Record<string, unknown>, kind: string, errors: string[]): void {
  if (raw.version !== 1) errors.push("version must be 1.");
  if (raw.kind !== kind) errors.push(`kind must be "${kind}".`);
  if (!isText(raw.id)) errors.push("id must be a non-empty string.");
  if (!isText(raw.name)) errors.push("name must be a non-empty string.");
}

export function checkTiming(raw: unknown, errors: string[]): void {
  if (raw === undefined) return;
  if (!isRecord(raw) || !isFinitePositive(raw.fpsBasis)) {
    errors.push("timing.fpsBasis must be a positive finite number.");
  }
}

/** A point inside a sprite or entity, as fractions of its size (0..1 from the top-left). */
export function checkPivot(raw: unknown, where: string, errors: string[]): void {
  if (raw === undefined) return;
  const ok =
    isRecord(raw) &&
    typeof raw.x === "number" &&
    typeof raw.y === "number" &&
    Number.isFinite(raw.x) &&
    Number.isFinite(raw.y);
  if (!ok) errors.push(`${where}.pivot must be { x, y } numbers.`);
}

export const result = (errors: string[]): ValidationResult => ({
  valid: errors.length === 0,
  errors,
});
