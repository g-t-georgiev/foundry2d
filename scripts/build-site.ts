/**
 * `vp run build:site`: builds every app and puts them together as one site in
 * `build/site/`: the studio at the root, the apps and the manual in
 * folders (`pixel/`, `levels/`, `packer/`, `docs/`), on one origin wherever
 * it is served. `vp run preview:site` serves it on port 4180.
 */
import { execSync } from "node:child_process";
import { cpSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { SITE_APPS, type SiteApp } from "../packages/workspace/vite/site";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "build/site");

rmSync(out, { recursive: true, force: true });
for (const app of Object.keys(SITE_APPS) as SiteApp[]) {
  const dir = join(root, "apps", app);
  console.log(`building ${app}`);
  execSync("vp build", { cwd: dir, stdio: "inherit" });
  cpSync(join(dir, "dist"), join(out, SITE_APPS[app].path), { recursive: true });
}
console.log(`site written to build/site`);
