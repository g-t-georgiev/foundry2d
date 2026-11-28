import type { ValidationResult } from "./common";

/*
 * The sound contract (roadmap 12.1): `SoundAsset`, as Sound DSP Studio
 * defines it (its src/audio/SoundAsset.ts, a superset of the pilot game's).
 * Copied here as the one home of the contract, without the playback parts
 * (engine options, timing helpers, wavetable maths), which stay with each
 * SoundEngine. Its `kind` is the sound's type ("sequence" or "loop").
 *
 * Harmonic waves, envelopes and noise tracks are optional features (see
 * `soundFeatures`): a game lists the ones its engine plays in `gs2d.json`.
 * Within version 1 the contract only gains optional fields; a change that
 * breaks existing files is version 2.
 */

/** Built-in 32-step wavetable names provided by SoundEngine. */
export type BuiltinWaveName = "soft" | "buzz" | "rasp" | "pulse";

/** Any built-in wavetable name or a custom wave key declared in `customWaves`. */
export type WaveRef = BuiltinWaveName | (string & {});

/** A 32-step (or custom-length) 4-bit wavetable with integer sample levels 0-15. */
export type WaveTable = readonly number[];

/** One linear-ramp frequency point: seconds from event start, frequency in Hz. */
export type SweepPoint = readonly [offsetSec: number, hz: number];

/** Piecewise-linear frequency curve fed into `SoundEngine.tone()`. */
export type SoundSweep = readonly SweepPoint[];

/** LFO shapes supported by `SoundEngine` continuous looping sirens/tones. */
export type LfoShape = "triangle" | "sawtooth_up" | "sawtooth_down" | "sine" | "square";

/**
 * Links a recorded or authored sound back to a simulation/display frame rate
 * (such as the arcade's 60.60606 Hz or the 60 Hz simulation base).
 */
export interface SoundTimingBasis {
  fpsBasis: number;
  durationFrames?: number;
  lockToFps?: boolean;
}

/** Complex harmonic partials [0..N] where index k corresponds to harmonic k (0 = DC). */
export interface HarmonicWaveSpec {
  real: readonly number[];
  imag: readonly number[];
}

export interface SoundAssetBase {
  version: 1;
  id: string;
  name: string;
  /** Optional custom 4-bit (0-15) wavetables referenced by tracks or loop carrier. */
  customWaves?: Record<string, WaveTable>;
  /** Optional full-precision Fourier partial waves (real/imag) eliminating 4-bit quantization loss. */
  harmonicWaves?: Record<string, HarmonicWaveSpec>;
  /** Frame-rate metadata captured or configured by the external analyzer. */
  timing?: SoundTimingBasis;
}

export interface SoundSequenceEvent {
  /** Delay from sequence start in seconds (may overlap other events/tracks). */
  delaySec?: number;
  /** Frame offset at `timing.fpsBasis`, used if `delaySec` is omitted. */
  delayFrames?: number;
  /** Piecewise-linear frequency points: [[offsetSec, hz], ...]. */
  sweep: SoundSweep;
  /** Optional piecewise-linear relative amplitude points: [[offsetSec, gainMultiplier 0..1], ...]. */
  envelope?: SoundSweep;
  /** Optional per-event gain override (0-1); falls back to track `level`. */
  level?: number;
  /** Optional per-event waveform override; falls back to track `wave`. */
  wave?: WaveRef;
  /** Optional click-free release ramp duration in seconds (default 0.01). */
  releaseSec?: number;
}

export interface SoundNoiseTrackConfig {
  centerHz?: number;
  q?: number;
}

export interface SoundSequenceTrack {
  id: string;
  name?: string;
  kind?: "tone" | "noise";
  wave: WaveRef;
  level: number;
  noise?: SoundNoiseTrackConfig;
  events: readonly SoundSequenceEvent[];
}

/**
 * Discrete, multi-sweep, or polyphonic overlapping sound cue (e.g. intro tune,
 * death sound, extra life dual-voice beeps, alternating chomp).
 */
export interface SoundSequenceAsset extends SoundAssetBase {
  kind: "sequence";
  durationSec: number;
  /** Whether the sound is intended to stretch/fit a caller-provided target duration. */
  scalable?: boolean;
  tracks: readonly SoundSequenceTrack[];
}

export interface SoundLfoConfig {
  shape: LfoShape;
  loHz: number;
  hiHz: number;
  /** LFO modulation cycles per second (Hz). Optional if `periodSec` or `framesPerCycle` is set. */
  rateHz?: number;
  /** Duration of one LFO cycle in seconds. Optional if `rateHz` or `framesPerCycle` is set. */
  periodSec?: number;
  /** Number of frames per cycle at `timing.fpsBasis` (e.g. 25 frames @ 60.60606 Hz). */
  framesPerCycle?: number;
}

export interface SoundPatternLoopConfig {
  periodSec?: number;
  framesPerCycle?: number;
  tracks: readonly SoundSequenceTrack[];
}

/**
 * Continuous looping sound: either an LFO-swept carrier (sirens) or a
 * repeating multi-track loop pattern synced to a period / frame count.
 */
export interface SoundLoopAsset extends SoundAssetBase {
  kind: "loop";
  wave: WaveRef;
  level: number;
  loopMode: "lfo" | "pattern";
  lfo?: SoundLfoConfig;
  pattern?: SoundPatternLoopConfig;
}

export type SoundAsset = SoundSequenceAsset | SoundLoopAsset;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFinitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function isFiniteNonNegative(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function checkAllowedKeys(
  obj: Record<string, unknown>,
  allowed: readonly string[],
  prefix: string,
  errors: string[]
): void {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      errors.push(`${prefix}.${key} is not permitted by the sound contract.`);
    }
  }
}

function validateTracks(tracks: unknown, prefix: string, errors: string[]): void {
  if (!Array.isArray(tracks) || tracks.length === 0) {
    errors.push(`${prefix} must be a non-empty array.`);
    return;
  }
  tracks.forEach((track, ti) => {
    const tPath = `${prefix}[${ti}]`;
    if (!isRecord(track)) {
      errors.push(`${tPath} must be an object.`);
      return;
    }
    checkAllowedKeys(
      track,
      ["id", "name", "kind", "wave", "level", "noise", "events"],
      tPath,
      errors
    );
    if (typeof track.id !== "string" || track.id.length === 0) {
      errors.push(`${tPath}.id must be a non-empty string.`);
    }
    if (track.name !== undefined && typeof track.name !== "string") {
      errors.push(`${tPath}.name must be a string.`);
    }
    if (track.kind !== undefined && track.kind !== "tone" && track.kind !== "noise") {
      errors.push(`${tPath}.kind must be 'tone' or 'noise'.`);
    }
    if (typeof track.wave !== "string" || track.wave.length === 0) {
      errors.push(`${tPath}.wave must be a non-empty string.`);
    }
    if (!isFiniteNonNegative(track.level) || track.level > 1) {
      errors.push(`${tPath}.level must be a finite number in [0, 1].`);
    }
    if (track.noise !== undefined) {
      if (!isRecord(track.noise)) {
        errors.push(`${tPath}.noise must be an object.`);
      } else {
        checkAllowedKeys(track.noise, ["centerHz", "q"], `${tPath}.noise`, errors);
        if (track.noise.centerHz !== undefined && !isFinitePositive(track.noise.centerHz)) {
          errors.push(`${tPath}.noise.centerHz must be > 0.`);
        }
        if (track.noise.q !== undefined && !isFinitePositive(track.noise.q)) {
          errors.push(`${tPath}.noise.q must be > 0.`);
        }
      }
    }
    if (!Array.isArray(track.events) || track.events.length === 0) {
      errors.push(`${tPath}.events must be a non-empty array.`);
      return;
    }
    track.events.forEach((evt, ei) => {
      const ePath = `${tPath}.events[${ei}]`;
      if (!isRecord(evt)) {
        errors.push(`${ePath} must be an object.`);
        return;
      }
      checkAllowedKeys(
        evt,
        ["delaySec", "delayFrames", "sweep", "envelope", "level", "wave", "releaseSec"],
        ePath,
        errors
      );
      if (evt.delaySec !== undefined && !isFiniteNonNegative(evt.delaySec)) {
        errors.push(`${ePath}.delaySec must be >= 0.`);
      }
      if (evt.delayFrames !== undefined && !isFiniteNonNegative(evt.delayFrames)) {
        errors.push(`${ePath}.delayFrames must be >= 0.`);
      }
      if (evt.level !== undefined && (!isFiniteNonNegative(evt.level) || evt.level > 1)) {
        errors.push(`${ePath}.level must be a finite number in [0, 1].`);
      }
      if (evt.wave !== undefined && (typeof evt.wave !== "string" || evt.wave.length === 0)) {
        errors.push(`${ePath}.wave must be a non-empty string.`);
      }
      if (evt.releaseSec !== undefined && !isFiniteNonNegative(evt.releaseSec)) {
        errors.push(`${ePath}.releaseSec must be >= 0.`);
      }
      if (evt.envelope !== undefined) {
        if (!Array.isArray(evt.envelope) || evt.envelope.length === 0) {
          errors.push(`${ePath}.envelope must be a non-empty array of [offsetSec, gain] pairs.`);
        } else {
          evt.envelope.forEach((pt, pi) => {
            if (
              !Array.isArray(pt) ||
              pt.length !== 2 ||
              !isFiniteNonNegative(pt[0]) ||
              !isFiniteNonNegative(pt[1])
            ) {
              errors.push(`${ePath}.envelope[${pi}] must be [offsetSec >= 0, gain >= 0].`);
            }
          });
        }
      }
      if (!Array.isArray(evt.sweep) || evt.sweep.length === 0) {
        errors.push(`${ePath}.sweep must be a non-empty array of [offsetSec, hz] pairs.`);
        return;
      }
      evt.sweep.forEach((pt, pi) => {
        if (
          !Array.isArray(pt) ||
          pt.length !== 2 ||
          !isFiniteNonNegative(pt[0]) ||
          !isFinitePositive(pt[1])
        ) {
          errors.push(`${ePath}.sweep[${pi}] must be [offsetSec >= 0, hz > 0].`);
        }
      });
    });
  });
}

/** Validates an untrusted JSON object strictly against `docs/sound-asset.schema.json`. */
export function validateSoundAsset(raw: unknown): ValidationResult {
  const errors: string[] = [];
  if (!isRecord(raw)) {
    return { valid: false, errors: ["SoundAsset must be a JSON object."] };
  }
  if (raw.version !== 1) errors.push("version must be 1.");
  if (typeof raw.id !== "string" || raw.id.length === 0) {
    errors.push("id must be a non-empty string.");
  }
  if (typeof raw.name !== "string" || raw.name.length === 0) {
    errors.push("name must be a non-empty string.");
  }

  if (raw.timing !== undefined) {
    if (!isRecord(raw.timing)) {
      errors.push("timing must be an object.");
    } else {
      checkAllowedKeys(raw.timing, ["fpsBasis", "durationFrames", "lockToFps"], "timing", errors);
      if (!isFinitePositive(raw.timing.fpsBasis)) {
        errors.push("timing.fpsBasis must be a positive finite number.");
      }
      if (
        raw.timing.durationFrames !== undefined &&
        !isFiniteNonNegative(raw.timing.durationFrames)
      ) {
        errors.push("timing.durationFrames must be >= 0.");
      }
      if (raw.timing.lockToFps !== undefined && typeof raw.timing.lockToFps !== "boolean") {
        errors.push("timing.lockToFps must be a boolean.");
      }
    }
  }

  if (raw.customWaves !== undefined) {
    if (!isRecord(raw.customWaves)) {
      errors.push("customWaves must be an object mapping wave names to step arrays.");
    } else {
      for (const [waveName, table] of Object.entries(raw.customWaves)) {
        if (
          !Array.isArray(table) ||
          table.length < 2 ||
          table.some((v) => typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 15)
        ) {
          errors.push(`customWaves.${waveName} must be an array (>= 2) of numbers in [0, 15].`);
        }
      }
    }
  }

  if (raw.harmonicWaves !== undefined) {
    if (!isRecord(raw.harmonicWaves)) {
      errors.push("harmonicWaves must be an object mapping wave names to { real, imag } partials.");
    } else {
      for (const [waveName, spec] of Object.entries(raw.harmonicWaves)) {
        if (
          !isRecord(spec) ||
          !Array.isArray(spec.real) ||
          !Array.isArray(spec.imag) ||
          spec.real.length < 2 ||
          spec.real.length !== spec.imag.length ||
          spec.real.some((v) => typeof v !== "number" || !Number.isFinite(v)) ||
          spec.imag.some((v) => typeof v !== "number" || !Number.isFinite(v))
        ) {
          errors.push(
            `harmonicWaves.${waveName} must have matching finite numeric real[] and imag[] arrays (len >= 2).`
          );
        }
      }
    }
  }

  if (raw.kind === "sequence") {
    checkAllowedKeys(
      raw,
      [
        "version",
        "id",
        "name",
        "kind",
        "durationSec",
        "scalable",
        "customWaves",
        "harmonicWaves",
        "timing",
        "tracks",
      ],
      "root",
      errors
    );
    if (!isFinitePositive(raw.durationSec)) {
      errors.push("sequence.durationSec must be a positive finite number.");
    }
    if (raw.scalable !== undefined && typeof raw.scalable !== "boolean") {
      errors.push("sequence.scalable must be a boolean.");
    }
    validateTracks(raw.tracks, "tracks", errors);
  } else if (raw.kind === "loop") {
    checkAllowedKeys(
      raw,
      [
        "version",
        "id",
        "name",
        "kind",
        "wave",
        "level",
        "loopMode",
        "customWaves",
        "harmonicWaves",
        "timing",
        "lfo",
        "pattern",
      ],
      "root",
      errors
    );
    if (typeof raw.wave !== "string" || raw.wave.length === 0) {
      errors.push("loop.wave must be a non-empty string.");
    }
    if (!isFiniteNonNegative(raw.level) || raw.level > 1) {
      errors.push("loop.level must be a finite number in [0, 1].");
    }
    if (raw.loopMode === "lfo") {
      if (raw.pattern !== undefined) {
        errors.push("loop.pattern must not be set when loopMode is 'lfo'.");
      }
      if (!isRecord(raw.lfo)) {
        errors.push("loop.lfo is required when loopMode is 'lfo'.");
      } else {
        checkAllowedKeys(
          raw.lfo,
          ["shape", "loHz", "hiHz", "rateHz", "periodSec", "framesPerCycle"],
          "loop.lfo",
          errors
        );
        const validShapes = ["triangle", "sawtooth_up", "sawtooth_down", "sine", "square"];
        if (typeof raw.lfo.shape !== "string" || !validShapes.includes(raw.lfo.shape)) {
          errors.push(`loop.lfo.shape must be one of: ${validShapes.join(", ")}.`);
        }
        if (!isFinitePositive(raw.lfo.loHz) || !isFinitePositive(raw.lfo.hiHz)) {
          errors.push("loop.lfo.loHz and hiHz must be positive finite numbers.");
        }
        if (raw.lfo.rateHz !== undefined && !isFinitePositive(raw.lfo.rateHz)) {
          errors.push("loop.lfo.rateHz must be > 0.");
        }
        if (raw.lfo.periodSec !== undefined && !isFinitePositive(raw.lfo.periodSec)) {
          errors.push("loop.lfo.periodSec must be > 0.");
        }
        if (raw.lfo.framesPerCycle !== undefined && !isFinitePositive(raw.lfo.framesPerCycle)) {
          errors.push("loop.lfo.framesPerCycle must be > 0.");
        }
        const hasTiming =
          isFinitePositive(raw.lfo.rateHz) ||
          isFinitePositive(raw.lfo.periodSec) ||
          isFinitePositive(raw.lfo.framesPerCycle);
        if (!hasTiming) {
          errors.push("loop.lfo requires at least one of rateHz, periodSec, or framesPerCycle.");
        }
      }
    } else if (raw.loopMode === "pattern") {
      if (raw.lfo !== undefined) {
        errors.push("loop.lfo must not be set when loopMode is 'pattern'.");
      }
      if (!isRecord(raw.pattern)) {
        errors.push("loop.pattern is required when loopMode is 'pattern'.");
      } else {
        checkAllowedKeys(
          raw.pattern,
          ["periodSec", "framesPerCycle", "tracks"],
          "loop.pattern",
          errors
        );
        if (raw.pattern.periodSec !== undefined && !isFinitePositive(raw.pattern.periodSec)) {
          errors.push("loop.pattern.periodSec must be > 0.");
        }
        if (
          raw.pattern.framesPerCycle !== undefined &&
          !isFinitePositive(raw.pattern.framesPerCycle)
        ) {
          errors.push("loop.pattern.framesPerCycle must be > 0.");
        }
        const hasPeriod =
          isFinitePositive(raw.pattern.periodSec) || isFinitePositive(raw.pattern.framesPerCycle);
        if (!hasPeriod) {
          errors.push("loop.pattern requires positive periodSec or framesPerCycle.");
        }
        validateTracks(raw.pattern.tracks, "pattern.tracks", errors);
      }
    } else {
      errors.push("loop.loopMode must be 'lfo' or 'pattern'.");
    }
  } else {
    errors.push("kind must be 'sequence' or 'loop'.");
  }

  return { valid: errors.length === 0, errors };
}

export function isSoundAsset(raw: unknown): raw is SoundAsset {
  return validateSoundAsset(raw).valid;
}

export function parseSoundAsset(input: unknown): SoundAsset {
  const parsed: unknown = typeof input === "string" ? JSON.parse(input) : input;
  const result = validateSoundAsset(parsed);
  if (!result.valid) {
    throw new Error(`Invalid SoundAsset: ${result.errors.join(" ")}`);
  }
  return parsed as SoundAsset;
}

/** Optional parts of the contract a game's engine may not play (`gs2d.json` lists the ones it does). */
export const SOUND_FEATURES = ["harmonicWaves", "envelope", "noise"] as const;
export type SoundFeature = (typeof SOUND_FEATURES)[number];

/** The optional features a sound uses, so a tool can warn before writing it for a game. */
export function soundFeatures(asset: SoundAsset): Set<SoundFeature> {
  const used = new Set<SoundFeature>();
  if (asset.harmonicWaves && Object.keys(asset.harmonicWaves).length) used.add("harmonicWaves");
  const tracks =
    asset.kind === "sequence"
      ? asset.tracks
      : (asset.pattern?.tracks ?? ([] as SoundSequenceTrack[]));
  for (const track of tracks) {
    if (track.kind === "noise" || track.noise) used.add("noise");
    if (track.events.some((e) => e.envelope && e.envelope.length)) used.add("envelope");
  }
  return used;
}
