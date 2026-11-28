# Exporting and importing

The work file (`.gs2dlevel`) keeps the whole project for editing. A game reads **exports**: only the data it needs. The **Export** split button exports the open level (in the world view, the selected one); the arrow picks the format, and the choice is remembered. **Ctrl+E** runs the shown one.

| Export                      | Gives                                                                                                                                                                                                 |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Export (JSON)**           | Game data for the level: a flat array per IntGrid and Tiles layer, the entities with their fields, level fields and background.                                                                       |
| **Export (Game Studio 2D)** | A ZIP with the level as Game Studio 2D's level contract (`.level.json`: grids that name their values, tile layers, entities, level fields) and each tileset it uses as a sprite sheet with its image. |
| **Export (CSV)**            | One CSV file per layer (a row of cells per line, like Tiled's CSV layers), zipped when there are several. Entities get a header row and a column per field.                                           |
| **Export (PNG)**            | A picture of the level's visible layers at full size (one cell = grid-size pixels), with tiles, value colours and entity shapes, on a transparent background.                                         |
| **Export layer (PNG)**      | The same for the active layer only.                                                                                                                                                                   |
| **Copy layer as array**     | The active layer's cells as a number array, a row per line, on the clipboard, to paste into code (Ctrl+Shift+C).                                                                                      |

The JSON shape is described in [Level exports](../05-file-formats/02-level-exports.md).

## Importing game JSON

**⤓** above the Levels list imports a level from game JSON into the open project, as one undo step. It is matched by name: grid and tile layers by layer identifier, entities by type onto the Entities layer of the same name, fields by field name. Auto-layers are regenerated. What doesn't match is skipped and listed in the status bar.

Opening a game JSON file on its own (Open file…) rebuilds a project from it: layers, entity types with fields guessed from the values, level fields and background. Tile layers come back without their tileset image, since the export only names it.
