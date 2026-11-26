# Exporting sheets

**Export** (Ctrl+E) writes the sheets as they are shown. The arrow next to it chooses:

- **Export (ZIP):** everything in one `name.zip`;
- **Export (separate files):** one download per file.

## What you get

For each sheet and each scale, an image and, unless the format is "none", a data file:

| Case           | Files                                                     |
| -------------- | --------------------------------------------------------- |
| One sheet      | `hero.png`, `hero.json`                                   |
| Several sheets | `hero-0.png`, `hero-0.json`, `hero-1.png`, `hero-1.json`… |
| Several scales | `hero.png`, `hero.json`, `hero@2x.png`, `hero@2x.json`…   |

The name is the pack's name, with characters that trip up file systems or engines replaced by `_`. Each data file names its own image, so an engine loads them as pairs.

## Exactness

PNG sheets keep every pixel exactly, including the colour of nearly transparent pixels (which browsers usually round). WebP sheets do too in Chrome and Edge, where this was checked. Scaled sheets enlarge each pixel to a block, without blurring.

## Loading in an engine

- **Phaser:** `this.load.atlas("hero", "hero.png", "hero.json")`; with several sheets, load each pair the same way.
- **PixiJS:** `await Assets.load("hero.json")` gives a spritesheet with its textures and `animations`.
- **Godot 4:** put `hero.png` and `hero.tres` in the project together; an `AnimatedSprite2D` uses the `.tres` as its SpriteFrames.
- **LibGDX:** `new TextureAtlas(Gdx.files.internal("hero.atlas"))`.
- **Web pages:** link `hero.css` and give elements the classes `hero` and the sprite's name.

More in [Spritesheet data](../05-file-formats/03-spritesheet-data.md).
