# Contributing to Game Studio 2D

Notes for working on the monorepo: setup, the commands that check a change, and known toolchain quirks. The plan and its status live in [ROADMAP.md](ROADMAP.md); toolchain basics (Vite+, `vp`) are in [AGENTS.md](../AGENTS.md).

## Layout

| Path                 | What it is                                                                                |
| -------------------- | ----------------------------------------------------------------------------------------- |
| `apps/studio`        | The site's root: start page, and in development the server in front of every app (3000)   |
| `apps/pixel`         | Piskel-like sprite editor, at `/pixel/` (its own server: 3001)                            |
| `apps/levels`        | LDtk-like level design, at `/levels/` (3002)                                              |
| `apps/packer`        | Packs images into spritesheets with engine data, at `/packer/` (3003)                     |
| `apps/docs`          | The manual site, built from `docs/manual`, at `/docs/` (3004)                             |
| `packages/core`      | Documents, layers, tools, commands, selection, storage, ZIP writer (no DOM)               |
| `packages/render`    | Canvas render passes (layers, grid, cursor, rulers…)                                      |
| `packages/workspace` | Canvas workspace, input, key map, project session and file workflow                       |
| `packages/ui`        | Web components, shared theme (`theme/tokens.css`, `theme/components.css`) and DOM helpers |
| `packages/atlas`     | Rectangle packing and sheet building (no DOM)                                             |
| `packages/formats`   | Spritesheet data formats for game engines                                                 |
| `packages/store`     | Small state store for UI preferences                                                      |
| `e2e`                | Playwright end-to-end tests for every app                                                 |

## Setup and everyday commands

```bash
vp install
```

```bash
vp run dev
```

`vp run dev` starts every app and the studio in front of them: open http://localhost:3000/, the tools are under `/pixel/`, `/levels/`, `/packer/` and `/docs/`. All on one origin, so they share browser storage (roadmap 11.2). One app alone (`vp run dev:pixel`, `dev:levels`, `dev:packer`, `dev:docs`) is served under its path on its own port (http://localhost:3001/pixel/); its storage is then its own. Ports come from `packages/workspace/vite/site.ts` and start at `GS2D_PORT_BASE` (3000).

The whole site builds into `build/site/` with `vp run build:site` (each app with relative URLs, in its folder) and `vp run preview:site` serves it on port 4180.

Before committing (the pre-commit hook also runs `vp check --fix` on staged files):

```bash
vp check --fix
```

```bash
vp run -r test
```

```bash
vp run test:e2e
```

The first end-to-end run on a machine needs the browser: `vp exec playwright install chromium`. The tests run the site as in development (the studio and every app on one origin, ports 4170 to 4174) and reuse running servers outside CI, so they can also be run from VS Code's Testing tab with the Playwright extension.

## Conventions

- Model changes go through undoable commands; the stores hold UI state only.
- Menus and panels that pop out of a control are top-layer popovers, not absolutely positioned children (they escape scrolling toolbars and stacking contexts).
- Shared look: use the classes from `@gs2d/ui/theme/components.css` (`.btn`, `.input`, `.field`, `.panel-section`, `.dialog`…) rather than styling bare elements.
- Commit messages: wrap HTML tag names in backticks (`` `<dialog>` ``); bare tags show up empty in some viewers.

## Documentation

The docs are Markdown in `docs/`: the [manual](manual/README.md), [architecture](architecture.md) and [technologies](technologies.md), with the root [README](../README.md) as the entry point.

- **Generated parts:** `vp run docs` writes each app's "Keyboard shortcuts" article from its key bindings (`apps/*/src/keys.ts`, through `manual.ts`) and the API reference into `docs/api/` with TypeDoc. `vp run docs -- --no-api` skips the API reference.
- **Shortcuts:** give every binding a `label` and `group` (`keymap.bind(combo, handler, { label, group })`); keys that something else handles are listed with `keymap.describe`. Each app has a test that fails while its shortcuts article is out of date, so run `vp run docs` after changing them. The articles are excluded from formatting.
- **API reference:** comes from TSDoc comments on exports; it is not committed (`docs/api/` is ignored). TypeDoc warns about exported functions that use types the package doesn't export.
- **Screenshots:** `docs/images/` is made by `vpx scripts/screenshots.ts` while the site runs (`vp run dev`): each tool, then the hub with the work they saved. Take them again when a layout changes.
- **Tours:** each app's tours are data in `src/help.ts` (`TOURS`): steps with a CSS selector to point at (steps whose target isn't on screen show centred), a title, a text and an optional manual link. The intro runs on the first start. To show a new feature, add a tour with a new id (e.g. `whats-new-2027-01`): people who saw the intro get it once, new people only the intro. Seen tours are kept per browser (`localStorage`, `gs2d.tours.<app>`); end-to-end tests mark the intro as seen in `openApp`, except the tour's own test.
- **Manual site:** `vp run dev:docs` serves it on port 3003 and reloads when an article changes. New articles only need a numbered file in a chapter folder; new chapters also need their title in `docs/manual/README.md`.
- **Style:** plain words, short sentences, one idea per sentence; name buttons and fields exactly as the app labels them.

## Known toolchain quirks

### Stale modules after editing a file from a shell (Windows)

Seen with Vite+ 1.4 on Windows (roadmap item 26):

- **Dev server:** after a file is appended to or rewritten from a shell (not an editor), the dev server can keep serving the old module, and a reload doesn't help.
- **Tests:** the test runner can keep a stale `import.meta.glob` result (Levels' presets are found that way) until the content of the file that calls the glob changes.

What fixes it:

- Restart the dev server (stop it and run `vp run dev:levels` or `vp run dev:pixel` again).
- For the glob case, change the importing file (any edit, even whitespace), or restart the test run.
- Editing through an editor or IDE, which writes files the usual way, hasn't shown the problem.

The project pins Vite+ 1.8.0 (the `workspaces.catalog` in `package.json`; it was 1.4.0 when the quirk was seen). Whether the newer version fixes the watcher is untested, because the quirk can't be reproduced on demand. To check: run a dev server, append to a source file from a shell, and see whether the change arrives.

### Ports already in use

If a port from 4170 to 4174 is taken when running the end-to-end tests, a dev server from an earlier run (or from the VS Code Playwright extension) is probably still running. Outside CI the tests reuse it, which is usually what you want; stop it if it serves old code.
