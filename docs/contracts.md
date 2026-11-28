# Asset contracts (draft, roadmap 12.1)

A game connects to Game Studio 2D through **asset contracts**: small, versioned JSON files the tools write into the game, and the game reads without the studio. They follow the pilot game's `SoundAsset`: every file has `version`, `kind`, `id` and `name`, is plain data, and comes with a validator that lists every problem (`@gs2d/contracts`).

Status: **draft for review** with the pilot game and Sound DSP Studio; the sound contract and the split of sheets and animations are decided. Nothing writes these files yet; the tools' exporters follow once the shapes are agreed.

## The kinds

| Kind          | Written by       | What it holds                                                                 |
| ------------- | ---------------- | ----------------------------------------------------------------------------- |
| `spritesheet` | Pixel, Packer    | One image and its named sprites (rectangle, trim, rotation, pivot).           |
| `animation`   | Pixel, Packer    | Named clips over one sheet's sprites, with durations in ms or in frames.      |
| `level`       | Levels           | Value grids with names for their values, tile layers, entities, level fields. |
| `sound`       | Sound (Phase 14) | The `SoundAsset` contract of the game's `SoundEngine`.                        |

### `spritesheet`

```json
{
  "version": 1,
  "kind": "spritesheet",
  "id": "pacman-sprites",
  "name": "Pac-Man sprites",
  "image": "pacman-sprites.png",
  "width": 64,
  "height": 32,
  "scale": 1,
  "frames": {
    "pacman/open": { "x": 0, "y": 0, "w": 16, "h": 16, "pivot": { "x": 0.5, "y": 0.5 } },
    "pacman/closed": {
      "x": 16,
      "y": 0,
      "w": 13,
      "h": 16,
      "source": { "x": 1, "y": 0, "w": 16, "h": 16 }
    }
  }
}
```

- `x, y, w, h`: the sprite on the image, `w` and `h` upright. `rotated: true` means stored turned 90° clockwise.
- `source`: present when transparent edges were trimmed: the untrimmed size and where the stored part sits in it.
- `pivot`: the point placed at the sprite's position, 0..1 of the untrimmed size.
- It's TexturePacker's model with plainer names, so engines that read TexturePacker JSON map it in a few lines; Packer keeps writing the engine formats too.

### `animation`

```json
{
  "version": 1,
  "kind": "animation",
  "id": "pacman-anims",
  "name": "Pac-Man animations",
  "sheet": "pacman-sprites",
  "timing": { "fpsBasis": 60.606 },
  "clips": {
    "chomp": {
      "playback": "pingpong",
      "frames": [
        { "sprite": "pacman/open", "frames": 4 },
        { "sprite": "pacman/closed", "frames": 4 }
      ]
    },
    "death": { "playback": "once", "frames": [{ "sprite": "pacman/death-1", "ms": 120 }] }
  }
}
```

- Durations are `ms`, or `frames` of `timing.fpsBasis` for games stepping in fixed frames (the pilot's arcade rate), the same idea as `SoundAsset.timing`.
- `playback`: `loop` (default), `once` or `pingpong`.

### `level`

```json
{
  "version": 1,
  "kind": "level",
  "id": "maze-1",
  "name": "Maze 1",
  "tileSize": 8,
  "columns": 28,
  "rows": 36,
  "background": "#000000",
  "grids": {
    "collision": {
      "values": { "wall": 1, "gate": 2, "ghost_house": 3, "tunnel": 4, "no_up": 5 },
      "cells": []
    },
    "collectibles": { "values": { "dot": 1, "energizer": 2 }, "cells": [] }
  },
  "entities": [
    {
      "type": "Ghost",
      "id": "g1",
      "layer": "entities",
      "x": 108,
      "y": 116,
      "width": 16,
      "height": 16,
      "fields": { "kind": "blinky", "scatterTarget": { "x": 25, "y": 0 } }
    }
  ],
  "fields": { "music": "maze" }
}
```

- The difference from Levels' game JSON today: each grid names its values (`values`), so a game reads cells by name (`cellName`) and renumbering in the editor never breaks it.
- Tile layers name their sprite sheet and its tile sprites (`tiles`), cells hold tile id + 1 with flip flags (bits 29 and 30), as now.

## The manifest (draft, roadmap 12.2)

`gs2d.json` at the root of a game's folder tells the studio what the game reads and where it goes:

```json
{
  "version": 1,
  "game": "Pac-Man",
  "contracts": {
    "spritesheet": 1,
    "animation": 1,
    "level": 1,
    "sound": { "version": 1, "features": [] }
  },
  "assets": {
    "spritesheet": "public/assets/sprites",
    "animation": "public/assets/sprites",
    "level": "public/assets/levels",
    "sound": "src/audio/sounds"
  },
  "workFiles": "art"
}
```

- `contracts`: the kinds and versions the game reads; the studio writes nothing else.
- `assets`: where each kind is written, relative to the game's folder.
- `workFiles`: where the tools keep their work files (`.gs2dsprite`…) in the game's repository.

## Pac-Man notes

- **Mazes:** today a string grid (`mazes.ts`) with tile types `WALL`, `DOT`, `ENERGIZER`, `GATE`, `GHOST_HOUSE`, `TUNNEL`, `NO_UP_ZONE`. Through the level contract they become a `collision` grid (`wall`, `gate`, `ghost_house`, `tunnel`, `no_up`) and a `collectibles` grid (`dot`, `energizer`). The Pac-Man preset in Levels has `intersection_a/b` values the game derives itself (`deriveIntersections`) and lacks `ghost_house` and `no_up`; the preset should follow the game.
- **Spawns:** Pac-Man, ghost and fruit spawns are entities; the game's seat between two tiles (`seamPx`) is the entity's pivot position.
- **Sprites:** the game draws its actors in code today; sprites and an animation system are game-side work, which the `spritesheet` and `animation` contracts are shaped for.

## The sound contract (decided 2026-11-28)

`sound` is **Sound DSP Studio's `SoundAsset`**, a superset of the pilot game's, now kept in `@gs2d/contracts` (`sound.ts`, copied without the playback parts). Its files keep their own `kind`: `sequence` or `loop`.

- **Optional features:** `harmonicWaves`, per-event `envelope` and noise tracks (`kind: "noise"`). A game lists the ones its engine plays in `gs2d.json` (`"sound": { "version": 1, "features": ["envelope"] }`); `soundProblems` tells a tool before it writes a sound the game can't play. The validator refuses unknown keys, so nothing is silently ignored.
- **Changes:** within version 1 the contract only gains optional fields; a change that breaks existing files is version 2, and a game keeps reading the versions it declares.
- **Checked:** all 15 sounds the pilot game ships pass the contract, and use none of the optional features.
- **The copies:** the game and Sound DSP Studio keep their copies (and their hand-written `sound-asset.schema.json`, which describes neither addition) until they can use the package; they then follow this contract rather than each other.

## JSON schemas

`packages/contracts/schemas/` holds a schema per contract (`spritesheet`, `animation`, `level`, `sound`) and one for `gs2d.json`, **generated from the TypeScript types** by `vp run docs`, so they can't drift from them. A test fails when the files fall behind, and checks that the schemas accept the same real files as the validators (Ajv).

## Sheets and animations: two files (decided 2026-11-28)

A `spritesheet` and its `animation` files are separate. An animation names its sheet by `id`, so:

- several animation files can share one sheet (a character's moves, its cutscenes, its UI icons), and a large game splits clips per character or per scene without touching the image;
- a sheet can be repacked (new layout, trim, rotation) without rewriting any animation, since clips refer to sprite names, not rectangles;
- an animation can later gain richer data (events, per-frame offsets, layered clips) as optional fields of its own contract without changing the sheet's.

A small game simply writes one of each.
