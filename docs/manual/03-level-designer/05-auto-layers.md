# Auto-layers

An **auto-layer** is a Tiles layer that is generated from an IntGrid layer by **rules**. You paint "ground" as values, and the rules place grass on top, edges on the sides and dirt inside. The Platformer preset shows it working.

## Making one

In Project settings → Layers, select a Tiles layer and choose its source in **Auto-tiling: generate from IntGrid layer**. Then click **Edit rules…** (in the right sidebar when the layer is active).

The layer is then locked: it follows its source, regenerated whenever the source changes (painting, undo, resizing). Generated tiles are never undo steps of their own; undoing the source edit brings them back with it. Removing the source turns the layer back into a hand-painted one that keeps its tiles.

## Rules

A rule looks at a cell and its neighbours, and when they match its pattern, places a tile. Rules are checked from the top; the first one that matches wins, unless it lets later ones stack on top.

The **Rules** dialog has the list on the left and the selected rule on the right:

- **+ Rule** adds a rule that tiles every cell holding the chosen value. **+ Group** adds a named group whose rules can be switched off together. **Reshuffle** makes new random choices.
- Each rule can be switched off, moved, duplicated and deleted.

A rule has:

- **Pattern:** 1 × 1, 3 × 3 or 5 × 5 cells. Paint it with a value brush: **click** for "must be this value", **right-click** for "must not be". Other choices are "any value", "empty" and "anything".
- **Tiles:** picked from the tileset; drag to pick several, and one is chosen per cell at random (stable between runs). Picking a tile twice makes it twice as likely.
- **Chance:** the probability that a matching cell gets the tile, for scattering details like flowers.
- **Mirror X** and **Mirror Y:** also match the mirrored pattern and flip the tile, so one corner rule covers all four corners.
- **Stop here:** on by default. Switch it off to let later rules add more tiles to the same cell (the first rule's tile is drawn on top).
- **Past the level edge, cells read as:** the edge cell (the default, so ground touching the border doesn't grow an edge there), empty, a chosen value, or "the rule fails".
- **Tile offset (px):** draws the tile shifted, for details that overhang.

Every change regenerates the level behind the dialog straight away, so you can watch the result.
