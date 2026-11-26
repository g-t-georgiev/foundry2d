# Tilesets and tiles

A **tileset** is an image cut into equal tiles. A Tiles layer paints tiles from one tileset.

## Adding a tileset

Project settings → **Tilesets** → **Import…** takes:

- a **PNG**, WebP or GIF sheet;
- a **Pixel sprite** (`.gs2dsprite`): its frames are laid side by side, and square frames become one tile each. See [A sprite as a tileset](09-workflow-tileset.md).

Select the tileset to set its **Identifier**, **Tile size**, **Spacing** (pixels between tiles) and **Padding** (pixels around the edge), so the grid matches the image.

**Re-import…** replaces the image with an updated file. The tileset keeps its tiles' places, so everything already painted stays and shows the new pictures; if the image size changed, the app says so.

**Packaged file** (under the list) saves the project as a ZIP with the images as separate files, instead of one JSON file with the images inside. Both kinds open the same way.

## Painting tiles

With a Tiles layer active, the right sidebar shows the **tile picker**:

- **Click** a tile to paint it. **Drag** across several tiles to pick a **stamp** that the pen paints as a block.
- **Flip X** and **Flip Y** (keys **X** and **Y**) mirror the tiles you paint.
- The pen, rectangle fill and bucket paint the chosen tile; the eraser removes tiles; **I** or **Alt** picks a tile from the level, with its flips.

When cells get very small on screen, tiles are drawn as their average colour, so large levels stay fast. Zoom in to see them in full.
