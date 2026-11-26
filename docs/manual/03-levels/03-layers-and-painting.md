# Layers and painting

## The layers panel

In the level view, **Layers** lists the project's layers from top to bottom; the highlighted one is active and gets the paint.

- **Click** to make a layer active, **double-click** to rename it.
- The **eye** hides it, the **lock** protects it (locked Entities layers can still be selected, to inspect them).
- The rail: **+** adds an IntGrid, Tiles or Entities layer above the active one, then **duplicate** (definition and content, in every level), **move up**, **move down**, **delete** and **opacity**.
- **Edit layer definitions…** opens Project settings → Layers.

Layers are project-wide: adding, removing or reordering one does it in every level.

## Painting tools

Tools work on IntGrid and Tiles layers. On Entities layers the canvas places and moves entities instead (see [Entities](06-entities.md)).

| Tool               | Key         | What it does                                                                  |
| ------------------ | ----------- | ----------------------------------------------------------------------------- |
| **Pen**            | B           | Paints the chosen value or tile (or tile stamp).                              |
| **Eraser**         | E           | Empties cells. Painting with the **right mouse button** erases with any tool. |
| **Rectangle fill** | R           | Drag a rectangle to fill it.                                                  |
| **Bucket fill**    | G           | Fills the connected area of the same value or tile.                           |
| **Pick value**     | I, hold Alt | Takes the value or tile under the pointer.                                    |

**1–9** choose the IntGrid value with that position in the palette.

## IntGrid values

The palette lists the active layer's values with their names and colours. Click one, or press its number. Values are edited in Project settings → Layers: each has a number (0 is always empty), an identifier and a colour. Removing a value clears it from every level, and Ctrl+Z brings it back.

## Layer definitions (Project settings → Layers)

- **Grid size (px)** at the top is the project's grid: the size of one level cell.
- **+ IntGrid**, **+ Tiles**, **+ Entities** add layers; select one in the list to edit it:
  - **Identifier:** the name games see in exports.
  - **Values** (IntGrid): number, identifier and colour.
  - **Tileset** (Tiles), and **Auto-tiling: generate from IntGrid layer** (see [Auto-layers](05-auto-layers.md)).
  - **Grid size (px):** a layer can have its own, coarser or finer grid (empty means the project grid). Changing it resamples the painted cells. Entities snap to their layer's grid.
  - **Guide grid (px):** helper lines at that spacing while the layer is active, for example the size of a screen or room. They only help you see; nothing else uses them.
  - **Delete layer** removes it from every level (undoable).
