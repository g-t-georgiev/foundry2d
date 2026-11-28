# Adding sprites

## Images and folders

- **+ Images** adds image files: PNG, WebP, JPEG, GIF or BMP. Their names, without the extension, become the sprite names.
- **+ Folder** adds every image in a folder and its subfolders. Names keep the folder path, such as `player/walk_1`, which engines read as frame names.
- **Drag and drop** images or folders anywhere onto the window.

The list is sorted with numbers in order (`walk_2` before `walk_10`). Adding a file whose sprite already exists **updates** that sprite, keeping its pivot. Files that can't be read are named in the status bar.

## Pixel sprites

A `.gs2dsprite` file comes in frame by frame: a one-frame sprite becomes one sprite, a sprite with frames becomes `name_0`, `name_1`… with all visible layers flattened. They are then an animation (see [Animations and pivots](04-animations-and-pivots.md)).

## Unpacking existing sheets

Add a sheet **together with its data file** (select both, or drop both) and it is cut back into its sprites: trimmed borders are restored and rotated sprites turned upright, pixel for pixel. This reads:

- Game Studio 2D sheets (`.sheet.json`),
- TexturePacker JSON (Hash, Array and Phaser's multi-atlas),
- Starling/Sparrow XML,
- LibGDX `.atlas` files.

The image is found by the name the data gives it, or by the data file's own name. If it's missing, the status bar says which image to add.

## Live folders

**Live folder** (Chrome and Edge) watches a folder: its images and sprites are added, and kept up to date as you save them in other programs, rename or delete them. Each change is one undo step.

- The watched folders are listed under the buttons; **✕** stops watching one, and its sprites stay.
- Watching ends when you open another pack, and when the folder can't be read any more (moved or deleted).
- The folder is checked every second and a half while the page is visible.

## The sprite list

- **Click** selects; **Ctrl+click** adds or removes one, **Shift+click** selects a range, and **Ctrl+A** selects all. Clicking a sprite on the sheet selects it too (Shift or Ctrl adds), and identical sprites are picked together.
- **↑** and **↓** move through the list. **F2** or a double-click renames; **Delete** removes.
- **Search** filters by name.
