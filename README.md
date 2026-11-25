# foundry2d

Three browser apps for making 2D game art and levels, built on one shared engine:

| App                | What it is for                                                                                                                                                                                       |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Pixel Editor**   | Drawing sprites pixel by pixel, with layers, frames, onion skin and an animated preview. Exports images, GIFs and spritesheets with data for game engines.                                           |
| **Level Designer** | Building levels from grids of values, tiles and placed entities, laid out in a world. Tiles can be generated from rules (auto-layers). Exports game JSON, CSV and PNG.                               |
| **Sprite Packer**  | Packing many images into spritesheets: trimming, rotation, identical sprites stored once, several sheets when needed, animations and pivots. Writes data for Phaser, PixiJS, Godot, LibGDX and more. |

![The three apps](docs/images/apps.png)

They run in any modern browser and keep your work there (with crash recovery), or in files on your disk. In Chrome and Edge they can be installed as apps that work offline and open their files from the desktop.

## Quick start

You need [Vite+](https://viteplus.dev/guide/) (the `vp` command) and Node.js.

```bash
vp install
```

Then start the app you want:

```bash
pnpm dev:pixel
```

```bash
pnpm dev:level
```

```bash
pnpm dev:packer
```

They open on ports 3000, 3001 and 3002.

## Documentation

- **[User manual](docs/manual/README.md)**: every tool, panel and dialog, step-by-step workflows, the file formats, and keyboard shortcuts. `pnpm dev:docs` serves it as a site (port 3003) with search.
- **[Architecture](docs/architecture.md)**: the packages and how documents, commands, rendering, the workspace and storage fit together.
- **[Technologies](docs/technologies.md)**: what the project is built with, and why.
- **API reference**: generated from the source comments with `vp run docs` (into `docs/api/`).
- **[Contributing](docs/CONTRIBUTING.md)**: setup, the checks to run, conventions and toolchain quirks.
- **[Roadmap](docs/ROADMAP.md)**: what was built when, decisions, and what is next.

## Repository layout

```
apps/
  pixel-editor/     the Pixel Editor
  level-designer/   the Level Designer (presets/ holds its project templates)
  sprite-packer/    the Sprite Packer
  docs/             the manual site
packages/
  core/             documents, layers, tools, commands, selection, storage, ZIP (no DOM)
  render/           canvas render passes (layers, grid, cursor, rulers)
  workspace/        the canvas workspace, input, key map, and the file workflow
  ui/               web components, the shared theme and DOM helpers
  atlas/            rectangle packing and sheet building (no DOM)
  formats/          spritesheet data formats for game engines
  store/            a small validated state store for UI state
docs/               this documentation
e2e/                end-to-end tests (Playwright)
scripts/            docs generation
```

## Checks

```bash
vp check --fix
```

```bash
pnpm -r --if-present test
```

```bash
vp run test:e2e
```
