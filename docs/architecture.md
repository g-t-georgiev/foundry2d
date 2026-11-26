# Architecture

Game Studio 2D is a pnpm monorepo: three apps on seven shared packages. This page explains how they fit together. The [API reference](api/) (`vp run docs`) lists every export; the [roadmap](ROADMAP.md) records why things are the way they are.

## Packages and their boundaries

```
              apps/pixel   apps/levels   apps/packer
                     │                    │                     │
        ┌────────────┼────────────────────┼─────────────────────┤
        ▼            ▼                    ▼                     ▼
   @gs2d/ui   @gs2d/workspace   @gs2d/store   @gs2d/atlas
   (components)    (canvas, input, files)  (UI state)        (packing)
                     │                                          │
                     ▼                                          ▼
               @gs2d/render                          @gs2d/formats
               (render passes)                            (engine data)
                     │
                     ▼
               @gs2d/core
               (documents, tools, history, storage; no DOM)
```

| Package     | Holds                                                                                                                      | Must not                                     |
| ----------- | -------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `core`      | Grid documents and layers, tools, commands and history, selection, camera maths, storage, ZIP, sprite files                | touch the DOM (it runs in tests and workers) |
| `render`    | `Renderer` and its passes: checkerboard, layer stack, grid lines, bounds, cursor, rulers                                   | know about apps or input                     |
| `workspace` | `Workspace` (canvas, camera, render loop, resizing), `InputController`, `Keymap`, scenes, `ProjectSession`, `ProjectFiles` | import UI components                         |
| `ui`        | Web components (`<layers-panel>`, `<project-browser>`, `<split-button>`, the colour picker), the theme CSS, DOM helpers    | depend on the workspace                      |
| `store`     | A small store: actions validated with Ajv, state updated with Immer                                                        | hold model data                              |
| `atlas`     | Rectangle packing (MaxRects, shelves, grids, strips), sheet building, PNG encoding, unpacking                              | touch the DOM                                |
| `formats`   | One writer per spritesheet data format, and readers for the common ones                                                    | know how sheets are packed                   |

The apps are the only place where these meet. They translate panel events into commands, and model events into panel updates (the "mediator" pattern), so components and engine never know about each other.

## Documents, layers and cells

Everything that is painted is a `GridDocument`: a width and height in cells and an ordered list of `GridLayer`s. A layer stores its cells in one typed array:

- **Pixel:** `Uint32Array`, one RGBA colour per cell (bytes in R, G, B, A order; the apps check at startup that the machine is little-endian, which every browser platform is).
- **Levels:** `Int32Array`, an IntGrid value per cell, or for Tiles layers `tileId + 1` with flip flags in bits 29 and 30 (0 is empty).

Layers have a name, visibility, opacity, a lock, and a `scale`: their cell size in document cells, so a level layer can use a coarser grid than the level (LDtk's per-layer grids). Documents emit events (`cells:changed` with the changed rectangle, `layers:changed`, `resized`) that the renderers and panels listen to.

App models build on documents:

- **Pixel:** a `Sprite` is a list of frames, each one `GridDocument` with the same layer structure, plus an FPS and a palette.
- **Levels:** a `LevelProject` has definitions (layers, tilesets, entity types, enums, level fields) and levels. Each level owns a `GridDocument<Int32Array>` with one layer per layer definition, plus its entities.
- **Packer:** a `PackProject` is a sorted list of sprites (name, original file, pivot) and the packing settings. It holds no cells; the sheets are rebuilt from it.

## Commands and history

Every change to a model is an `ICommand` with `execute()` and `undo()`, run through a `HistoryManager`:

- Painting tools produce one `DrawCommand` per stroke (the cells before and after, inside the changed rectangle).
- Layer and document edits have their own commands (`AddLayerCommand`, `ResizeCommand`…); `CompositeCommand` joins several into one undo step, for example a layer edit applied to every frame of a sprite.
- Levels records definition edits as before/after snapshots restored in place (`DefinitionEditCommand`), so even "delete this layer type" is one Ctrl+Z.
- The history has a size limit, reports `canUndo`/`canRedo` and labels to listeners, and can merge repeats (dragging a colour picker is one step).

The rule for both stores: **the store holds UI state only** (tool, colour, toggles, the active view), never model data. Model data changes only through commands, so undo, saving and the screen always agree.

## Tools

A tool implements `ITool`: pointer down, move and up in grid coordinates, with a `ToolContext` that gives it the document, the active layer, the colour or value, and the modifier keys. `ToolManager` is an open registry: core brings pen, eraser, bucket, eyedropper, shapes, stamp, select, lasso and magic wand, and apps register their own. Tools refuse to draw on hidden or locked layers, and `GridDocument.getPolicy()` gives the UI the same answer, so buttons and the cursor show it too.

## Rendering

`Renderer` draws a frame as a list of `RenderPass`es. A pass declares its space: **world** passes draw in world units with the camera transform applied, **screen** passes draw in CSS pixels (rulers, outlines, labels). Passes are cheap to add and to switch off.

The expensive part, the layers, is cached: `LayerBitmapCache` keeps an `OffscreenCanvas` per layer, redrawn only in the rectangles that changed. Tiles layers draw their tiles from the tileset image, and fall back to a one-pixel-per-cell overview when cells get smaller than a few screen pixels, so whole worlds stay smooth.

## Workspace and scenes

`Workspace` owns a canvas: its camera (pan, zoom, fit, animated transitions), the render loop (frames are drawn only when something asked for one), resizing, the rulers and the input. What it shows comes from a **scene**, an object that answers a few questions (`WorkspaceScene`):

- What are the content bounds (for fit and pan limits)?
- Which passes draw it?
- What happens on pointer down, move, up and double-click?
- Which cursor fits?

Pixel has one `GridDocumentScene`. Levels swaps between a world scene (levels as rectangles you drag) and a level scene (the layers you paint) in the same workspace. Packer's scene shows the packed sheets side by side. Camera, input and rulers are written once for all of them.

`InputController` turns pointer events into scene calls and handles navigation itself (middle-drag or Space+drag pans, the wheel zooms at the pointer). `Keymap` maps key combos to handlers; each binding carries a label and group, and the manual's shortcut tables are generated from them.

## Files and storage

Storage (`core/storage`) is one interface with four parts, backed by IndexedDB (database `Game Studio 2D`) or by memory when IndexedDB is unavailable:

- `projects`: the library ("In this browser" on the start screen), with thumbnails and, for copies of files, the file they belong to;
- `assets`: binary files (tileset and sprite images) stored once by their SHA-256, shared by every app;
- `recentFiles`: File System Access handles of recently used files;
- `recovery`: one crash-recovery snapshot per app.

`ProjectSession` (workspace) is where the open project lives: the library entry, the bound file, the unsaved flag. Ctrl+S writes the library copy and the file; unsaved work is snapshotted a moment after each edit and restored on reload. `ProjectFiles` builds the shared file workflow on top (new from a template, open, save as, the start screen, files the installed app is launched with). Library and recovery copies keep images in the asset store; files on disk always carry their images.

## Work files and exports

Each app has a **work file** that keeps everything needed to continue (`.gs2dsprite`, `.gs2dlevel`, `.gs2dpack`): the document, plus an `editor` block with the view state (camera, tool, open level…). Exports are the product for games and contain only game data. See [File formats](manual/05-file-formats/01-work-files.md).

## Packing in Packer

Packing runs in a module worker (`apps/packer/src/pack/`): the page sends each decoded image once, the worker trims, stores identical sprites once, packs, extrudes and draws the sheets, and hands them back without copying. Export (scaling, premultiplying, PNG and WebP encoding, ZIP) runs there too. Where a worker can't start, the same code runs on the page.

## One site

The apps are served as one site (`packages/workspace/vite/site.ts`): the studio at `/`, the tools at `/pixel/`, `/levels/` and `/packer/`, the manual at `/docs/`. Being on one origin is what lets them share browser storage, so the studio can list every tool's work. In development the studio's server forwards each path to the app's own Vite server (hot reload included); a build (`pnpm build:site`) puts every app in its folder with relative URLs, so the site works from any address. Links between the apps and to the manual are relative for the same reason.

## Installable apps

A build plugin (`packages/workspace/vite/pwa.ts`) writes each app's web manifest (with its file handlers), icon and service worker. The worker caches every built file for offline use; a new version waits until the user chooses to reload, so an open tab never changes version mid-edit.

## Tests

- **Unit tests** (Vitest, `pnpm -r --if-present test`) next to each package and app, in Node.
- **End-to-end tests** (Playwright, `vp run test:e2e`) drive every app in Chromium with real mouse and keyboard input, check downloads byte by byte, and cover crash recovery, files on disk and the installed-app launch.
