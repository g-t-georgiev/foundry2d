import type { Storage } from "@gs2d/core";
import type { FileHandleLike } from "./files";

/**
 * The studio's tools and their work files (roadmap 11.4). The installed
 * studio handles every work-file type; a file it is given goes to the tool
 * that owns it, through the browser storage they share: it is kept as that
 * tool's recent file, and the tool opens it with `?recent=`.
 */
export type ToolId = "pixel" | "levels" | "packer";

/** Work-file names per tool, old ones included (longest first is how they're matched). */
export const TOOL_FILES: Readonly<Record<ToolId, readonly string[]>> = {
  pixel: [".gs2dsprite", ".f2dsprite", ".f2d.json"],
  levels: [".gs2dlevel", ".f2dlevel", ".gs2dlevel.json", ".f2dlevel.json"],
  packer: [".gs2dpack", ".f2dpack"],
};

/** The tool a work file belongs to, from its name; `null` for anything else. */
export function toolForFile(name: string): ToolId | null {
  const lower = name.toLowerCase();
  let best: { tool: ToolId; length: number } | null = null;
  for (const [tool, endings] of Object.entries(TOOL_FILES) as [ToolId, readonly string[]][]) {
    for (const ending of endings) {
      if (lower.endsWith(ending) && ending.length > (best?.length ?? 0)) {
        best = { tool, length: ending.length };
      }
    }
  }
  return best?.tool ?? null;
}

/**
 * Hands a file to its tool: keeps it as the tool's recent file and returns
 * the tool's address that opens it. `site` is the site's root, e.g.
 * `new URL("../", location.href)` from a tool or `location.href` from the hub.
 */
export async function sendFileToTool(
  storage: Storage,
  handle: FileHandleLike,
  tool: ToolId,
  site: URL
): Promise<string> {
  // The same id the tool's own session uses for the file.
  const id = `${tool}:${handle.name}`;
  await storage.recentFiles.put({ id, app: tool, name: handle.name, openedAt: Date.now(), handle });
  return new URL(`${tool}/?recent=${encodeURIComponent(id)}`, site).href;
}
