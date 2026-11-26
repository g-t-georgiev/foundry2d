# Packing settings

The settings are saved with the pack, and every change repacks straight away.

## Layout

- **Algorithm:**
  - **MaxRects (tightest):** finds the best free spot for each sprite. With **Fit** you choose what "best" means: best short side (the default), best long side, best area, or bottom left. Try them when a sheet is just too big.
  - **Shelves:** rows of sprites, simple and predictable.
  - **Grid:** equal cells, with **Columns** (0 picks them). Good for tile sheets and fonts.
  - **One row** and **One column:** strips.
- **Allow 90° rotation:** sprites may be stored turned, to fit tighter (MaxRects and Shelves). Engines turn them back when drawing. The data format must be able to describe it; where it can't, the checkbox is disabled with the reason, and your choice comes back with a format that can.

## Sprites

- **Trim transparent edges:** stores each sprite without its empty border. The data keeps its original size and offset, so engines draw it in the same place.
- **Store identical sprites once:** sprites with the same pixels share one place on the sheet (the **Result** counts them).
- **Extrude (px):** repeats each sprite's edge pixels outward. Engines that filter or scale textures otherwise blend in the neighbour's pixels at the edges.

## Sheet

- **Padding (px):** empty pixels between sprites. **Border (px):** around the sheet's edge.
- **Max width** and **Max height:** what doesn't fit goes onto more sheets.
- **Power-of-two size:** 64, 128, 256…, which older GPUs and some engines need. **Square:** equal sides.

## The result

**Result** shows each sheet's size, how much of it is filled, and how many sprites were shared. If packing fails (for example a sprite bigger than the maximum size), the reason shows over the sheets.

## Data

- **Format:** which data file to write. The hint under it names the engines that read it. See [Spritesheet data](../05-file-formats/03-spritesheet-data.md).
- **Numbered sprites are animations** and **Frames per second:** see [Animations and pivots](04-animations-and-pivots.md).

## Images

- **Format:** PNG, or lossless WebP (smaller files; every pixel kept exactly).
- **Scales:** 1× to 4×. Each ticked scale writes its own sheets and data, named `name@2x` and so on. At least one stays ticked.
- **Premultiplied alpha:** multiplies colours by their transparency, for engines that blend that way. Most expect it off.
