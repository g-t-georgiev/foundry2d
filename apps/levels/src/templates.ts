/// <reference types="vite/client" />
import type { ToolTemplate } from "@gs2d/workspace";

/**
 * The presets' `preset` blocks only (JSON named imports), so the studio's
 * hub can list them without bundling the projects. Same order as
 * `model/presets.ts`, which Levels uses to create them.
 */
const blocks = import.meta.glob<unknown>("../presets/*.gs2dlevel.json", {
  eager: true,
  import: "preset",
});

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** New level projects (read by Levels and the studio's hub). */
export const TEMPLATES: readonly ToolTemplate[] = Object.entries(blocks)
  .map(([path, block]) => {
    const id = path
      .split("/")
      .pop()!
      .replace(/\.gs2dlevel\.json$/, "");
    const meta = isRecord(block) ? block : {};
    return {
      id,
      label: typeof meta.label === "string" ? meta.label : id,
      description: typeof meta.description === "string" ? meta.description : "",
      order: typeof meta.order === "number" ? meta.order : Number.MAX_SAFE_INTEGER,
    };
  })
  .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label))
  .map(({ id, label, description }) => ({ id, label, description }));
