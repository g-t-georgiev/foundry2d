import {
  checkBase,
  checkTiming,
  isFinitePositive,
  isRecord,
  isText,
  result,
  type AssetBase,
  type TimingBasis,
  type ValidationResult,
} from "./common";

/**
 * Animations over the sprites of one sheet: named clips of frames with
 * their durations. Durations are milliseconds, or frames of
 * `timing.fpsBasis` for games that step in fixed frames (the pilot runs at
 * the arcade's 60.606 Hz).
 */
export interface AnimationAsset extends AssetBase<"animation"> {
  /** The sprite sheet's id. */
  sheet: string;
  timing?: TimingBasis;
  clips: Record<string, AnimationClip>;
}

export interface AnimationClip {
  frames: AnimationFrame[];
  /** How it repeats. Default "loop". */
  playback?: "loop" | "once" | "pingpong";
}

export interface AnimationFrame {
  /** A sprite's name on the sheet. */
  sprite: string;
  /** How long it shows: milliseconds… */
  ms?: number;
  /** …or frames at `timing.fpsBasis`. */
  frames?: number;
}

const PLAYBACK = ["loop", "once", "pingpong"];

/**
 * Validates an animation file. With `sprites`, the sprite names of its sheet,
 * it also checks that every frame names one of them.
 */
export function validateAnimation(raw: unknown, sprites?: Iterable<string>): ValidationResult {
  if (!isRecord(raw)) return result(["An animation must be a JSON object."]);
  const errors: string[] = [];
  checkBase(raw, "animation", errors);
  if (!isText(raw.sheet)) errors.push("sheet must be the sprite sheet's id.");
  checkTiming(raw.timing, errors);
  const hasFps = isRecord(raw.timing) && isFinitePositive(raw.timing.fpsBasis);
  const known = sprites ? new Set(sprites) : null;
  if (!isRecord(raw.clips)) {
    errors.push("clips must be an object of named clips.");
    return result(errors);
  }
  for (const [name, clip] of Object.entries(raw.clips)) {
    const where = `clips["${name}"]`;
    if (!isRecord(clip) || !Array.isArray(clip.frames) || clip.frames.length === 0) {
      errors.push(`${where} needs at least one frame.`);
      continue;
    }
    if (clip.playback !== undefined && !PLAYBACK.includes(clip.playback as string)) {
      errors.push(`${where}.playback must be one of: ${PLAYBACK.join(", ")}.`);
    }
    clip.frames.forEach((frame: unknown, i) => {
      const at = `${where}.frames[${i}]`;
      if (!isRecord(frame) || !isText(frame.sprite)) {
        errors.push(`${at}.sprite must name a sprite.`);
        return;
      }
      if (known && !known.has(frame.sprite)) {
        errors.push(`${at}.sprite "${frame.sprite}" isn't on the sheet.`);
      }
      const ms = isFinitePositive(frame.ms);
      const frames = isFinitePositive(frame.frames);
      if (ms === frames) errors.push(`${at} needs either ms or frames.`);
      else if (frames && !hasFps) errors.push(`${at}.frames needs timing.fpsBasis.`);
    });
  }
  return result(errors);
}

/** A frame's duration in milliseconds. */
export function frameMs(frame: AnimationFrame, timing?: TimingBasis): number {
  if (frame.ms !== undefined) return frame.ms;
  return ((frame.frames ?? 0) * 1000) / (timing?.fpsBasis ?? 60);
}
