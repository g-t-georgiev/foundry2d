/**
 * The contracts' JSON schemas, made from their TypeScript types so the two
 * can't drift apart (they did when each project kept a hand-written one).
 * `vp run docs` writes them to `schemas/`; a test fails when the files fall
 * behind the types.
 */
import { createGenerator } from "ts-json-schema-generator";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));

/** File name → the type it describes. */
export const SCHEMAS: Readonly<Record<string, string>> = {
  "spritesheet.schema.json": "SpriteSheetAsset",
  "animation.schema.json": "AnimationAsset",
  "level.schema.json": "LevelAsset",
  "sound.schema.json": "SoundAsset",
  "gs2d.schema.json": "GameManifest",
};

export const SCHEMA_DIR = join(here, "schemas");

/** Every schema as the text written to its file. */
export function buildSchemas(): Record<string, string> {
  const generator = createGenerator({
    path: join(here, "src/index.ts"),
    tsconfig: join(here, "tsconfig.json"),
    skipTypeCheck: true,
    additionalProperties: false,
    jsDoc: "extended",
  });
  return Object.fromEntries(
    Object.entries(SCHEMAS).map(([file, type]) => {
      const schema = {
        ...generator.createSchema(type),
        $id: `https://gs2d.dev/schemas/${file}`,
        title: type,
      };
      return [file, `${JSON.stringify(schema, null, 2)}\n`];
    })
  );
}
