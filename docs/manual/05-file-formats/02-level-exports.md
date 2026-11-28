# Level exports

## Game JSON

**Export (JSON)** writes one level. Layers and entities are keyed by their identifiers, so a game looks them up by name.

```json
{
  "metadata": { "name": "level_1", "columns": 28, "rows": 36, "tileSize": 8, "bgColor": "#000000" },
  "fields": { "music": "maze" },
  "layers": {
    "collision": [1, 1, 1, 0, 0, "…"],
    "collectibles": [0, 0, 0, 1, 1, "…"]
  },
  "entities": {
    "entities": [
      {
        "id": "Ghost",
        "iid": "f3b2…",
        "x": 108,
        "y": 116,
        "cx": 13,
        "cy": 14,
        "left": 100,
        "top": 108,
        "width": 16,
        "height": 16,
        "fields": { "kind": "blinky", "scatterTarget": { "x": 25, "y": 0 } }
      }
    ]
  }
}
```

- **`metadata`:** the level's name, size in cells, the cell size in pixels and its background colour.
- **`layers`:** one array per IntGrid and Tiles layer, `columns × rows` long, row by row. IntGrid layers hold their values (0 is empty).
- **`entities`:** per Entities layer, every entity: its type (`id`), a stable instance id (`iid`), its position (the pivot) in pixels and the cell containing it, its box, and its field values by field identifier.
- **`fields`:** the level's own field values, when the project defines level fields.

Field values:

| Field type       | In JSON                                                                 |
| ---------------- | ----------------------------------------------------------------------- |
| Int, Float       | a number                                                                |
| Bool             | `true` or `false`                                                       |
| String, Color    | a string (`#rrggbb` for colours)                                        |
| Enum             | the value's name                                                        |
| Point            | a cell, `{ "x": 3, "y": 7 }`                                            |
| EntityRef        | `{ "iid": "…", "level": "level_2" }`, or `null` when the target is gone |
| List of any type | an array of these (missing references are left out)                     |

### Extra blocks

They appear only when the level uses the feature:

- **`tileLayers`:** for each Tiles layer, its `tileset` identifier, `tileSize`, the tileset's `columns`, the `image` name, and `autoSource` (the IntGrid layer an auto-layer is generated from). Tiles cells hold `tileId + 1` (0 is empty), with flip flags in bit 29 (flip X) and bit 30 (flip Y). The tile id counts across the tileset's rows, left to right.
- **`layerGrids`:** layers with their own grid size: `gridSize`, `columns` and `rows`. Their arrays use that grid instead of the level's.
- **`tileStacks`:** cells where auto-layer rules stacked several tiles or offset one: per layer, the cell index and its tiles bottom first, each with its offset (`dx`, `dy`) in pixels. The layer array keeps the top tile.

```js
// Reading a tile cell.
const value = level.layers.ground[y * level.metadata.columns + x];
if (value !== 0) {
  const flipX = (value & (1 << 29)) !== 0;
  const flipY = (value & (1 << 30)) !== 0;
  const tileId = (value & ~((1 << 29) | (1 << 30))) - 1;
}
```

## Game Studio 2D

**Export (Game Studio 2D)** writes a ZIP for games that read Game Studio 2D's contracts (see [Asset contracts](https://github.com/g-t-georgiev/foundry2d/blob/dev/docs/contracts.md)):

- **`name.level.json`** (`kind: "level"`): `tileSize`, `columns`, `rows`, `background`, and
  - `grids`: each IntGrid layer with `values`, its value names (`{ "wall": 1 }`), and `cells`, row by row. A game reads cells by name, so renumbering values never breaks it; cells with a value that has no name are written as 0.
  - `tiles`: each Tiles layer with its tileset's id as `sheet`, `tileNames` (`tile_0`, `tile_1`… by tile id) and `cells` (tile id + 1, flips in bits 29 and 30, as above). Auto-layers keep the top tile of each cell.
  - `entities`: one list, each with `type`, `id`, `layer`, its pivot position `x`, `y`, `width`, `height`, `pivot` and `fields`. References are `{ "entity", "level" }`.
  - `fields`: the level fields.
  - `grid` on a layer with its own cell size: `{ size, columns, rows }`.
- **`tileset.sheet.json`** and the tileset's image for every tileset used: a sprite sheet with a sprite per tile, named as in `tileNames`.

## CSV

**Export (CSV)** writes one file per layer, zipped when there are several. Grid layers are a row of comma-separated cells per line, like Tiled's CSV layers. Entity layers have a header row (`id`, `iid`, `x`, `y`, `cx`, `cy`, `left`, `top`, `width`, `height`, then one column per field) and a row per entity; references are written as their iid, and list entries are joined with `|`.

## PNG

**Export (PNG)** and **Export layer (PNG)** render at one image pixel per level pixel, on a transparent background: tiles, IntGrid colours and entity shapes, without editor labels or grids.
