# Drawing tools

Pick a tool in the tools column or with its key. Tools draw on the **active layer** of the current frame, and refuse to draw on a hidden or locked layer: the cursor shows a no-entry sign and the status bar says why.

| Tool                                  | Key         | What it does                                                                 |
| ------------------------------------- | ----------- | ---------------------------------------------------------------------------- |
| **Pen**                               | B or P      | Paints pixels in the current colour. Drag for a line of pixels without gaps. |
| **Eraser**                            | E           | Makes pixels transparent.                                                    |
| **Paint bucket**                      | G           | Fills the connected area of the same colour.                                 |
| **Colour picker**                     | I, hold Alt | Takes the colour under the pointer as the current colour.                    |
| **Line**                              | L           | Drag from one end to the other; the line previews until you let go.          |
| **Rectangle**                         | R           | Drag a rectangle outline; hold **Shift** for a filled one.                   |
| **Ellipse**                           | C           | Drag an ellipse inside the box you draw; hold **Shift** for a filled one.    |
| **Select**, **Lasso**, **Magic wand** | M, Q, W     | See [Selections](03-selections.md).                                          |

Holding **Alt** turns any drawing tool into the colour picker until you let go (not with the selection tools, where Alt subtracts).

## Pen size

**Pen size** sets the pen and eraser to 1 to 4 pixels; **[** and **]** go smaller and bigger, up to 32. The cursor shows the pen's footprint.

## Mirror drawing

**⇆** (Shift+X) and **⇅** (Shift+Y) mirror pen and eraser strokes across the sprite's vertical and horizontal centre lines, shown as dashed guides labelled X and Y. Use both for four-way symmetry, handy for faces, items and tiles.

## Clear layer

**Clear layer** (or **Delete** with nothing selected) empties the active layer in the current frame. Like everything else, it can be undone.
