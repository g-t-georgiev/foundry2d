import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Ajv } from "ajv";
import { describe, expect, it } from "vite-plus/test";
import { buildSchemas, SCHEMA_DIR } from "../schemas";
import {
  soundFeatures,
  soundProblems,
  validateAsset,
  validateManifest,
  validateSoundAsset,
  type GameManifest,
  type SoundAsset,
} from "../src";

/** Sounds the pilot game ships (copied from it). */
const fixture = (name: string) =>
  JSON.parse(
    readFileSync(new URL(`./fixtures/${name}.sound.json`, import.meta.url), "utf8")
  ) as SoundAsset;
const sounds = ["intro", "siren-normal-0", "waka-wa"].map(fixture);

/** A sound using every optional feature, as Sound DSP Studio can write. */
const rich: SoundAsset = {
  version: 1,
  kind: "sequence",
  id: "hit",
  name: "Hit",
  durationSec: 0.3,
  harmonicWaves: { bright: { real: [0, 1, 0.5], imag: [0, 0, 0] } },
  tracks: [
    {
      id: "body",
      wave: "bright",
      level: 0.8,
      events: [
        {
          sweep: [
            [0, 440],
            [0.2, 220],
          ],
          envelope: [
            [0, 1],
            [0.3, 0],
          ],
        },
      ],
    },
    {
      id: "crack",
      kind: "noise",
      wave: "soft",
      level: 0.5,
      noise: { centerHz: 3000, q: 2 },
      events: [{ sweep: [[0, 1]] }],
    },
  ],
};

const manifest: GameManifest = {
  version: 1,
  game: "Pac-Man",
  contracts: {
    spritesheet: 1,
    animation: 1,
    level: 1,
    sound: { version: 1, features: ["envelope"] },
  },
  assets: {
    spritesheet: "public/assets/sprites",
    animation: "public/assets/sprites",
    level: "public/assets/levels",
    sound: "src/audio/sounds",
  },
  workFiles: "art",
};

describe("the sound contract", () => {
  it("accepts the pilot game's sounds and Sound DSP Studio's additions", () => {
    for (const sound of [...sounds, rich]) expect(validateAsset(sound).errors).toEqual([]);
  });

  it("refuses keys it doesn't know, so nothing is silently ignored", () => {
    const odd = { ...sounds[0], loudness: 3 };
    const { valid, errors } = validateSoundAsset(odd);
    expect(valid).toBe(false);
    expect(errors.join(" ")).toMatch(/loudness is not permitted by the sound contract/);
  });

  it("names the optional features a sound uses", () => {
    expect([...soundFeatures(rich)].sort()).toEqual(["envelope", "harmonicWaves", "noise"]);
    for (const sound of sounds) expect(soundFeatures(sound).size).toBe(0);
  });
});

describe("gs2d.json", () => {
  it("accepts a game's manifest and lists every problem in a bad one", () => {
    expect(validateManifest(manifest).errors).toEqual([]);
    const bad = {
      version: 1,
      game: "",
      contracts: { level: 2, music: 1, sound: { version: 1, features: ["reverb"] } },
      assets: { level: "../outside", sound: "C:/abs", spritesheet: "art/sprites" },
    };
    expect(validateManifest(bad).errors).toEqual([
      "game must be the game's name.",
      "contracts.level: the studio writes version 1.",
      "contracts.music isn't a kind the studio writes (spritesheet, animation, level, sound).",
      "contracts.sound.features has unknown features: reverb.",
      "assets.level must be a path inside the game's folder.",
      "assets.sound must be a path inside the game's folder.",
      "assets.spritesheet has no matching contracts.spritesheet.",
    ]);
  });

  it("says before writing a sound what the game's engine can't play", () => {
    expect(soundProblems(manifest, sounds[0])).toEqual([]);
    expect(soundProblems(manifest, rich)).toEqual([
      "Pac-Man's sound engine doesn't play: harmonicWaves, noise.",
    ]);
    const silent = { ...manifest, contracts: { level: 1 } };
    expect(soundProblems(silent, rich)).toEqual(["Pac-Man doesn't read sounds."]);
  });
});

describe("JSON schemas", () => {
  const built = buildSchemas();

  it("match the types (run `vp run docs` after changing a contract)", () => {
    for (const [file, text] of Object.entries(built)) {
      const written = readFileSync(join(SCHEMA_DIR, file), "utf8").replace(/\r\n/g, "\n");
      expect(written, file).toBe(text);
    }
  });

  it("agree with the validators on real files", () => {
    const ajv = new Ajv({ allErrors: true, strict: false });
    const compiled = new Map<string, ReturnType<typeof ajv.compile>>();
    const check = (file: string, data: unknown) => {
      let validate = compiled.get(file);
      if (!validate)
        compiled.set(file, (validate = ajv.compile(JSON.parse(built[file]) as object)));
      return validate(data)
        ? []
        : (validate.errors ?? []).map((e) => `${e.instancePath} ${e.message}`);
    };
    for (const sound of [...sounds, rich]) expect(check("sound.schema.json", sound)).toEqual([]);
    expect(check("gs2d.schema.json", manifest)).toEqual([]);
    expect(check("sound.schema.json", { ...sounds[0], loudness: 3 })).not.toEqual([]);
  });
});
