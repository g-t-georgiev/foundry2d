/**
 * `vp run docs`: writes the generated parts of the docs. The shortcuts
 * articles come from the apps' key bindings (their tests fail when these
 * files are out of date), the contracts' JSON schemas come from their
 * types (likewise checked by a test); the API reference (`docs/api`, not committed)
 * comes from the packages' TSDoc comments through TypeDoc.
 */
import { execSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import * as levels from "../apps/levels/src/manual";
import * as packer from "../apps/packer/src/manual";
import * as pixel from "../apps/pixel/src/manual";
import { buildSchemas, SCHEMA_DIR } from "../packages/contracts/schemas";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

for (const app of [pixel, levels, packer]) {
  const path = join(root, app.SHORTCUTS_ARTICLE);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, app.shortcutsMarkdown());
  console.log(`wrote ${app.SHORTCUTS_ARTICLE}`);
}

// The contracts' JSON schemas, from their types.
mkdirSync(SCHEMA_DIR, { recursive: true });
for (const [file, text] of Object.entries(buildSchemas())) {
  writeFileSync(join(SCHEMA_DIR, file), text);
  console.log(`wrote packages/contracts/schemas/${file}`);
}

if (!process.argv.includes("--no-api")) {
  execSync("vp exec typedoc", { cwd: root, stdio: "inherit" });
}
