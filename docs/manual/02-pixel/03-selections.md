# Selections, clipboard and transforms

A selection limits what moving, copying, flipping and deleting act on. It belongs to the canvas, not to a layer, so it stays when you switch layer or frame: select, switch layer, copy works as you'd expect.

## The three selection tools

- **Select (M):** drag a rectangle. Drag inside the selection to move its pixels. Eight **handles** sit just outside the corners and edges: drag one to scale the selected pixels (the opposite edge stays put).
- **Lasso (Q):** drag an outline. Pixels whose centre is inside it, or that the outline passes through, are selected.
- **Magic wand (W):** click to select the connected area of the same colour. **Ctrl+click** selects that colour everywhere on the layer.

With any of them, hold **Shift** to add to the selection and **Alt** to subtract from it. A plain click outside deselects.

Moving shows the result live and is one undo step. Transparent pixels never erase what is underneath when you move or paste. To move a lasso or wand selection, switch to the select tool (M) and drag it.

## Select all and deselect

**Ctrl+A** selects the whole sprite; **Ctrl+D** or **Esc** deselects. **Delete** clears the selected pixels (or the whole layer when nothing is selected).

## Clipboard

- **Ctrl+C** copies and **Ctrl+X** cuts the selected pixels of the active layer. They also go to the system clipboard as an image, so you can paste them into other apps.
- **Ctrl+V** pastes at the selection's top-left (or the sprite's), selects the pasted block and switches to the select tool so you can drag it into place. Images copied in other apps paste the same way: fully transparent pixels stay empty, and anything outside the sprite is cut off (the status bar says so).

## Flip and rotate

The **Transform** buttons act on the selected pixels, or on the whole active layer when nothing is selected:

- **⇿ Flip horizontally** (Shift+H)
- **⇳ Flip vertically** (Shift+V)
- **↻ Rotate 90° clockwise** (Shift+R): turns around the selection's centre, swapping its width and height.

The selection's shape turns with the pixels, so a lasso selection stays a lasso selection.
