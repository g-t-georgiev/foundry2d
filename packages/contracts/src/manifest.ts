import { isInt, isRecord, isText, result, type ValidationResult } from "./common";
import { SOUND_FEATURES, soundFeatures, type SoundAsset, type SoundFeature } from "./sound";

/**
 * `gs2d.json` at the root of a game's folder (roadmap 12.2): which
 * contracts the game reads, where each kind of asset goes, and where the
 * tools keep their work files. The studio writes nothing the game didn't
 * ask for.
 */
export interface GameManifest {
  version: 1;
  /** The game's name. */
  game: string;
  contracts: Partial<{
    spritesheet: ContractUse;
    animation: ContractUse;
    level: ContractUse;
    /** With the optional features the game's sound engine plays. */
    sound: ContractUse<SoundFeature>;
  }>;
  /** Where each kind is written, relative to the game's folder. */
  assets: Partial<Record<ManifestKind, string>>;
  /** Where the tools keep their work files in the game's repository. */
  workFiles?: string;
}

/** The kinds a manifest names. */
export type ManifestKind = "spritesheet" | "animation" | "level" | "sound";

/** A contract's version, or the version and the optional features the game supports. */
export type ContractUse<Feature extends string = string> =
  | number
  | { version: number; features?: Feature[] };

const KINDS = ["spritesheet", "animation", "level", "sound"] as const;

/** A relative path inside the game's folder: no drive, no leading slash, no "..". */
const isInsidePath = (v: unknown): v is string =>
  isText(v) && !/^([a-z]:|[\\/])/i.test(v) && !v.split(/[\\/]/).includes("..");

export function validateManifest(raw: unknown): ValidationResult {
  if (!isRecord(raw)) return result(["gs2d.json must be a JSON object."]);
  const errors: string[] = [];
  if (raw.version !== 1) errors.push("version must be 1.");
  if (!isText(raw.game)) errors.push("game must be the game's name.");
  if (!isRecord(raw.contracts)) errors.push("contracts must list the kinds the game reads.");
  else {
    for (const [kind, use] of Object.entries(raw.contracts)) {
      if (!(KINDS as readonly string[]).includes(kind)) {
        errors.push(`contracts.${kind} isn't a kind the studio writes (${KINDS.join(", ")}).`);
        continue;
      }
      const version = isRecord(use) ? use.version : use;
      if (!isInt(version, 1))
        errors.push(`contracts.${kind} must be a version, or { version, features }.`);
      else if (version !== 1) errors.push(`contracts.${kind}: the studio writes version 1.`);
      if (isRecord(use) && use.features !== undefined) {
        const allowed: readonly string[] = kind === "sound" ? SOUND_FEATURES : [];
        const bad = Array.isArray(use.features)
          ? use.features.filter((f) => !allowed.includes(f as string))
          : ["(not a list)"];
        if (bad.length)
          errors.push(`contracts.${kind}.features has unknown features: ${bad.join(", ")}.`);
      }
    }
  }
  if (!isRecord(raw.assets)) errors.push("assets must say where each kind goes.");
  else {
    for (const [kind, path] of Object.entries(raw.assets)) {
      if (!(KINDS as readonly string[]).includes(kind)) errors.push(`assets.${kind} isn't a kind.`);
      else if (!isInsidePath(path))
        errors.push(`assets.${kind} must be a path inside the game's folder.`);
      else if (isRecord(raw.contracts) && !(kind in raw.contracts)) {
        errors.push(`assets.${kind} has no matching contracts.${kind}.`);
      }
    }
  }
  if (raw.workFiles !== undefined && !isInsidePath(raw.workFiles)) {
    errors.push("workFiles must be a path inside the game's folder.");
  }
  return result(errors);
}

/**
 * Why a tool shouldn't write a sound into this game, or an empty list: the
 * game doesn't read sounds, or the sound uses features its engine lacks.
 */
export function soundProblems(manifest: GameManifest, sound: SoundAsset): string[] {
  const use = manifest.contracts.sound;
  if (use === undefined) return [`${manifest.game} doesn't read sounds.`];
  const supported = new Set(typeof use === "number" ? [] : (use.features ?? []));
  const missing = [...soundFeatures(sound)].filter((f) => !supported.has(f));
  return missing.length
    ? [`${manifest.game}'s sound engine doesn't play: ${missing.join(", ")}.`]
    : [];
}
