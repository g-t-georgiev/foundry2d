# Animations and pivots

## Animations

Sprites whose names differ only in a number at the end form an **animation**: `walk_1`, `walk_2`… (also `walk (1)`, `walk-1` or `run/0`). With **Numbered sprites are animations** ticked:

- their frames are packed next to each other, in number order;
- the data lists them as an animation where the format can (frame tags, and PixiJS `animations`; Godot SpriteFrames get one animation each, plus single-frame ones for every other sprite);
- the **Animation** panel plays them at **Frames per second**. Pick the animation in its list; **Pause** stops it.

An animation that ends up spread over several sheets can't be described by the data formats; the panel names it, and it is left out of the data. Raise the maximum sheet size to keep it on one sheet.

## Pivots

A **pivot** is the point of a sprite that engines place at its position and rotate around: the feet of a character, the centre of a coin.

1. Select one or more sprites.
2. Under **Selected**, pick **Pivot**: Engine default, Centre, Bottom centre, Top left, Bottom left, or **Custom** with **x** and **y** (0 is the left or top edge, 1 the right or bottom; values outside place the pivot outside the sprite).

The pivot shows as a cross on the sheet, and the animation preview lines up frames by their pivots, as an engine would. Pivots stay through re-imports and renames.

Pivots are written to TexturePacker JSON (as `anchor`, which Phaser and PixiJS read) and Starling XML (`pivotX`, `pivotY`). The other formats have no place for them, and the app says so under the pivot settings.
