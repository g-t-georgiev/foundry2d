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
  pixel: {
    label: "Open Pixel",
    url:
      import.meta.env.VITE_PIXEL_URL ??
      (import.meta.env.DEV ? "http://localhost:3000/" : "../pixel/"),
  },
  levels: {
    label: "Open Levels",
    url:
      import.meta.env.VITE_LEVELS_URL ??
      (import.meta.env.DEV ? "http://localhost:3001/" : "../levels/"),
  },
  packer: {
    label: "Open Packer",
    url:
      import.meta.env.VITE_PACKER_URL ??
      (import.meta.env.DEV ? "http://localhost:3002/" : "../packer/"),
  },
};
