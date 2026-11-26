# Layers, frames and animation

## Layers

The **Layers** panel lists the layers from top to bottom. The highlighted one is the active layer that tools draw on.

- **Click** a layer to make it active; **double-click** its name to rename it.
- The **eye** hides or shows it; the **lock** stops edits to it (hidden and locked layers can't be drawn on).
- The rail at the top acts on the active layer: **add** a layer above it (or press **N**), **duplicate**, **move up**, **move down**, **delete**, and an **opacity** slider.

Layers are shared by all frames: adding, deleting, reordering or renaming a layer does it in every frame, as one undo step.

## Frames

The **timeline** under the canvas shows a thumbnail per frame. Click one to edit it, or use **,** and **.** for the previous and next frame.

- **+ Frame** (Shift+N) adds an empty frame after the current one; **Duplicate** (Shift+D) copies it.
- **◀** and **▶** move the current frame; **✕** deletes it.
- **Duration** is how long the current frame shows, in milliseconds. Leave it empty to use the sprite's **FPS** (frames per second), which applies to every frame without its own duration.

## Onion skin

Tick **Onion skin** (Alt+O) to see the previous and next frames faintly under the current one, so motion lines up from frame to frame. It is hidden in preview mode.

## The animated preview

The **Preview** panel plays the frames in a loop, each for its duration, at a size that fits the panel. The button next to its title pauses and plays. It updates as you draw.
