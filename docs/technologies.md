# Technologies

What Game Studio 2D is built with, and why. Nothing here needs a server: the apps are static files.

## Toolchain

- **[Vite+](https://viteplus.dev/guide/)** (`vp`): one command for installing, the dev server, builds, tests, linting and formatting. It wraps Vite (dev server and bundling with Rolldown), Vitest, Oxlint and Oxfmt. `vp check --fix` formats, lints and type-checks in one go; a pre-commit hook runs it on staged files. See [AGENTS.md](../AGENTS.md) for the commands.
- **pnpm workspaces** hold the monorepo together; packages point their `main` at their TypeScript sources, so there is no build step between them.
- **TypeScript**, strict, everywhere. Lint rules include the type-aware ones (no floating promises, no unsafe `any`).
- **TypeDoc** with its Markdown plugin generates the [API reference](api/) from the TSDoc comments (`vp run docs`).

## Tests

- **Vitest** (through `vite-plus/test`) for unit tests in Node. Core, render maths, packing and formats are DOM-free, so most logic is tested without a browser.
- **Playwright** for end-to-end tests in Chromium. They use real pointer and keyboard input, downloads, the clipboard, the browser's private file system and real folders on disk.

## In the browser

- **Canvas 2D** draws everything. Layers are cached in `OffscreenCanvas`es and redrawn only where they changed; no WebGL is needed for pixel art and grids.
- **Web Components** (custom elements with shadow DOM) for the reusable controls: `<layers-panel>`, `<project-browser>`, `<split-button>`, the colour picker. Everything else is plain HTML with shared CSS classes and design tokens (`@gs2d/ui/theme`).
- **Popovers and `<dialog>`**: menus and pickers live in the browser's top layer, so scrolling toolbars and stacking contexts never clip them.
- **IndexedDB** (through the small `idb` wrapper) stores the project library, images, recent files and crash recovery.
- **File System Access API** (Chrome and Edge) opens and saves files in place, remembers recent files and watches folders (Packer's live folders). Other browsers fall back to file inputs and downloads.
- **Web app manifest, service worker and Launch Handler API** make the apps installable, usable offline, and the handlers for their file types.
- **Web Workers**: Packer packs and encodes sheets off the page.
- **Compression Streams** for deflate (PNG and ZIP), **WebCodecs' `ImageDecoder`** to read images without losing the colour of nearly transparent pixels, and the **Async Clipboard API** to copy and paste images between apps.

## Libraries

Deliberately few:

- **[Immer](https://immerjs.github.io/immer/)** for immutable updates in the UI store.
- **[Ajv](https://ajv.js.org/)** to validate store actions against JSON schemas.
- **[idb](https://github.com/jakearchibald/idb)** for promise-based IndexedDB.

Everything else is written for the project, small and tested: PNG, BMP, GIF (with median-cut quantisation) and ZIP encoders, a ZIP reader, MaxRects packing, the auto-tiling rules engine, and the spritesheet format writers.
