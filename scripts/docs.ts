/**
 * `vp run docs`: writes the generated parts of the docs. The shortcuts
 * articles come from the apps' key bindings (their tests fail when these
 * files are out of date); the API reference (`docs/api`, not committed)
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

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

for (const app of [pixel, levels, packer]) {
  const path = join(root, app.SHORTCUTS_ARTICLE);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, app.shortcutsMarkdown());
  console.log(`wrote ${app.SHORTCUTS_ARTICLE}`);
}

if (!process.argv.includes("--no-api")) {
  execSync("vp exec typedoc", { cwd: root, stdio: "inherit" });
}
