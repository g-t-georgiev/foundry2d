/// <reference types="vite/client" />
import { buildManual } from "./manual";

/*
 * The manual's Markdown and images, read at build time from `docs/` (the
 * single source of truth). Changing an article reloads the page in
 * development.
 */
const markdown = import.meta.glob<string>("../../../docs/manual/**/*.md", {
  query: "?raw",
  import: "default",
  eager: true,
});
const pictures = import.meta.glob<string>("../../../docs/images/*", {
  query: "?url",
  import: "default",
  eager: true,
});

const relative = (files: Record<string, string>, base: string) =>
  Object.fromEntries(
    Object.entries(files).map(([path, value]) => [path.slice(base.length), value])
  );

export const manual = buildManual(
  relative(markdown, "../../../docs/manual/"),
  relative(pictures, "../../../docs/")
);

/** The apps, for "Open in app" links. Set `VITE_*_URL` when they are served elsewhere. */
export const APP_LINKS: Record<string, { label: string; url: string }> = {
  "pixel-editor": {
    label: "Open the Pixel Editor",
    url:
      import.meta.env.VITE_PIXEL_EDITOR_URL ??
      (import.meta.env.DEV ? "http://localhost:3000/" : "../pixel-editor/"),
  },
  "level-designer": {
    label: "Open the Level Designer",
    url:
      import.meta.env.VITE_LEVEL_DESIGNER_URL ??
      (import.meta.env.DEV ? "http://localhost:3001/" : "../level-designer/"),
  },
  "sprite-packer": {
    label: "Open the Sprite Packer",
    url:
      import.meta.env.VITE_SPRITE_PACKER_URL ??
      (import.meta.env.DEV ? "http://localhost:3002/" : "../sprite-packer/"),
  },
};
