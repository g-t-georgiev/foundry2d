/// <reference types="vite/client" />
import { deserializeProject } from "../io/projectFile";
import type { LevelProject } from "./LevelProject";

export interface PresetInfo {
  /** File name without extension, e.g. "pacman". */
  id: string;
  label: string;
  description: string;
  order: number;
  json: unknown;
}

/**
 * Every `presets/*.f2dlevel.json` file, bundled when this module is transformed. Presets are
 * plain project files, so they go through the same validation as "Open".
 */
const files = import.meta.glob<unknown>("../../presets/*.f2dlevel.json", {
  eager: true,
  import: "default",
});

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

export const presets: readonly PresetInfo[] = Object.entries(files)
  .map(([path, json]) => {
    const id = path
      .split("/")
      .pop()!
      .replace(/\.f2dlevel\.json$/, "");
    const meta = isRecord(json) && isRecord(json.preset) ? json.preset : {};
    return {
      id,
      label: typeof meta.label === "string" ? meta.label : id,
      description: typeof meta.description === "string" ? meta.description : "",
      order: typeof meta.order === "number" ? meta.order : Number.MAX_SAFE_INTEGER,
      json,
    };
  })
  .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));

/** What a fresh start opens: an empty project (pick other presets under New). */
export const DEFAULT_PRESET_ID = "blank";

export function getPreset(id: string): PresetInfo | undefined {
  return presets.find((p) => p.id === id);
}

/** Creates a fresh project from a preset (each call returns an independent copy). */
export function createProjectFromPreset(id: string = DEFAULT_PRESET_ID): LevelProject {
  const preset = getPreset(id) ?? presets[0];
  if (!preset) throw new Error("No level presets found in apps/level-designer/presets.");
  return deserializeProject(preset.json);
}
