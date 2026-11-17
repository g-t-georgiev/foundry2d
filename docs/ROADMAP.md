# foundry2d Roadmap

Two apps on one engine:

- **Pixel Editor** (`apps/pixel-editor`): Piskel-like sprite editor. One document, one canvas workspace.
- **Level Designer** (`apps/level-designer`): LDtk-like editor. A project holds a **world** of **levels**. You edit each level's layers (IntGrid, Tiles, Entities). First target: authoring the Pac-Man maps.
- **Sprite Packer** (`apps/sprite-packer`, planned in Phase 9): TexturePacker-like spritesheet builder, the third app in the suite.

The reference repos (`2d-pixel-art-editor`, `level-editor`) are sources of behaviour and UI only. We port ideas and code from them; nothing depends on them.

---

## 1. Where things stood before Phase 0 (2026-11-13)

_Historical snapshot, kept for context. Everything listed here was addressed in Phases 0–7b; the defects below were fixed in Phase 0._

| Area                  | State                                                                                                                                                                                                                                                         |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@foundry2d/core`     | `GridDocument`/`GridLayer` over typed buffers (`Uint32Array` RGBA, `Int32Array` ids), pen/eraser/bucket/eyedropper tools, `ToolManager`, `HistoryManager` + `DrawCommand`, `FloodFill`, a basic `Camera`, IndexedDB recovery driver. DOM-free, which is good. |
| `@foundry2d/store`    | Immer + Ajv action store (`defineAction`, `select`, `on`). Has tests.                                                                                                                                                                                         |
| `@foundry2d/ui`       | `color-picker-button/panel`, `layers-manager`/`layer-item` web components.                                                                                                                                                                                    |
| `apps/pixel-editor`   | `Application`/`UIManager`/store are scaffolded, but `main.ts` is still a throwaway prototype (hard-coded yellow, renders only the active layer).                                                                                                              |
| `apps/level-designer` | Throwaway prototype: one 28×36 grid, hard-coded tile id.                                                                                                                                                                                                      |
| Health                | `tsc` passes in all packages. `vp check` reports 0 errors and 4 warnings (unused params, empty `LayersController.ts`).                                                                                                                                        |

**What we can port from the pixel art reference:** the renderer pipeline (background, focus/composite layers, grid, cursor, rulers), `InputController` (pan, wheel zoom, Alt-eyedropper, undo/redo keys), the richer `Camera` (`fitToView`, `calculateZoom`, `centerOnWorld`), `ClearCommand`/`ResizeCommand`, PNG export, the toolbar HTML/CSS.

**What we can port from the level editor reference:** layout (toolbar, left sidebar, viewport, status bar), theme-token CSS, `EditorCanvas` camera ideas (`resizeMap` with deltas on all four sides, `animateToOrigin`, viewport culling, "nice step" rulers), the IntGrid value tables in `layersData.js`, and the JSON export/import + "copy layer as array" code (currently commented out).

**Small defects found during the survey:**

- `packages/ui/src/layers/index.ts` declares the tag `"layer-manager"` in `HTMLElementTagNameMap`, but the element is registered as `"layers-manager"`.
- The file `history/DeleteLayerComman.ts` is misspelled. It and `SetLayerPropertyCommand` are not exported from `history/index.ts`.
- `ToolType` is a closed union and `ToolManager` hard-codes its tools, so apps can't add their own tools (rect, select, entity).
- `HistoryManager` emits no change events, has no stack limit, and has no compound/batch command.
- `ToolManager` blocks input when `opacity <= 0.001`, but not for hidden or locked layers.
- `GlobalEmitter` in core holds pixel-app-specific events (`PickColor` with a hex string).

---

## 2. Target architecture

```
packages/
  core/       DOM-free engine: documents, layers, history, tools, algorithms,
              camera math, serialization (encode/decode buffers)
  render/     NEW. Canvas2D render pipeline with pluggable passes:
              Background, GridLayers (ImageData fast path), TileLayer,
              Grid, Cursor/Brush preview, Rulers, Selection, Bounds
  workspace/  NEW. The shared "viewport kit": canvas + Camera + InputController
              + render loop + ResizeObserver + keybinding map + pointer→grid
              mapping. Both apps embed it.
  store/      (as is)
  ui/         Shared web components. Add: tool-bar, palette, panel/section,
              tileset-picker, property-grid, modal, status-bar.
apps/
  pixel-editor/    Piskel-like composition of the above
  level-designer/  LDtk-like composition + world view
```

The key idea is the **Workspace**. A `Workspace` takes a _scene adapter_ that answers four questions:

- What are the world bounds?
- What passes do I render?
- What does a pointer at grid (x, y) hit?
- Which tool context is active?

The pixel editor gives it one document. The level designer gives it either a **WorldScene** (levels as rectangles, drag to move, double-click to enter) or a **LevelScene** (one level's layers, painting tools). Camera, panning, zoom, rulers and input are written once.

### Level designer data model (LDtk-shaped, simplified)

```
Project
├─ defs
│  ├─ layers[]     { uid, name, kind: "intgrid" | "tiles" | "entities",
│  │                 gridSize, intGridValues[{value, name, color}], tilesetUid? }
│  ├─ tilesets[]   { uid, name, imagePath | embeddedPng, tileSize, spacing, padding }
│  ├─ entities[]   { uid, name, size, pivot, shape, color, fields[] }   (Phase 7)
│  └─ enums[]      { uid, name, values[{ id, color }] }                 (Phase 7)
├─ worldLayout: "free" | "gridvania" | "linearH" | "linearV"
└─ levels[]       { uid, name, worldX, worldY, pxWidth, pxHeight,
                    layerInstances[] { defUid, data: Int32Array (RLE in JSON) | entities[] } }
```

- IntGrid and Tile layer instances are `GridLayer<Int32Array>`, so pen, eraser, bucket, eyedropper and history work unchanged.
- Entity layers ended up app-level (Phase 7): an Entities layer keeps an empty grid layer so ordering, visibility and opacity work like other layers, and its instances live on the level with their own commands. Core stayed grid-only.
- The Pac-Man `layersData.js` (collision / collectibles / spawns) becomes three IntGrid layer defs in a seed project.

---

## 3. Phases

Phase 0 unlocks both apps. After that, the pixel and level tracks can be interleaved.

### Phase 0: Core hardening and the shared Workspace ✅ (2026-11-14)

_Done: defects fixed, open tool registry, history events/limit/composite, full layer + clear/resize commands, RLE serialization, merged camera, `@foundry2d/render`, `@foundry2d/workspace` (`Workspace`, `InputController`, `Keymap`, `GridDocumentScene`), 42 tests. Both apps run a smoke entry on the kit._

1. Fix the defects listed above. Open `ToolType` up into a registry. Add `HistoryManager` `onChange`, a stack limit and `CompositeCommand`. Add `ClearCommand`, `ResizeCommand`, `AddLayer`, `MoveLayer` and `SetLayerProperty`. Add a `locked` flag and a hidden-layer guard.
2. Merge the reference `Camera` into core: `fitToView`, `zoomAt`, `centerOnWorld`, `clamp` with an optional "unbounded" mode for the world view, and `cellSize`.
3. Create `packages/render` by porting the reference renderers. Swap per-pixel `fillRect` for a cached `ImageData`/`OffscreenCanvas` per layer, redrawn only for dirty regions.
4. Create `packages/workspace` with InputController, render loop, ResizeObserver and a keybinding map.
5. Add Vitest specs for documents, commands, tools, flood fill and camera math (`vp test`).

### Phase 1: Pixel Editor parity with the reference ✅ (2026-11-14)

1. **Replace the layers UI with a Piskel-style `<layers-panel>`** (done first, since every later step wires layers). The old floating, draggable `layers-manager` with slotted `layer-item` children is removed. The new panel:
   - is _controlled_: the app sets `layers` and `activeId`; the panel keeps no layer state of its own and only emits intent events (`layer-select`, `layer-add`, `layer-duplicate`, `layer-delete`, `layer-move`, `layer-rename`, `layer-visibility`, `layer-opacity`);
   - has one action rail for the active layer (add, duplicate, move up, move down, delete, opacity slider) instead of per-row buttons, plus plain rows (eye toggle, name, double-click to rename) handled by event delegation;
   - stays free of workspace dependencies: it speaks plain data and DOM events, and the apps translate those into core commands.
2. Add `GridDocument.getPolicy()` (`canDraw`, `canDelete`, `canMoveUp`, `canMoveDown`, `reason`) so the UI and canvas share one source for disabled states and the `not-allowed` cursor.
3. Port the toolbar and status bar HTML/CSS and wire them through the store. The store holds thin metadata only; cell buffers stay in core.
4. Sync layers both ways: panel events → commands → `GridDocument` events → panel.
5. Wire up focus vs preview mode, grid toggle, Alt-eyedropper, undo/redo, clear, resize and Export PNG.
6. Add IndexedDB autosave and recovery, plus `.f2d.json` project save/load.

**Decisions taken from the early architecture overview (AI Studio draft):**

- Adopted: UI package without workspace dependencies, apps as the mediator, thin reactive store, the layer-policy idea, the centralized action rail.
- Kept as is: `visible` and `opacity` stay separate properties, rather than visibility being derived from opacity. An eye toggle no longer has to remember the last non-zero opacity, and the level designer needs a plain visibility flag anyway.
- Kept in core but not exposed in the pixel UI: `locked`. It is cheap and the level designer may want it; removing it later is a one-file change.
- Not needed yet: the `ResolvePayload` type shield in the store (no TS2589 errors so far). Add it if deep schemas trigger them.
- Outdated: the ESLint/Prettier setup, which Vite+ (`vp check`) has replaced.

### Phase 2: Level Designer foundation (single level, Pac-Man usable) ✅ (2026-11-14)

1. Project model (`LevelProject`): shared IntGrid layer definitions, levels that each own a `GridDocument<Int32Array>`. Definition edits (add, remove, reorder, rename, values, colors) apply to every level. The native format is `.f2dlevel.json` with RLE layer data. The Pac-Man seed is a 28×36 level with an 8 px grid and `collision`, `collectibles` and `spawns` layers.
2. Reference layout and theme tokens ported: toolbar, tools, level panel, `<layers-panel>` (reorder and rename only), IntGrid palette, status bar, and a project settings dialog for grid size and layer definitions.
3. Level editing on the shared Workspace: pen, eraser (also right mouse), rectangle fill (new core `RectangleTool`), bucket, value picker (I or hold Alt), keys 1–9 for values, and an undoable resize with a delta on each edge.
4. Export game JSON in the original editor's shape (`metadata` plus flat arrays keyed by layer identifier) and import it back. "Copy layer" copies the active layer as a row-per-line array. IndexedDB autosave works through the new core `JsonRecovery`, which the pixel editor now uses too.

**Decisions:**

- One grid size per project. Every layer in a level shares the level's grid, which keeps the "equal-size layers" document invariant. Per-layer grid sizes (LDtk allows them) can come with tile layers. (Done in 8.5: layers now carry a scale, see item 17.)
- Definition edits are not undoable, like in LDtk. Edits that delete data (removing a value or a layer) ask for confirmation and clear the undo history.
- `power_pellet` now gets its own color (`#ff8a65`). The old editor gave it the same color as `pellet`.

### Phase 3: World view ✅ (2026-11-14)

1. `WorldScene`: every level drawn at its world position (pixels) from the same cached layer bitmaps as the level view. It has an unbounded camera, a background grid, origin axes, and level labels with selection and hover outlines.
2. Level operations: click to select, drag to move (snapped to the level grid, or to the world grid in GridVania), double-click empty space to create, and duplicate, delete, rename and reorder from the levels list. All of them are undo steps in the same history as cell edits. Resizing a level on its left or top edge also moves it in the world, so the other edges stay put.
3. World/Level switch in the toolbar. Double-click or Enter opens a level with a zoom-in transition; Escape goes back with a zoom-out. A single-level project (like the Pac-Man preset) opens straight into the level.
4. World layouts as in LDtk: free, GridVania (editable world cell size), linear horizontal and linear vertical (positions follow list order). They are saved in the project file and set per preset.

**Presets:** project templates are ordinary `.f2dlevel.json` files in `apps/level-designer/presets/`, picked up automatically and offered under **New**. The Pac-Man data no longer lives in code.

**Fixes made along the way:**

- The workspace measures itself before computing a fit, because showing or hiding a sidebar changes the canvas size before `ResizeObserver` reports it.
- Camera animations finish on a timer when `requestAnimationFrame` is paused (background tab, hidden pane).
- The level designer toolbar scrolls instead of widening the page on narrow windows.

### Phase 4: Tiles ✅ (2026-11-14, auto-layers deferred)

1. **Tileset definitions** in the project: identifier, tile size, spacing, padding, and the source image. For now the image is embedded as a PNG data URL, so project files and autosave stay self-contained. Phase 5 moves images to an asset store.
2. **Tiles layer type** next to IntGrid, bound to one tileset. Cells store `tileId + 1` (0 = empty) with flip flags in the high bits: bit 29 = flip X, bit 30 = flip Y. The sign bit is never used.
3. **Rendering:** `LayerStackPass` gains a per-layer custom renderer, so tile layers draw visible tiles straight from the tileset image, interleaved correctly with IntGrid layers. The world view uses the same path.
4. **Editing:** a tileset picker (click a tile, or drag to pick a rectangular stamp), a core `StampTool` that paints multi-tile patterns, X/Y keys to flip, and pen, eraser, bucket and rectangle working on single tiles.
5. **Later:** auto-layer rules driven by IntGrid values, LDtk's signature feature. ✅ Phase 7b.

### Phase 5: Storage and project library ✅ (2026-11-14)

1. **Storage contract** (`@foundry2d/core/storage`): `Storage` = `recovery` + `projects` (local library: id, app, name, timestamps, thumbnail, JSON payload) + `assets` (content-addressed by SHA-256, deduplicated, `prune`) + `recentFiles` (File System Access handles).
   - `IndexedDBStorage`: database `foundry2d`, migrated in place from v1 (recovery only) to v2.
   - `MemoryStorage`: for tests, and the fallback when IndexedDB is unavailable. The project browser then shows a warning.
   - `openStorage()` picks between them.
2. **`ProjectSession`** (`@foundry2d/workspace`), shared by both apps:
   - **Ctrl+S** saves to the library and, when a file is bound, writes back to it.
   - **Ctrl+Shift+S** saves as a file: a save picker in Chromium (the file is then bound and added to recent files), a download elsewhere.
   - A dirty flag drives the `•` in the title, a "Project" status entry, and a `beforeunload` warning.
   - A debounced crash-recovery snapshot restores unsaved work, together with its library or file identity, on reload.
3. **`<project-browser>`** (`@foundry2d/ui`, no workspace dependencies): a start screen and Open dialog with templates (level presets, sprite sizes), Open file…, recent files and the library with thumbnails. It opens at startup when there is saved work and nothing to recover.
4. **Level designer:** tileset PNGs live in the asset store for library and recovery copies (`asset:<sha256>` references). Saved files always embed the image. Deleting a library project prunes assets that nothing references any more.
5. **Pixel editor:** the same flow, plus a sprite name field in the toolbar.

**Not done yet:** a "Save as" choice between file and library naming, project duplication in the library, and storage quota and usage display. ✅ Done in 8.4 (item 8).

### Phase 6: Pixel Editor, exports, frames and spritesheets ✅ (2026-11-14)

1. **Frames (Piskel model):** a `Sprite` holds frames that each own a `GridDocument` and share one layer structure. Layer edits and resizes are composites of the core commands applied to every frame, so undo covers all frames together. Frame add, duplicate, delete, move and duration changes are undo steps in the same history.
2. **Timeline** under the canvas: frame thumbnails, the frame actions, per-frame duration (empty means "use the FPS"), FPS, and an onion-skin toggle. `,` and `.` switch frames; Shift+N adds a frame and Shift+D duplicates one. **Onion skin** draws the previous and next frames faintly under the current one, through new `LayerStackPass.getAlpha` and `GridDocumentScene.underlayPasses` hooks. An **animated preview** in the side panel plays each frame for its duration, with play/pause.
3. **Project file v2:** `frames[]` (each with `duration` and `document`) plus `fps`. Version 1 files open as one frame, and frames must share size and layers.
4. **Export controller** (`src/export/`) and an **export dialog** (Ctrl+E) with three tabs.
   - **Image:** PNG, WebP (lossless or lossy), JPEG (with a background colour) and 32-bit BMP. Scale 1–32×, all visible layers or the active layer only, trim, current frame or all frames as a ZIP, and a file name pattern (`{name} {frame} {w} {h}`).
   - **Spritesheet:** horizontal, vertical, grid or packed (shelf) layouts, with padding, extrusion and trimming. Data is TexturePacker "JSON Hash" or "JSON Array" (with `frame`, `trimmed`, `spriteSourceSize`, `sourceSize`, `duration` and `meta.frameTags`). Download as one ZIP or as separate PNG and JSON files.
   - **GIF:** animated, using each frame's duration, looping or played once. It has one global palette (exact up to 255 colours) and 1-bit transparency.
   - **How it works:** pixels are composited in software, so exports are exact and testable. BMP, GIF and ZIP have their own small encoders; only PNG, WebP and JPEG use the browser's canvas encoder.
5. **Drawing:** line (L), rectangle (R) and ellipse (C) tools built on a new core `ShapeTool` base, with a live preview and one undo step per shape.

### Phase 6b: More pixel tools ✅ (2026-11-14)

1. **Selection** (core `Selection` and `SelectTool`, select tool on M):
   - Drag to select; drag inside the selection to move the pixels. The move previews live and undoes in one step, and undo also restores the selection.
   - Ctrl+A selects all, Ctrl+D or Esc deselects, and Delete clears only the selection.
   - Ctrl+C, Ctrl+X and Ctrl+V copy, cut and paste. Paste lands at the selection, selects the pasted block and switches to the select tool so you can drag it.
   - Transparent pixels never erase what is underneath when moving or pasting.
2. **Mirror drawing:** ⇆ (Shift+X) and ⇅ (Shift+Y) mirror pen and eraser strokes across the sprite's centre lines, shown as dashed guides.
3. **Filled shapes:** hold Shift with the rectangle or ellipse tool. Tools now receive the modifier keys through `ToolContext.modifiers`.
4. **Editable palette**, saved with the sprite (an optional `palette` field in v2 files):
   - add the current colour; remove a colour with right-click or Delete;
   - import `.hex` (Lospec) or `.gpl` (GIMP, Aseprite, Krita), and export either format.
5. **Bridge to the level designer:** Project settings, then Tilesets, then Import… now also accepts a pixel-editor sprite (`.f2d.json`). Its frames are laid side by side, and square frames become one tile each. The compositing it uses moved to core as `compositeRgba`, and the pixel exporter uses the same function.
6. **Fix:** the workspace's first automatic fit now announces the camera change, so the zoom readout is right from the start.

**Not done:** pasting images from the system clipboard, and non-rectangular selections (lasso, magic wand). ✅ Done in 8.5 (item 14).

### Phase 7: Entities and custom data ✅ (2026-11-14)

LDtk's entity model, kept small enough to stay readable.

1. **Definitions** (project-wide, in Project settings):
   - **Entity definitions:** identifier, colour, size in pixels, pivot, shape (rectangle, ellipse, or a tile from a tileset), an optional limit per level, and a list of **fields**.
   - **Field types:** Int, Float, Bool, String, Color, Enum and Point (a cell in the level). Each field has a default; numbers can have a min and max.
   - **Enums:** named value lists with a colour per value, used by Enum fields.
   - **Entities layer type:** sits next to IntGrid and Tiles in the layer stack, so ordering, visibility and opacity work as for other layers.
2. **Instances** belong to a level and an Entities layer. Each has a stable id, a pixel position (the pivot point) and its field values.
3. **Editing** on an Entities layer (the side panel swaps the IntGrid palette for an entity list and an inspector):
   - click to place the entity chosen in the list (keys 1–9 choose), snapped to the grid; Shift places freely;
   - click to select, drag to move (whole cells, or pixels with Shift), arrow keys nudge (Shift+arrow by 1px);
   - Delete or right-click removes, Ctrl+D duplicates, and Alt+click picks an entity's type for placing;
   - at the per-level limit, placing moves the most recent instance instead (LDtk behaviour);
   - the **inspector** edits position and field values. **Pick** sets a Point field by clicking a cell, and the selected entity shows its points as dashed links.
   - Every instance edit is an undo step in the shared history; definition edits are not, as before. Edge resizes shift entities and their points with the content.
   - The world view and library thumbnails draw entities too. Labels show Enum values (a ghost reads "blinky"), the shape takes the Enum value's colour, and labels shorten or hide when they would overlap.
4. **Files:** the project file gains `defs.entities`, `defs.enums` and per-level `entities`. Older files still open. The game export gains an `entities` object keyed by layer identifier, with field values keyed by field identifier.
5. **Pac-Man preset:** an `entities` layer with Pac-Man, Ghost (enum `ghost`: blinky, pinky, inky, clyde, plus a scatter-target Point field) and Fruit. The old IntGrid `spawns` layer (always empty) was removed: entities do its job, so the game export has `collision` and `collectibles` grids plus `entities`.
6. **Pulled forward from the polish backlog:** entity code lives in its own modules (`model/entities.ts`, `model/entityCommands.ts`, `entities/EntityController.ts`, `entities/EntityPanel.ts`, `ui/EntityDefsEditor.ts`, `render/entityRenderer.ts`) instead of growing `Application.ts`, which is already 1,200 lines. This is the pattern Phase 8 applies to the rest.
7. **Workspace additions:** `GridDocumentScene` accepts a `getPointerDelegate` that takes over pointer input from the grid tools. This is how object layers plug in.
8. **Fix:** `InputController` no longer gets stuck when `setPointerCapture` throws for a pointer that is no longer active. Before, all further canvas input was ignored until reload.

### Phase 7b: Auto-layers ✅ (2026-11-14)

LDtk's signature feature, simplified: a Tiles layer can be **generated** from an IntGrid layer by rules.

1. **Rules** (`model/autoRules.ts`, a pure engine): each rule is a 1×1, 3×3 or 5×5 pattern of conditions around a cell.
   - **Conditions:** must be value _v_, must not be _v_, any value, empty, or anything.
   - **Output:** the tiles to place. With several, one is picked per cell at random but stably, so repeating an id weights it.
   - **Chance:** a probability, so a rule can scatter details.
   - **Mirroring:** Mirror X / Mirror Y also match the mirrored pattern and flip the tile, so one corner rule covers both sides.
   - **Priority and edges:** the first matching rule wins. Cells past the level edge repeat the edge, so ground touching a border doesn't grow an edge there.
2. **Auto-layers:** in Project settings, a Tiles layer gets "Auto-tiling: generate from IntGrid layer".
   - Generated layers are locked, and the side panel explains where to paint instead.
   - Tiles regenerate whenever the source changes: painting, undo, resize and removed values all count. Bursts of changes are coalesced into one regeneration.
   - Generated tiles are derived data, never undo steps. Undoing a source edit brings the tiles back with it.
   - Removing the source layer turns the layer back into a hand-painted one that keeps its tiles.
3. **Rules editor** (Edit rules…):
   - A prioritised list with pattern and tile previews; rules can be toggled, reordered, duplicated and deleted.
   - The pattern editor paints with a value brush: click for "must be", right-click for "must not be".
   - Tiles come from the tileset picker; drag to pick several variants. Chance and mirroring are set per rule, and Reshuffle gives new random choices.
   - Every edit regenerates the level behind the dialog live.
4. **Files:** layer definitions store `autoSourceUid`, `autoRules` and `autoSeed`. Tiles are regenerated on load, so they always match the rules. The game export's `tileLayers` entry names the `autoSource` layer.
5. **New preset, "Platformer (auto-tiles)":** a 40×22 side-scroller with a generated 16px tileset (grass, dirt with variants, corners, walls, undersides, planks). Six rules cover all of it, using mirroring for the right-hand corners and walls. It also has Player and Coin entities.
6. **Pac-Man preset:** the empty IntGrid `spawns` layer was removed; entities cover spawns now.

**Not done (LDtk has them):** several tiles stacked in one cell (rules that don't stop at the first match), rule groups, per-rule out-of-bounds handling, tile offsets, and auto-layers built on top of other auto-layers. ✅ Done in 8.5 (item 30), apart from auto-layers fed by other auto-layers (deferred).

### Phase 8: Refactor and polish ✅ (2026-11-17)

Issues, improvements and polish candidates collected along the way, including everything earlier phases marked "not done" or "later". Items marked **earlier** are cheap enough, or annoying enough, to fold into whichever phase touches that code first.

**Status marks:** ✅ done · ⚠️ open (to do or to decide) · ⏸️ deferred or moved to a later stage · ❌ dropped.

**Order of work.** The list is long, so Phase 8 runs in stages:

- **8.1 Quick UX wins** ✅ (2026-11-14): items 10, 11, 21, 22, 24, 29 and 5. Notes:
  - **Layer locks (29):** the lock toggle is on each layer row in both apps and saved with the project. Locking an Entities layer also blocks entity edits (selection still works for inspecting). Auto-layers show a disabled lock that explains why.
  - **Pixel editor (10, 11):** the mirror guide is a cased 2px dashed line with X and Y badges. Moving a selection on a locked or hidden layer keeps the selection and says why in the status bar.
  - **Level designer (21, 22):** Project settings has tabs (Layers, Tilesets, Entities, Enums, switchable with the arrow keys). Dialog bodies scroll under a fixed header. Entity tiles are picked visually.
  - **Other (24, 5):** old game exports with `spawns` keep the original value names. Both apps check the pixel byte order at startup (`assertPixelByteOrder`).
- **8.2 Safety net** ✅ (2026-11-14): browser end-to-end smoke tests (item 25).
  - **Setup:** Playwright (`@playwright/test`, Chromium) with the config and specs in `e2e/` (`e2e/playwright.config.ts`). Run them with `vp run test:e2e`; the first time on a machine, run `pnpm exec playwright install chromium`.
  - **Isolation:** each app gets its own dev server on ports 4170 and 4171, and every test runs in a fresh browser context with empty storage.
  - **Coverage:** 12 smoke tests, all driven by real mouse and keyboard input.
    - Pixel editor: draw, undo and redo; the zoom readout; crash recovery; layer locks; selection moves; saving to the library and the start screen.
    - Level designer: painting the maze; entity drag and undo; entity edits surviving a reload; auto-layers in the platformer preset; world and level switching; settings tabs.
    - The suite passed 60 of 60 runs with `--repeat-each=5`.
  - **Bugs it found and fixed:**
    - The level designer dropped World/Level switches requested during the 320 ms zoom animation (Enter right after switching to the world did nothing). Transitions are now queued.
    - `<body data-view>` was picked up as a view tab and given `aria-selected`.
- **8.3 Architecture** ✅ (2026-11-15): items 1–4, done under the smoke tests from 8.2.
  - **Shared file workflow (2):** `ProjectFiles` in `@foundry2d/workspace` covers New from a template, Open (file, recent, library), Save, Save as, delete from the library, the start screen and startup recovery, for both apps. `bindProjectBrowser()` in `@foundry2d/ui` wires `<project-browser>` to it, and the workspace stays free of UI imports. It has unit tests.
  - **Split composition roots (1):**
    - Pixel editor (833 → about 520 lines): `ClipboardController`, `PaletteController` and `keys.ts`.
    - Level designer (1,345 → about 960 lines): `LevelOperations` (world edits), `keys.ts` and `ui/StatusBar.ts`.
    - Still in the level designer's `Application`: palette and tile-picker glue and the view transitions. They are the next candidates, alongside the shared UI components (item 31).
  - **Shared theme (3):** `@foundry2d/ui/theme/tokens.css` holds the design tokens, `<layers-panel>` tokens and base resets, and both apps `@import` it. The pixel editor's short names (`--bg`, `--panel`…) are aliases of the shared tokens, so it now uses the level designer's palette.
  - **Store review (4):** every action is still used. The rule (the store holds UI state only; model data changes through commands) is now documented at the top of both stores.
  - **Tooling:** the root Vite config excludes `e2e/` from Vitest, so VS Code's Testing tab no longer imports the Playwright specs (which failed with "Playwright Test did not expect test.beforeEach() to be called here"). The Playwright extension is recommended for running them from the editor.
- **8.4 Files and storage** ✅ (2026-11-15; item 6 moved to 8.7): items 6–8 and 32–37 (work files versus export files).
  - ✅ **Work files keep the editing state (32):** an `editor` block next to the document data, written on save and in recovery snapshots and restored on open. Tool changes alone don't mark a file as changed, as in other editors; the state is captured whenever the file is next saved.
    - Pixel editor: camera, frame, tool, colour, pen size, grid, onion skin and mirror.
    - Level designer: view, open level, camera, tool, grid, selected values, tile flips and tile selections.
    - Readers are lenient (shared helpers in `@foundry2d/workspace`), so a damaged or older block never blocks opening.
  - ✅ **Branded extensions (33):** `.f2dsprite` (MIME `application/vnd.foundry2d.sprite+json`) and `.f2dlevel` (`application/vnd.foundry2d.level+json`). The older `.f2d.json` and `.f2dlevel.json` names still open but are no longer written, and the level designer's tileset import accepts `.f2dsprite`. Presets keep `.json` names, because the build imports them as JSON.
  - ✅ **Level exports (35, partly):** the toolbar's "Export game JSON" and "Copy layer" buttons became one **Export split button** (see item 42):
    - Export (JSON): game data only.
    - Export (CSV): one file per layer, zipped when there are several, like Tiled's CSV layers. Entities get a header row and a column per field.
    - Copy layer as array.

    The chosen format is remembered per browser. The ZIP writer moved to `@foundry2d/core`.

  - ✅ **PNG export (35):** "Export (PNG)" renders the level's visible layers and "Export layer (PNG)" renders the active layer. Both are at native size (a cell is grid-size pixels) on a transparent background, with tiles, value colours and entity shapes but no editor labels. The export waits for tileset images to load.

  - ✅ **Re-import tilesets (7):** a Re-import… button in the tileset editor replaces the image with an updated PNG or `.f2dsprite`. The tileset keeps its id, tile size and every placed tile, and a changed image size is flagged. Re-reading the original file automatically would need stored file handles, which aren't worth it yet.
  - ✅ **Library extras (8):**
    - **Save as** is a split button: "Save as file…" (the default, also Ctrl+Shift+S) or "Save a copy in this browser…", which asks for a name and continues with the copy.
    - Library cards on the start screen have a duplicate button.
    - The start screen shows storage use ("2.1 MB used of 1.2 GB").
  - ⏸️ **Packaged project format (6) moved to 8.7.** It is a third file format next to `.f2dsprite` and `.f2dlevel`, so the choice of replacing or adding to them belongs with the OS file association and installable app (34, 38). The Sprite Packer (Phase 9) will need the same machinery: reading ZIPs, including compressed ones from other tools, folder input and asset files. Today only files saved to disk embed tileset images; library and recovery copies already keep them in the asset store.
  - **8.4 is done** apart from item 6 (moved). Items 36–37 are deferred until there is a target engine.
- **8.5 Features** ✅ (2026-11-15): items 9, 12–15, 17–20, 23, 30, 31 and 46, in the order below.
  - ✅ **Undo for definition edits (9):** This went simpler than first expected. Undo steps refer to levels by object and to layers by document plus layer id. A `DefinitionEditCommand` can therefore restore before/after snapshots _in place_: same `Level` and document objects, with layers recreated under their old ids. All earlier undo steps stay valid.
    - **Recording:** every definition-editing method of `LevelProject` is wrapped once (a central list with undo labels), so all edits are recorded, whether from Project settings, the layers panel or the rules editor. Nested edits join the outer step, and no-ops record nothing.
    - **Cost:** layer data the edit didn't change is shared between snapshots.
    - **Merging:** repeats of the same "Edit …" step within a moment merge (dragging a colour picker is one step). Deletes and adds never merge.
    - **Visible changes:** these edits no longer clear the history, their confirmations say "Ctrl+Z undoes it", and open dialogs refresh after undo or redo.
  - ✅ **Incremental auto-layers (23):** `cells:changed` now carries an optional changed rectangle (`GridDocument.notifyCellsChanged(layerId, rect?)`, `boundsOfChanges` and `unionRects` in core).
    - The draw command and the pen, bucket, shape and stamp tools pass one; without it, listeners assume everything changed.
    - Auto-layers regenerate only the dirty area, widened by the rules' reach (`generateAutoTilesInto`).
    - On a 256×256 level, a single-cell edit now costs about 0.014 ms instead of about 21 ms for a full pass. A test checks that incremental results match a full regeneration after random strokes and undos.
  - ✅ **Selection across layers and frames (12), a decision:** the selection belongs to the canvas, not to a layer, so it is kept when switching layer or frame (as in Aseprite and Photoshop). Workflows like "select, switch layer, copy" rely on it.
  - ✅ **System clipboard images (14, partly):** Copy and Cut also put the selection on the system clipboard as a PNG, so other apps can paste it. Ctrl+V accepts images copied in other apps: they paste like internal copies, at the selection's top-left, selected, as one undo step. Fully transparent pixels become empty cells, and anything outside the sprite is cut off with a message.
    - **Paste event:** pasting uses the browser's `paste` event, which carries the clipboard without a permission prompt. Ctrl+V is therefore no longer a keymap binding, because cancelling the key press would also cancel the event.
    - **Which copy wins:** an image on the system clipboard wins over the internal copy only when our last copy reached the system clipboard. Then the image is either ours or newer. If the write failed, the internal copy is used, since an image there could be older.
    - **Tests:** end-to-end tests in Chromium with clipboard permissions check both directions, using a synthetic paste event for "copied in another app". Lasso and magic wand followed (below).
  - ✅ **Lasso and magic wand (14):** selections no longer have to be rectangles.
    - **Model:** a `Selection` is a bounding rect plus an optional per-cell mask (`SelectionShape`). Rectangular selections have no mask, so existing code paths are unchanged. `SetSelectionCommand` restores whole shapes, so undoing a move of a lasso selection brings the lasso back.
    - **Everything respects the mask:** moving (only selected cells move, neighbours inside the rect stay), copy, cut, paste, flip and rotate (the mask turns with the pixels), Delete, and the outline, which traces the mask's real edge with the same dashes.
    - **Lasso (Q):** drag an outline. Cells whose centre is inside it, or that the outline passes through, are selected, live while dragging; a click deselects.
    - **Magic wand (W):** click selects the connected area of the same colour; Shift+click selects that colour everywhere on the layer.
    - **Not yet:** adding to or subtracting from a selection (Shift/Alt with any selection tool), and moving a selection while the lasso or wand is active (use the select tool, M).
  - ✅ **GIF palette (15):** above 255 colours the GIF encoder now uses a pixel-weighted **median cut** (`export/quantize.ts`) instead of keeping the 255 most frequent colours. On a 4,096-colour gradient the average error per channel dropped from about 61 to about 3.5 (out of 255). Up to 255 colours stay exact, as before. Optional **Floyd–Steinberg dithering** (off by default; "Dither" in the GIF tab) applies only when the palette is reduced, and leaves transparent pixels alone.
  - ✅ **Flip and rotate (13, partly):** Shift+H and Shift+V flip, and Shift+R rotates 90° clockwise. They act on the selected pixels, or the whole active layer without a selection, and each is one undo step.
    - Rotation turns around the selection's centre, swaps its width and height, and is kept on the canvas.
    - There is a Transform section next to Mirror, and `transformRegion` lives in core.
    - Resize handles followed later in 8.5 (item 13, below).
  - ✅ **Level background and level fields (18):**
    - **Background:** Project settings has a new Levels tab with the project's default level background. Each level can set its own colour in the Level panel, and "Default" switches it back. The level view draws it over the checkerboard, and the world view and start-screen thumbnails fill levels with it.
    - **Fields:** level fields are defined in the same Levels tab, with the field table shared with entity types (type, identifier, default, enum, min/max). Values are edited per level in the Level panel, with the same inputs as the entity inspector; Point fields take x/y numbers there.
    - **Undo:** field definitions and the default background go through the definition-edit undo. Per-level colour and values are one `SetLevelPropertiesCommand` each.
    - **Files:** the work file stores the default background, the field definitions and each level's colour and values. Game JSON gains `metadata.bgColor` (the effective colour) and a `fields` object keyed by identifier when the project defines level fields.
  - ✅ **Entity references and list fields (19):**
    - **EntityRef fields** point at an entity instance, in this level or another one, optionally limited to one entity type ("Points at" in the field table). In the inspector they are a dropdown grouped by level, with a Pick button that takes a click on an entity on the canvas. The selected entity shows an arrow to each target in the same level.
    - **List fields:** any field type can be switched to a list ("List" in the field table). Entries are added, edited and removed one by one; Point and EntityRef entries are picked on the canvas. Switching back to a single value keeps the first entry.
    - **Integrity:** a duplicated level's references between its own entities point at the copies. Restricting the target type drops references to other types; removing an entity type frees the fields restricted to it. References to deleted entities stay, show as "missing" and export as `null` (dropped from lists). Edge resizes move listed points too.
    - **Files:** work file version 3. Game JSON writes references as `{ iid, level }` (the level identifier) and lists as arrays; CSV writes the iid and joins list entries with `|`.
  - ✅ **Game JSON import with entities (20):**
    - **Into an open project:** the Levels list has an "Import level from game JSON" button (⤓). The file becomes a new level (one undo step), matched to the project by identifier: grid and tile layers by layer name, entities by type name onto the Entities layer of the same name (or the first one), field values by field name. Auto-layers are regenerated from their sources. References between the file's entities point at the new copies, others at the project level of the exported name. Anything without a match is skipped and listed in the status message.
    - **Opened on its own:** entity layers and types come back, with fields inferred from the exported values (Int or Float, Bool, Color, String, Point, EntityRef, and lists of these); types the Pac-Man seed knows keep its colour and shape. Level fields and the background colour come back too. Tile layers become Tiles layers without a tileset, because the file only names the image.
    - Imported entities keep their iids unless the project already uses them.
    - Separately, the Level panel now links to the level field definitions ("Add level fields…").
  - ✅ **Per-layer grid sizes (17), the full LDtk model:**
    - **Core:** a `GridLayer` has a `scale`: its cell size in document cells. `GridDocument.layerSize(scale)` gives the size in cells that covers the document (the last row and column stick out when the sizes don't divide). Resizes move scaled layers by whole cells of their own; `setLayerScale` resamples the picture (each new cell takes the old cell under its centre) or only crops. `ResizeCommand` keeps each layer's own size for undo.
    - **Canvas:** the layer stack draws each layer at its own cell size, clipped to the level. Scenes may map the pointer to cells themselves (`WorkspaceScene.worldToGrid`), so tools, the cursor, the grid lines and the status bar follow the active layer's grid.
    - **Level designer:** a layer definition's optional `gridSize` (px) is set in Project settings → Layers ("Grid size", empty for the project grid). Changing it resamples painted cells as one undo step. Auto-layers always use their source's grid. Entities snap to their layer's grid; Point fields stay in level cells. Changing the project grid keeps layers with their own grid at the same pixel size.
    - **Files:** the work file stores `gridSize` per layer definition and each level layer at its own size. Game JSON adds `layerGrids` (grid size, columns, rows) for those layers; importing into a project skips a layer whose grid differs there, with a warning.
  - ✅ **Auto-layer gaps (30):**
    - **Stacking:** a rule's "Stop here" (on by default) can be switched off, so later rules add tiles to the same cell. The first rule's tile is drawn on top.
    - **Rule groups:** "+ Group" in the rules dialog. A group has a name and a switch that turns all its rules off together, and can be moved up and down. Rules outside groups are evaluated first, then each group in order. Deleting a group keeps its rules, ungrouped.
    - **Past the level edge:** per rule, cells beyond the border read as the edge cell (the old behaviour, still the default), as empty, as a chosen value, or make the rule fail.
    - **Tile offsets:** per rule, in pixels.
    - **How it is stored:** the layer cell keeps the top tile, so exports and tools stay unchanged. Cells with several tiles or an offset also get an entry in a per-level "auto stack", which is derived from the rules on every regeneration and never saved. The renderers draw from it, and game JSON lists those cells under `tileStacks`.
    - Fixed on the way: regeneration used the level's size in cells, which is wrong for auto-layers with their own grid (item 17); it now uses the layer's.
    - **Still open: auto-layers fed by other auto-layers.** LDtk's auto-layers read an IntGrid layer, as here, so this would go beyond LDtk. It needs rules that match tiles rather than values. Left until there is a concrete use for it.
  - ✅ **Shared UI components (31):**
    - **Shared stylesheet:** `@foundry2d/ui/theme/components.css`, imported after `tokens.css` by both apps, holds buttons (`.btn`, `-primary`, `-danger`, `-icon`, `-small`), `.input`, `.tool-btn`, labelled fields (`.field`, `.field-pair`, `.checkbox-field`), panel sections and section titles, hints, the status bar and dialogs (`.dialog`, `-header`, `-body`, `-footer`, `.dialog-compact`). The level designer's rules moved there unchanged.
    - **Pixel editor on the shared classes:** it styled bare `button` and `select` elements and had its own copies of the dialog, status bar and section label rules. Its markup now uses the shared classes, those copies are gone, and it looks like the level designer (blue primary button, the same inputs, buttons and status bar).
    - **DOM helpers:** `el()` and `fieldRow()` in `@foundry2d/ui` replace six copies in the level designer.
    - **Decided against wrapping these as web components.** Native `<dialog>`, buttons and inputs with shared classes cover the tool bar, panel sections, modals and status bar without the cost of custom elements. The existing components (`<layers-panel>`, `<split-button>`, `<project-browser>`, the colour picker) stay. A shared palette or property grid can follow once both apps need the same one; their palettes differ today (colours versus IntGrid values).
  - ✅ **Guide grid per layer (46):** Project settings → Layers has "Guide grid (px)", width × height (one value makes it square). While that layer is active, the level view draws light blue helper lines at that spacing over the cell grid, with the grid toggle. Display only: cells, tools and exports keep the real grid. Saved in the work file; undoable like other definition edits. `GridLinesPass` gained `id` and `color` options for it.
  - ✅ **Adding to and subtracting from selections (14):** with the select, lasso and magic wand tools, Shift adds to the selection and Alt subtracts from it (as in Photoshop and Aseprite). With Shift or Alt the select tool always draws a new rectangle, even inside the selection, instead of moving pixels, and a plain click keeps the selection. Alt no longer switches to the eyedropper while a selection tool is active. The magic wand's "this colour everywhere" moved from Shift to **Ctrl** (Cmd). Core: `combineShapes` and `selectionOp` (`tools/selectionShapes.ts`).
  - ✅ **Selection resize handles (13):** with the select tool, eight handles sit in the cells just outside the selection's corners and edge midpoints. Dragging one scales the selected pixels (nearest neighbour; masks of lasso and wand selections scale too) with a live preview, as one undo step that also restores the selection. The opposite edges stay put and the size never drops below one cell. Core: `selectionHandles` and `scaleRegion`.
  - ⏸️ **Deferred from 8.5:** auto-layers fed by other auto-layers (part of 30), until there is a concrete use for it.
- **8.6 Quality** ✅ (2026-11-15): items 16, 26–28.
  - ✅ **Export downloads (16):** end-to-end tests now click Export in Chromium for every format and check the downloaded files' signatures: PNG, WebP (lossless and lossy), JPEG, BMP, all frames as ZIP, the spritesheet as one ZIP, as a PNG plus TexturePacker JSON (two frames listed), and image only, and the animated GIF. All passed on the first run, so no export bug turned up.
  - ✅ **Toolchain quirk (26):** documented in the new [contributor notes](CONTRIBUTING.md) (stale dev-server modules and stale `import.meta.glob` results after shell edits on Windows, and the fixes). The project pins Vite+ 1.4.0 and 1.6.0 is out; whether it fixes the watcher can't be tested without reproducing the quirk, so the notes say how to check when upgrading.
  - ✅ **Accessibility pass (27):** a script listed every button without an accessible name and every input or select without a label in both apps, including all Project settings tabs and the rules dialog. Two selects were unlabelled (the entity field type and the rule pattern size) and now have labels. Since item 31 the pixel editor's frame thumbnails, swatches and checkboxes had lost their focus ring; `components.css` now gives every focusable control the shared ring (zero specificity, so components can restyle it), and the levels list shows when it has the keyboard. Keyboard access was already there for panel actions (buttons, the levels listbox, keys 1–9 and tool keys). Still mouse-only: picking tiles in the tileset picker and painting on the canvas.
  - ✅ **Performance check (28):** measured in Chromium on a 256×256 platformer level with an auto-layer and four extra IntGrid layers, and a 64×64 sprite with 120 frames.
    - Level designer: full auto-layer regeneration 39 ms, a 3×3 edit 0.1 ms; single-cell edits with a redraw 0.2 ms; saving 6 ms (0.7 MB of JSON), loading 49 ms.
    - **Fixed:** with the whole level in view, a frame took 56 ms (about 17 fps while panning), because each of 26,000 tiles was a separate `drawImage`. Tiles layers now draw from a one-pixel-per-cell overview (each tile's average colour, cached per layer version) when a cell is under 3 screen pixels: 0.4 ms per frame. World thumbnails went from 105 ms to 16 ms.
    - Pixel editor: saving 35 ms (6.3 MB of JSON), loading 25 ms, switching frames with onion skin 0.7 ms; an edit redraws only its own frame's thumbnail.
    - Nothing else needed work at these sizes. Big sprites make big work files (RLE does little on noisy pixels); the packaged format (item 6) is the place to address that.
- **8.7 Engine formats and distribution** ✅ (2026-11-15): items 38–40, plus item 34 (OS file association) and item 6 (packaged project format).
  - ✅ **Spritesheet formats (40):** new package `@foundry2d/formats` with one writer per data format, all reading the same placement data (TexturePacker field names): TexturePacker JSON Hash and Array (Phaser, PixiJS), Starling/Sparrow XML, Godot 4 `SpriteFrames` (`.tres`, an `AtlasTexture` per frame, durations relative to the shortest frame, one animation per frame tag including ping-pong), LibGDX `.atlas`, and CSS sprites. Each has a fixture test against hand-checked output; trimmed frames are covered. The pixel editor's export dialog lists them all and downloads the matching file (`.json`, `.xml`, `.tres`, `.atlas`, `.css`); an end-to-end test downloads the Godot one. The frame layout code stays in the pixel editor until the Sprite Packer needs it. Not written: Unity metadata (needs `.meta` GUIDs), Cocos2d `.plist` and Phaser multi-atlas; they fit the same registry when a target engine asks for them.
  - ✅ **Installable apps and offline use (38):** a build plugin (`packages/workspace/vite/pwa.ts`) writes each app's `manifest.webmanifest`, `icon.svg` and `sw.js`. The service worker precaches every built file (versioned by a hash of the build's file names; caches are per app scope) and serves pages network-first, files cache-first. A new version waits: `registerAppUpdates` in `@foundry2d/ui` shows "A new version … is ready" with Reload and Later, so an open tab never switches versions mid-edit. Checked in Chromium against a production build: the worker activates and caches everything, and changing the worker brings up the banner, Reload switches over and the old cache is deleted. Development (`vp dev`) has no worker.
  - ✅ **OS file association (34):** the manifests declare `file_handlers` (`.f2dsprite` and `.f2dlevel` with their MIME types) and `launch_handler: focus-existing`. Once a user installs an app (Chromium desktop), double-clicking a work file opens it there: `ProjectFiles.bindLaunchQueue()` takes the file from the Launch Handler API and opens it like Open file (with the unsaved-changes check, and as the save target). Not testable without installing; the reading path is shared with Open file.
  - ✅ **Packaged project format (6):** a `.f2dlevel` can now be a ZIP with `project.json` and the tileset images under `images/`, chosen per project with "Packaged file" in Project settings → Tilesets (saved with the project). Same extension and file association; reading tells ZIP from JSON by the first bytes, so both kinds open everywhere. The session gained `encodeFile`/`decodeFile` hooks, and core a ZIP reader (`readZip`, `isZip`) for stored and deflated entries, so ZIPs from other tools open too. Library and recovery copies are unchanged (images in the asset store). The pixel editor keeps plain JSON: it has no separate images.
  - ⏸️ **Standalone desktop and mobile apps (39), decided: not now.** The installable web apps (38, 34) already give an app window, offline use, file association and the File System Access API in Chromium-based browsers. Packaging adds value only for native needs these lack (watching files on disk, native menus, Firefox and Safari users wanting an app). If that comes up, **Tauri** is the choice for desktop (small, system web view; the apps need nothing Chromium-only beyond File System Access, which Tauri replaces with its own file API). **Mobile** waits for a touch pass (pinch zoom, long press for the secondary action, larger hit targets); then Capacitor around the same build, or the installable web app on Android.
- **8.8 Follow-ups** ✅ (2026-11-17): item 47. Item 48 (naming) comes last, after Phase 10.
  - ✅ **Rulers on whole cells (47):** `rulerScale` in `RulersPass` replaces the 1-2-5 step split into tenths. Ticks only fall on whole units (cells or pixels), never fractions, and label steps come from a set chosen per view: **binary** (1, 2, 4, 8, 16…) in the level view and the pixel editor, so labels sit on the grid's stronger lines (every 4 cells in the level designer, every 8 pixels in the pixel editor), and **decimal** (1, 2, 5, 10, 20, 50…) for world-view pixel coordinates. The example from the report (8 px tiles at 259%) now labels every 4 tiles with a tick per tile; the pixel rulers' fractional ticks at some zoom levels are gone too. Labels keep marking the lines between cells ("8" is the line after the 8th cell); to make that visible, the cell under the pointer is shaded on both rulers when it is at least 6 px wide. The level view's ruler counts in the active layer's cells, so it follows layers with their own grid (item 17), like the cell grid.

**Architecture**

1. ✅ Split the composition roots. The level designer `Application.ts` (1,200 lines) and pixel editor `Application.ts` (825) mix file handling, key bindings, tool syncing, status bar and rendering glue. Move these into controllers (files and session, keys, tools, status, export, clipboard), and keep `Application` as wiring only. (8.3)
2. ✅ Extract the app shell both apps duplicate: project session wiring, start-screen handling, `showMessage` and the status bar, undo/redo button state, and zoom readouts. Move it into `@foundry2d/workspace` (an `AppShell` helper) or `@foundry2d/ui`. (8.3: shared file workflow)
3. ✅ Share the theme. Both apps carry their own copy of the design tokens and panel CSS; move them into one stylesheet in `@foundry2d/ui`. (8.3)
4. ✅ Review the store. The pixel editor keeps preferences in the Ajv/Immer store but the sprite outside it; the level designer is similar. Document the rule (the store holds UI state only, never cell data) and remove leftover actions. (8.3)
5. ✅ `compositeRgba` and the layer bitmaps read `Uint32Array` pixels as RGBA bytes, which assumes a little-endian host. That holds for every browser today; add a startup assertion and a note. (8.1)

**Files and storage**

6. ✅ Saved level files embed tileset images as data URLs. Big tilesets make big JSON. Offer an optional packaged format (a `.f2dproj` ZIP with `project.json` plus images), reusing the ZIP writer from the exporter. (8.7)
7. ✅ Tilesets imported from a pixel-editor sprite are one-time copies. Remember the source file (handle or library id) and offer **Re-import**. (8.4)
8. ✅ Not done in Phase 5: a choice between file and library when using "Save as", duplicating a project in the library, and showing storage quota and usage. (8.4)
9. ✅ Definition edits are not undoable (by design, like LDtk). Consider snapshot-based undo for them, since the project JSON is cheap to serialize. (8.5)

**Pixel editor**

10. ✅ The mirror guide is 1px and easy to miss at low zoom. Draw it thicker and label the axis (**earlier**, one line). (8.1)
11. ✅ Moving a selection on a locked or hidden layer silently does nothing. Show the not-allowed cursor and a status message (**earlier**). (8.1)
12. ✅ Decide what happens to the selection when switching layer or frame. It is kept today, which is useful but surprising when the new layer is empty there. (8.5)
13. ✅ Selection handles for resizing, plus flip and rotate of the selected pixels. (8.5)
14. ✅ From Phase 6b: paste images from the system clipboard (and copy as PNG), lasso and magic wand selections, plus adding to and subtracting from selections. (8.5)
15. ✅ The GIF encoder is exact up to 255 colours. Above that it needs a proper quantizer (median cut or octree), with optional dithering. (8.5)
16. ✅ The export dialog was tested through unit tests and the dialog UI, but no download was clicked in a real browser session. Do one manual pass per format. (8.6)

**Level designer**

17. ✅ Per-layer grid sizes (LDtk allows them). Today one grid size covers every layer. (8.5)
18. ✅ Level background colour and level custom fields (LDtk has both). This reuses the Phase 7 field editor. (8.5)
19. ✅ Entity reference fields (a door pointing at a switch) and array fields. Deferred from Phase 7 to keep its scope. (8.5)
20. ✅ Game JSON import cannot recreate entities (the file has no definitions). Map known identifiers when importing over an existing project. (8.5)
21. ✅ Project settings has grown to five sections in one scrolling dialog. Split it into tabs (General, Layers, Tilesets, Entities, Enums), so the header and close button stay in view. (8.1)
22. ✅ Entity tiles are chosen by numeric tile id. Reuse the tileset picker for a visual choice. (8.1)
23. ✅ Auto-layers regenerate the whole layer on every source change, because `cells:changed` carries no region. Add dirty rectangles to the event and regenerate only the area around them (pattern radius). This matters on 256×256 levels with many rules. (8.5)
24. ✅ Game JSON import still treats a `spawns` key as a generic IntGrid layer (values named `value_n`). Map it to Pac-Man entities, or keep the old names for older exports. (8.1)

**Quality**

25. ✅ Add browser end-to-end smoke tests for both apps: open, draw, undo, save, reload, recover. Use Vitest browser mode or Playwright, so regressions like the stale zoom readout get caught. Canvas tests need real pointer events (synthetic ones were what exposed the pointer-capture bug in Phase 7). (8.2)
26. ✅ Toolchain quirk seen in Phase 7b on Windows: the dev server kept serving a stale module after a file was appended to from a shell, and the test runner kept a stale `import.meta.glob` result until the importing file's content changed. Restarting the dev server, or editing the importing file, fixes it. Check whether a newer Vite+ fixes it, and otherwise document it in the contributor notes. (8.6)
27. ✅ Accessibility pass: focus order, visible focus rings, `aria` labels on canvas-adjacent controls, and keyboard access to every panel action. (8.6)
28. ✅ Performance check on big levels (256×256 with several layers) and long animations (100+ frames): thumbnails, onion skin and autosave serialization. (8.6)

**Collected from earlier phases' "not done" notes**

29. ✅ Phase 1 kept `locked` in core but never exposed it. Add a lock toggle to `<layers-panel>` for both apps. The level designer's generated auto-layers show as locked and can't be unlocked. (8.1)
30. ✅ Phase 7b auto-layer gaps (LDtk has them): several tiles stacked in one cell (rules that don't stop at the first match), rule groups that can be toggled together, per-rule out-of-bounds handling, tile offsets, and auto-layers fed by other auto-layers. (8.5; auto-layers fed by other auto-layers deferred)
31. ✅ The target architecture planned shared `@foundry2d/ui` components (tool bar, palette, panel section, property grid, modal, status bar). Both apps still build these in plain HTML. Extract them alongside items 2 and 3. (8.5)

**Work files versus export files** (requested 2026-11-14; to check during 8.4)

Tools like Photoshop, Piskel, Tiled and LDtk keep two kinds of output apart:

- a **work file** that stores everything needed to pick up where you left off;
- **exports**, which are the product: only the data a game or engine needs.

Foundry2D already has both, but the line between them isn't drawn deliberately yet.

32. ✅ **Define the work file as the full editing state.** Today it stores the document only. (8.4)
    - Add view and editor state: camera (zoom and position, per level in the level designer), active layer, frame, tool and colours, grid and onion-skin toggles, the open view (world or level), panel sizes, and the last export settings and target.
    - Keep this state in a separate `editor` block, so the document data stays clean and tools that read the file can ignore it.
    - Restoring it on open makes a work file reopen exactly as it was left.
33. ✅ **Branded work-file extensions** that the OS can associate with the apps, for example `.f2dsprite` and `.f2dlevel`. (8.4)
    - Today the names end in `.json` (`.f2d.json`, `.f2dlevel.json`), so the OS treats them as plain JSON.
    - The content can stay JSON, as Piskel's and LDtk's files do; the extension is what links the file to the app.
    - Give each format a registered-style MIME type (e.g. `application/vnd.foundry2d.sprite+json`) for the save picker.
    - Keep opening the old `.json` names.
34. ✅ **OS file association for a web app.** Add a web app manifest to each app. Once a user installs the app (Chromium desktop), its `file_handlers` entry associates the branded extensions with it, and the `launchQueue` API then opens files double-clicked in the OS. (8.7)
    - Without installing, the apps keep working through Open and drag-and-drop.
    - This is also the natural point to add an app icon and offline support (service worker), so check scope then.
35. ✅ **Level designer exports** in their own export dialog (Ctrl+E), mirroring the pixel editor's. (8.4, as the Export split button rather than a dialog)
    - Game JSON per level or for the whole world, with only game data: no editor colours, uids or view state. Review what today's export still carries.
    - CSV per IntGrid or Tiles layer (row per line, like Tiled's CSV layer format), optionally as a ZIP with one file per layer.
    - PNG renders of levels or layers, and entities as JSON (or CSV for simple tables).
    - The dialog remembers its settings in the work file (item 32), so re-exporting is one click.
36. ✅ **Pixel editor export formats.** Images, spritesheets and TexturePacker JSON exist. Check which data formats engines actually read, so we add those rather than guess. (folded into item 40, done in 8.7)
    - CSV frame lists (name, x, y, w, h, duration) are rare for spritesheets. Cheap to add, but probably low value.
    - The commonly used ones are Starling/Sparrow XML (Phaser, Starling and others), Aseprite-style JSON with tags, and Godot `SpriteFrames` (`.tres`).
    - Decide with a target engine in mind.
37. ⏸️ **"Native format versus plain JSON" (the LDtk note).** As I understand LDtk's advice (decision to take with a target engine):
    - Its native `.ldtk` file is still JSON, but it is the editor's complete, versioned project: definitions with uids, editor-only settings and layout. The editor migrates it when its format changes.
    - A plain JSON export is a one-way snapshot for games. It can drop editor data and isn't guaranteed to reopen losslessly or to be upgraded.
    - "Better support" therefore means round-tripping and future upgrades, not a different encoding.
    - Apply the same contract here: work files carry a format version with migrations (both formats already have versions); exports are documented and stable for games, but are not meant to be reopened for editing.
    - Also consider LDtk's option to store each level in its own file, which keeps version-control diffs small for big worlds.

**Delivery and engine formats** (requested 2026-11-14)

38. ✅ **Offline support (installable web app).** Each app gets a web app manifest, icons and a service worker that caches the app shell, so it installs from the browser and works offline. Items 33–34 (branded files, file association) build on the same manifest. (8.7)
    - Storage already works offline (IndexedDB, File System Access).
    - The service worker needs an update flow ("new version available, reload"), so a cached old version never silently edits newer files.
39. ⏸️ **Standalone desktop and mobile apps.** Decide between packaging the existing web apps and keeping them installable web apps only. (8.7: decided, not now)
    - **Desktop:** Tauri (small, uses the system web view) or Electron (one Chromium everywhere, bigger). Either gives real file associations, native menus, recent files and plain file-system access without browser pickers.
    - **Mobile:** Capacitor around the same build, or installable web apps first. Touch input needs its own pass: pinch zoom, a long press for the secondary action, and larger hit targets.
    - Choose after item 38, because the installable web app may already cover most needs.
40. ✅ **Spritesheet formats for several game engines**, as one shared module (e.g. `@foundry2d/formats`). The pixel editor's exporter and the Sprite Packer (Phase 9) both use it, so a format is written once. (8.7)
    - Candidates: TexturePacker JSON Hash and Array (done), Phaser (JSON plus multi-atlas), Starling/Sparrow XML, Aseprite JSON with tags, Godot `SpriteFrames` and `AtlasTexture`, Unity sprite metadata, LibGDX `.atlas`, Cocos2d `.plist`, and CSS sprites.
    - Each format gets a fixture test with a known-good file, checked against the engine's importer where practical.
    - Supersedes the format question in item 36: pick the first few by target engine, then grow the list.

**Reported issues**

41. ✅ **Level designer layers panel had no add or delete buttons** (reported 2026-11-15). Layers could only be moved and renamed there; adding and deleting meant going to Project settings. Fixed right after 8.3:
    - "+" opens a menu to add an IntGrid, Tiles or Entities layer above the active one. IntGrid layers start with one value, and Tiles layers bind the first tileset.
    - Delete asks first, because layer definitions apply to every level and aren't undoable.

42. ✅ **Layers panel and toolbar consistency** (requested 2026-11-15), done in 8.4:
    - **Layers panels:** the level designer's panel now has duplicate as well (definition plus data in every level; entity copies get new ids), matching the pixel editor.
    - **Export split button:** the level designer's separate "Copy layer" toolbar button (which copies cells as a number array for code, a different thing from duplicating) moved into the Export split button.
    - **Shared `<split-button>` component** in `@foundry2d/ui`: the main part runs the current default, and the arrow opens the alternatives. Picking one makes it the default (the label follows) and runs it. Options are `<option>` children, the default can be remembered per browser, and it is keyboard accessible. The name "split button" is the common one (Microsoft and most design systems); "dropdown button" usually means a button that only opens a menu. Based on the `spritesheet-generator` prototype's SplitButton.
    - **Pixel editor undo/redo:** these existed but were easy to miss, as ↶ ↷ text glyphs at the start of the second toolbar row. They moved next to Export in the top row with the same icons as the level designer, and disabled icon buttons stay more visible.

43. ✅ **Three reported issues** (2026-11-15), fixed:
    - **Missing redo icon in the pixel editor:** its SVG path was `"redo"`. When the icon was copied from the level designer, the script matched the `d="` inside `data-command="redo"`. It now uses the real path.
    - **Colour picker panel hidden behind the canvas:** the panel was absolutely positioned inside the tools column, which comes before the canvas column, so no `z-index` could lift it out of its stacking context. It is now a manual **popover** in the browser's top layer, placed in viewport coordinates next to the swatch (above it when there's no room below), kept inside the window, and repositioned on resize or scroll.
    - **Blank project by default:** the level designer started with the Pac-Man preset. It now starts with the Blank preset, and Blank is first among the templates. The pixel editor already started blank. The start screen still opens when the browser library has saved work.

44. ✅ **Split-button menu stretched the toolbar** (reported 2026-11-15), fixed. In the level designer, opening the Export menu grew the toolbar and showed a scrollbar instead of floating over the canvas. The toolbar scrolls sideways (`overflow-x: auto`), so it clipped the absolutely positioned menu and scrolled instead of letting it overflow. The `<split-button>` menu is now a top-layer popover placed in viewport coordinates, like the colour picker panel (item 43). An end-to-end check makes sure the toolbar doesn't grow. Rule of thumb for future components: menus and panels that pop out of a control should be popovers, not absolutely positioned children.

45. ⚠️ **Open question: what the apps show at startup** (raised 2026-11-15, to decide). Today both apps start with a new blank, unsaved project ("untitled"). They restore unsaved work from the last session if there is any; otherwise, when the browser library or recent files have something, the start screen opens on top of the blank project. (open question)
    1. Should the apps always start with a brand-new, blank, unsaved project behind the start screen?
    2. Should the project saved last (if there is one) be open behind the start screen instead?
    3. Should the start screen mark the project that was open last, with its saved changes?

    **Suggestion so far (not decided):** combine 1 and 3. Always start with a brand-new project. On the start screen, mark the project that was worked on last, meaning the one with the most recently saved changes, so it is one click away without being opened automatically. This needs a closer look at how the apps should behave as a whole before it is settled.

46. ✅ **Guide grid per layer** (requested 2026-11-15). LDtk layer definitions have an optional "guide" grid, `guideGridWid` × `guideGridHei` in pixels, next to the layer's real `gridSize`. It only affects how the layer is shown in the editor (helper lines, for example a 16 × 16 room grid over an 8 px layer); cells, tools and exports keep using the real grid. Checked against the LDtk JSON field docs, which describe the fields but not how the editor draws them, so the drawing details are still to be confirmed. (8.5)
    - **Built as:** two optional numbers on a layer definition ("Guide grid W × H", px) in Project settings → Layers, stored in the work file. When the active layer has them, the level view draws a second, lighter grid at that spacing (another `GridLinesPass` with a step getter, already supported since item 17). No effect on game exports.

47. ✅ **Rulers on tile grids** (reported 2026-11-15, 8.8). The rulers pick a "nice" label step of 1, 2 or 5 × 10ⁿ and split it into 10 ticks (`niceStep` in `packages/render/src/passes/RulersPass.ts`). That suits pixels (with quirks at some zoom levels there too), but in the level designer, which labels in tiles, it doesn't match how people count tiles:
    - **Example:** Pac-Man preset (28 × 36 cells of 8 px), 259% zoom, 1920 × 1080 screen. Labels and grid lines land on the same pixels (checked: ruler and grid both put line 28 at the same x), so this isn't an offset. The confusion comes from the subdivision: at that zoom, labels every 5 tiles with ticks every half tile, while the grid's stronger lines come every 4 cells (`majorGridEvery: 4`). Counting along the ruler (from label 25 between tiles 25 and 26, two ticks on) lands elsewhere than counting tiles on the grid, and the 28th tile appears to line up with "31".
    - **To rethink for tile units:**
      - Ticks only on tile boundaries, never fractions of a tile.
      - Steps from tile-friendly sets (1, 2, 4, 8, 16… or multiples of the major grid), so labels and the stronger grid lines agree.
      - Whether to label boundaries (0-based, as now: "25" is the line after the 25th tile) or tiles themselves (1-based, centred on the cell). At least make the convention visible.
      - Layers with their own grid (item 17) and guide grids (46): the ruler should follow the active layer's grid, like the cell grid does.
    - Also review the pixel rulers' step choice at the zoom levels where it looks odd.

48. ⚠️ **Naming and branding** (requested 2026-11-15, **last**, after Phase 10). Make each app's name consistent everywhere: package name (`package.json`), directory, page title, work-file extension and MIME type. Today they differ, e.g. the level designer is `@apps/level-designer` in `apps/level-designer/`, "Foundry2D · Level Designer" as the title, `.f2dlevel` files with `application/vnd.foundry2d.level+json`. The request is to use one short lower-case name per app in all of these, the level designer as "levels". The pixel editor's name, the exact title format, and how to keep existing `.f2dsprite`/`.f2dlevel` files and their MIME types opening (as `.f2d.json` still does) are to be decided. File handlers in the manifests (item 34) follow the new names.

### Phase 9: Sprite Packer app (TexturePacker-style) ⚠️ (in progress)

**Stages** (planned 2026-11-17, like Phase 8):

- **9.1 Packing engine** ✅ (2026-11-17): new package `@foundry2d/atlas`.
  - **Raster helpers** moved out of the pixel editor (crop, copy, scale, flatten, trim bounds), plus `rotateImageCW`, `extrudeEdges`, `imageHash` and `sameImage`.
  - **`pack`:** MaxRects with the four usual fit heuristics (best short side, best long side, best area, bottom-left), shelves, grids and horizontal or vertical strips. Optional 90° rotation (MaxRects and shelves), padding between sprites and a border around the sheet, power-of-two and square sheets, and a maximum sheet size. Each MaxRects sheet starts at the smallest near-square size that could hold the remaining sprites and grows about 10% at a time; what doesn't fit at the maximum goes on further sheets (multi-atlas).
  - **`buildAtlas`:** trims, stores identical sprites once (their frames share one rectangle), extrudes edges, packs and draws the sheets, and reports the fill rate. Frames follow TexturePacker's conventions: a rotated sprite is stored turned 90° clockwise and its frame keeps the unrotated size.
  - **Formats:** `SheetFrame.rotated` is now a boolean and each format says whether it `supportsRotation`. TexturePacker JSON does; Starling XML, Godot, LibGDX and CSS refuse rotated frames instead of writing wrong data (their rotation conventions are to be checked against the engines before enabling it).
  - **Tests:** a randomised check that every algorithm and heuristic keeps sprites inside the sheet and apart (padding included), over 80% fill for MaxRects on 120 random sprites, overflow into more sheets, power-of-two and square sizes, trimming, aliasing, extrusion and rotated pixels.
  - **Pixel editor:** its spritesheet export now runs on the engine; "Packed" uses MaxRects instead of shelves. Output is otherwise unchanged (one sheet, padding also around the edge).
- **9.2 The app** ⚠️: `apps/sprite-packer` (dev server on port 3002; end-to-end port 4172): image and folder input, the sprite list, the sheet preview on the shared workspace, packing settings, export through `@foundry2d/formats`, and the `.f2dpack` work file on `ProjectSession` (library, recovery, start screen).
- **9.3 Extras** ⚠️: animation sequences from numeric suffixes with a preview, live folders (re-pack on change), pixel-editor sprites as input, unpacking existing atlases, WebP, premultiplied alpha and scale variants, pivots, and the installable-app build (item 38).

A third app in the monorepo that turns many images into optimised spritesheets plus engine data. The pixel editor keeps its own spritesheet export for its sprites, and the packer is for whole asset folders.

- **Prototype to learn from:** `spritesheet-generator` (a separate repository in the GitHub folder; reference only, nothing depends on it). It is about 1,100 lines of plain JavaScript with:
  - image upload;
  - horizontal, vertical and grid layouts, with margin and edge extrusion;
  - frame data as JSON;
  - saving through the file picker or a download;
  - a theme switcher.

  It has no real packing, trimming, rotation, multiple sheets or engine formats. Its layout code becomes the packer's simple layouts; the rest is new.

- **Inputs:** drag-and-drop images or folders (File System Access for live folders that re-pack on change), pixel-editor sprites and their frames, and existing atlases to unpack. Names come from file paths, with animation sequences detected from numeric suffixes.
- **Packing:**
  - **Algorithms:** MaxRects (best-fit heuristics), shelf and grid, with optional 90° rotation.
  - **Per-sprite clean-up:** trimming of transparent edges (keeping the original size and offset), extrusion, padding, and power-of-two or square sizes with a maximum sheet size.
  - **Several sheets:** overflow into multiple sheets (multi-atlas), aliasing of identical images so they are stored once, and pivots per sprite.
- **Outputs:**
  - **Images:** PNG (and WebP), with optional premultiplied alpha and scale variants (e.g. @1x and @2x).
  - **Data:** every engine format through the shared module (item 40).
  - **Project file:** a branded work file (`.f2dpack`) that stores sources, settings and per-sprite overrides, following items 32–37.
- **UI:** the shared shell from Phase 8 (workspace canvas, panels, project browser). A sheet preview with zoom, a sprite list with search and overrides, an animation preview, and packing statistics (fill rate, sheet count).
- **Reuse:** `@foundry2d/workspace` for the preview canvas, the export controller's PNG and ZIP encoders, `compositeRgba` for sprite input, and storage and `ProjectSession` for the library and recovery.

### Phase 10: Documentation, manual and onboarding ⚠️ (not started)

1. **Markdown sources** in `docs/`, the single source of truth:
   - `README.md` at the root: what foundry2d is, screenshots, quick start (`vp install`, `vp dev`), and the repository layout.
   - **Architecture:** packages and their boundaries, the document, command and history model, the render pipeline, workspace and scenes, storage, and the project file formats.
   - **Technologies:** Vite+ (`vp`), TypeScript, Vitest, Ajv and Immer, Canvas 2D, Web Components, IndexedDB and the File System Access API.
   - **API reference** for `@foundry2d/core`, `render`, `workspace`, `store` and `ui`, generated from TSDoc comments (TypeDoc with its Markdown plugin) and kept in sync by a `vp run docs` task.
   - **User manuals** for the pixel editor, the level designer and the sprite packer: every tool, panel and dialog with what it does and why, workflows (draw a sprite and export a spritesheet; build a Pac-Man maze; import a sprite as a tileset; place entities), file formats for game developers, and hotkey tables.
   - Hotkey tables are generated from the apps' keymaps, so the docs can't drift from the code.
2. **Manual site** (`apps/docs`, built with Vite+ from the same Markdown):
   - Left: a chapter and article tree, collapsible and clickable, with search.
   - Right: all articles in one continuous scroll, like a PDF reader, starting at the first chapter.
   - Scrolling highlights the current article in the tree and expands its chapter (scroll-spy with `IntersectionObserver`). Clicking an entry scrolls to it, and the URL hash keeps the place, so links can be shared.
   - Light and dark themes from the shared tokens, a print stylesheet, and "Open in app" links from the manual into the editors.
3. **First-run guide** in both apps: a `<guided-tour>` web component in `@foundry2d/ui`.
   - Steps are anchored to UI elements (spotlight plus a message card with Back, Next and Skip). They are defined per app as data.
   - It starts on first launch, can be replayed from a Help menu, and has links into the matching manual articles.
   - Completion is stored per app, so updates can add a "What's new" tour for new features.

---

## 4. Decisions log

1. **Order after Phase 0:** Phase 1 (pixel parity) came first. Done.
2. **Pac-Man tile size:** 8 px, the arcade original, set in the Pac-Man preset and editable per project.
3. **Project file format:** human-readable JSON with RLE layer data. Since stage 8.4 the files use branded extensions, `.f2dsprite` (pixel editor) and `.f2dlevel` (level designer), with vendor MIME types; the older `.f2d.json` and `.f2dlevel.json` names still open.
