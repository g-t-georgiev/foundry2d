# foundry2d Roadmap

Two apps on one engine:

- **Pixel Editor** (`apps/pixel-editor`): Piskel-like sprite editor. One document, one canvas workspace.
- **Level Designer** (`apps/level-designer`): LDtk-like editor. A project holds a **world** of **levels**. You edit each level's layers (IntGrid, Tiles, Entities). First target: authoring the Pac-Man maps.

The reference repos (`2d-pixel-art-editor`, `level-editor`) are sources of behaviour and UI only. We port ideas and code from them; nothing depends on them.

---

## 1. Where things stand (2026-11-13)

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
│  ├─ entities[]   { uid, name, size, color, fields[] }      (later)
│  └─ enums[]                                                   (later)
├─ worldLayout: "free" | "gridvania" | "linearH" | "linearV"
└─ levels[]       { uid, name, worldX, worldY, pxWidth, pxHeight,
                    layerInstances[] { defUid, data: Int32Array (RLE in JSON) | entities[] } }
```

- IntGrid and Tile layer instances are `GridLayer<Int32Array>`, so pen, eraser, bucket, eyedropper and history work unchanged.
- Entity layers are a separate non-grid layer type in core. They get their own commands.
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

- One grid size per project. Every layer in a level shares the level's grid, which keeps the "equal-size layers" document invariant. Per-layer grid sizes (LDtk allows them) can come with tile layers.
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

### Phase 4: Tiles

- Tileset import (PNG), a tileset picker component, Tile layers, rectangular stamps, flip bits encoded in the high bits of the id.
- Optionally later: auto-layer rules driven by IntGrid values. This is LDtk's signature feature.

### Phase 5: Entities and custom data

- Entity defs with typed fields, placement and move tools, a property grid, and Enums.

### Phase 6: Pixel Editor, the Piskel features

- Frames/timeline, onion skin, animated preview, more shapes (line, rect, ellipse), selection/move, mirror drawing, palettes, and spritesheet/GIF export.
- Bridge to the level designer: a sprite made in the pixel editor can be used as a tileset.

---

## 4. Open decisions

1. **Order after Phase 0.** The recommendation is Phase 1 (pixel parity) first. It is small, ports almost directly, and proves the Workspace kit before the level designer depends on it. If the Pac-Man maps are urgent, go straight to Phase 2.
2. **Pac-Man tile size.** The arcade original uses 8 px tiles; the prototype uses 16 px. This is a per-layer `gridSize` in the defs, so it isn't locked in, but the seed project needs a value.
3. **Project file format.** The recommendation is human-readable JSON with RLE buffers, so it diffs well in the game repo. The alternative is binary (`.f2d`) for size.
