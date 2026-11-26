import type { ToolTemplate } from "@gs2d/workspace";

/** Sizes of new sprites, in pixels. */
export const NEW_SIZES = [16, 32, 64, 128];

/** What new sprites start from (read by Pixel and the studio's hub). */
export const TEMPLATES: readonly ToolTemplate[] = NEW_SIZES.map((s) => ({
  id: String(s),
  label: `${s} × ${s}`,
  description: "Empty sprite with one layer",
}));
