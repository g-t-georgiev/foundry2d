import type { ToolTemplate } from "@gs2d/workspace";
import { TEMPLATES as LEVELS_TEMPLATES } from "../../levels/src/templates";
import { TEMPLATES as PACKER_TEMPLATES } from "../../packer/src/templates";
import { TEMPLATES as PIXEL_TEMPLATES } from "../../pixel/src/templates";

/** A tool of the studio, as the hub shows it. */
export interface Tool {
  /** Also its id in browser storage and its folder on the site. */
  id: "pixel" | "levels" | "packer";
  name: string;
  /** What it is for, in a line. */
  blurb: string;
  templates: readonly ToolTemplate[];
}

export const TOOLS: readonly Tool[] = [
  {
    id: "pixel",
    name: "Pixel",
    blurb: "Sprites and animations, pixel by pixel.",
    templates: PIXEL_TEMPLATES,
  },
  {
    id: "levels",
    name: "Levels",
    blurb: "Levels from values, tiles and entities.",
    templates: LEVELS_TEMPLATES,
  },
  {
    id: "packer",
    name: "Packer",
    blurb: "Spritesheets with data for your engine.",
    templates: PACKER_TEMPLATES,
  },
];

export const toolOf = (app: string): Tool | undefined => TOOLS.find((t) => t.id === app);

/** Where a tool opens, with what the hub asks it to open (`?project=` and so on). */
export function toolUrl(
  tool: Tool["id"],
  request?: { kind: "project" | "recent" | "new"; id: string }
) {
  const query = request ? `?${request.kind}=${encodeURIComponent(request.id)}` : "";
  return `./${tool}/${query}`;
}
