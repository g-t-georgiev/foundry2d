# Workflow: draw a sprite and export a spritesheet

This walks through a four-frame coin that spins, exported for Phaser.

## 1. Start a sprite

1. Press **Ctrl+O** and pick **16 × 16** under **New**.
2. Type `coin` in the name field at the top left.

## 2. Draw the first frame

1. Pick a yellow in the swatch under **Color**, then a darker shade, and click **+** after each to keep both in the palette.
2. Draw a circle with the **Ellipse** tool (C), holding **Shift** for a filled one.
3. With the **Pen** (B), add a darker rim and a light spot. Zoom with the wheel; **F** fits the sprite again.

## 3. Add frames

1. Press **Shift+D** to duplicate the frame.
2. In the new frame, make the coin narrower: select it with **M**, then drag the left and right handles inward. Touch up the edge with the pen.
3. Duplicate again for an even narrower, edge-on coin. For the second half of the turn, click frame 2, press **Shift+D**, and move the copy to the end with **▶**.
4. Tick **Onion skin** to compare a frame with its neighbours.

## 4. Check the animation

Watch the **Preview** panel. Set **FPS** to 8, or give one frame a longer **Duration** (for example 200 ms for the face-on frame).

## 5. Save

Press **Ctrl+Shift+S** and save `coin.f2dsprite`. Later, **Ctrl+S** saves to the same file.

## 6. Export the spritesheet

1. Press **Ctrl+E** and open the **Spritesheet** tab.
2. **Layout:** Horizontal strip. **Padding:** 1. **Data:** TexturePacker JSON (Hash). **Download as:** One ZIP.
3. The line above the buttons shows the sheet's size and frame count. Click **Export**: the ZIP holds `coin.png` and `coin.json`.

In Phaser, load it with `this.load.atlas("coin", "coin.png", "coin.json")`; the frame names and durations are in the JSON, and `meta.frameTags` describes the animation.
