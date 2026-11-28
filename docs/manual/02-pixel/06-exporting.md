# Exporting

**Export…** (Ctrl+E) opens the export dialog. Its three tabs share two settings at the top:

- **Scale:** 1× to 32×, enlarging every pixel to a block (no blurring).
- **Pixels:** **All visible layers** (as in preview mode) or **Active layer only**.

The line at the bottom of the dialog says what the export will produce (size and number of files) before you click **Export**. Exports are composited by the app itself, so their pixels are exact.

## Image

| Setting                      | Choices                                                                                                              |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| **Format**                   | PNG, WebP (lossless or lossy, with **Quality**), JPEG (with a **Background** colour for transparency), BMP (32-bit). |
| **Frames**                   | **Current frame**, or **All frames (ZIP)**: one image per frame in a ZIP.                                            |
| **Trim transparent borders** | Cuts empty rows and columns from the edges.                                                                          |
| **File name**                | A pattern with placeholders: `{name}` (the sprite's name), `{frame}` (its number), `{w}` and `{h}` (the size).       |

## Spritesheet

All frames on one image, plus data that tells a game engine where each frame is.

- **Layout:** **Horizontal strip**, **Vertical strip**, **Grid** (with **Columns**, or automatic), or **Packed**, which fits trimmed frames as tightly as possible.
- **Padding:** empty pixels between frames. **Extrude:** repeats each frame's edge pixels outward, which stops neighbouring frames bleeding in when an engine scales or filters the sheet.
- **Trim frames:** stores each frame without its empty border; the data keeps the original size and offset, so engines draw it in the right place.
- **Data:** Game Studio 2D (a sheet and an animation file, for games with a `gs2d.json`), TexturePacker JSON (Hash or Array) for Phaser and PixiJS, Starling/Sparrow XML, Godot SpriteFrames (`.tres`), a LibGDX atlas, CSS sprites, or **Image only**. Each frame's duration goes into the data where the format has a place for it. See [Spritesheet data](../05-file-formats/03-spritesheet-data.md).
- **Download as:** one ZIP, or separate files.

## GIF

An animated GIF of all frames, each shown for its duration.

- **Loop forever**, or play once.
- GIF allows 255 colours plus fully transparent pixels. Up to that, colours are exact. Above it, the app picks a palette that covers the sprite's colours; **Dither** smooths gradients then, by mixing neighbouring colours. Half-transparent pixels become either opaque or transparent.

For packing many sprites into one sheet, use the [Packer](../04-packer/01-tour.md).
