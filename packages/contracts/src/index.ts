/**
 * Game Studio 2D's asset contracts (roadmap 12.1): the JSON files the tools
 * write into a game and the game reads. Versioned, plain data, each with a
 * validator. The sound contract is Sound DSP Studio's `SoundAsset` (see
 * `sound.ts`).
 */
import { isRecord, result, type ValidationResult } from "./common";
import { validateAnimation } from "./animation";
import { validateLevel } from "./level";
import { validateSoundAsset } from "./sound";
import { validateSpriteSheet } from "./spritesheet";

export * from "./common";
export * from "./spritesheet";
export * from "./animation";
export * from "./level";
export * from "./sound";
export * from "./manifest";

/** The asset kinds and the contract version the studio writes. */
export const CONTRACTS = { spritesheet: 1, animation: 1, level: 1, sound: 1 } as const;

export type AssetKind = keyof typeof CONTRACTS;

/**
 * Validates any asset file by its `kind`. Sounds keep the `kind` of their
 * contract: "sequence" or "loop".
 */
export function validateAsset(raw: unknown): ValidationResult {
  if (!isRecord(raw)) return result(["An asset must be a JSON object."]);
  switch (raw.kind) {
    case "spritesheet":
      return validateSpriteSheet(raw);
    case "animation":
      return validateAnimation(raw);
    case "level":
      return validateLevel(raw);
    case "sequence":
    case "loop":
      return validateSoundAsset(raw);
    default:
      return result([
        `kind must be one of: spritesheet, animation, level, sequence, loop (got ${JSON.stringify(raw.kind)}).`,
      ]);
  }
}
