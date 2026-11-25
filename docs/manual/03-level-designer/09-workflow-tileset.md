# Workflow: a sprite as a tileset

Draw tiles in the pixel editor, then paint a level with them. When you change a tile, re-import it and the level updates.

## 1. Draw the tiles

1. In the pixel editor, start a **16 × 16** sprite (the tile size you want).
2. Draw one tile per **frame**: frame 1 grass, frame 2 dirt, frame 3 stone, and so on. **Shift+N** adds a frame, **Shift+D** copies one to make a variant.
3. Save it as `tiles.f2dsprite` (Ctrl+Shift+S).

## 2. Import it

1. In the level designer, open **Project settings** → **Tilesets** → **Import…** and pick `tiles.f2dsprite`.
2. The frames are laid side by side; each square frame is one tile. Check **Tile size** says 16.
3. Set the project's grid to 16 (Project settings → Layers → **Grid size**), or give the Tiles layer its own 16 px grid.

## 3. Paint

1. In **Layers**, click **+** → **Tiles**. The new layer uses the first tileset; choose another in its definition if you have several.
2. Click a tile in the picker on the right and paint with the pen. Drag over several tiles to paint them as a block; **X** and **Y** flip.

## 4. Change a tile

1. Edit the sprite in the pixel editor and save.
2. In the level designer, select the tileset in Project settings → Tilesets and click **Re-import…**, picking the sprite again.

Every painted tile shows the new picture; placements are kept. Adding frames at the end adds tiles without moving the others.

To have the tiles placed for you from painted terrain, make the Tiles layer an [auto-layer](05-auto-layers.md).
