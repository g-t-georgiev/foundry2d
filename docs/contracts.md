# Asset contracts (draft, roadmap 12.1)

A game connects to Game Studio 2D through **asset contracts**: small, versioned JSON files the tools write into the game, and the game reads without the studio. They follow the pilot game's `SoundAsset`: every file has `version`, `kind`, `id` and `name`, is plain data, and comes with a validator that lists every problem (`@gs2d/contracts`).

Status: **draft for review** with the pilot game and Sound DSP Studio; the sound contract and the split of sheets and animations are decided. The tools write them (see [The exporters](#the-exporters)); writing into a game's folder follows with `gs2d.json` support (12.2, 12.3).

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
      "values": { "wall": 1, "gate": 2, "enemy_house": 3, "tunnel": 4, "no_up": 5 },
      "cells": []
    },
    "collectibles": { "values": { "dot": 1, "energizer": 2 }, "cells": [] }
  },
  "entities": [
    {
      "type": "Enemy",
      "id": "g1",
      "layer": "entities",
      "x": 108,
      "y": 116,
      "width": 16,
      "height": 16,
      "fields": { "name": "BLINKY", "inHouse": false, "dir": "left" }
    }
  ],
  "fields": { "music": "maze" }
}
```

- The difference from Levels' game JSON today: each grid names its values (`values`), so a game reads cells by name (`cellName`) and renumbering in the editor never breaks it.
- Tile layers name their sprite sheet and its tile sprites (`tiles`), cells hold tile id + 1 with flip flags (bits 29 and 30), as now.

## The exporters

- **Pixel and Packer:** the **Game Studio 2D** data format writes `name.sheet.json` and, when there are animations, `name.animation.json` (Packer's animations; Pixel's frames as one clip). Packer reads `.sheet.json` back when unpacking. In `@gs2d/formats` (`gs2d.ts`), so both tools share it.
- **Levels:** **Export (Game Studio 2D)** writes a ZIP with `name.level.json` and, for each tileset its tile layers use, `tileset.sheet.json` (a sprite per tile, `tile_<id>`) and the tileset image. Number lists (cells) are on one line each. In `apps/levels/src/io/contractFormat.ts`.
- **Not in the contract yet:** auto-layer tile stacks (a cell keeps its top tile); they can come as an optional field within version 1.
- **Checked:** the tests validate every file the exporters write against the contracts, and read sheets back.

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

## The pilot game's names (agreed 2026-11-28)

The pilot (Pac-Man, now titled "Arcade Maze Lab": the player and the enemies) reads the `spritesheet`, `animation` and `level` contracts, copied from `@gs2d/contracts` for now. It loads assets through one `replace(asset)` entry, which takes a validated contract object (and a sheet's image), so the channel for live updates (12.4) stays open.

**Level** (the Levels preset follows it): `tileSize` 8, 28 × 36 cells (rows 0–2 and 34–35 are HUD rows).

- `collision` grid: `wall`, `gate`, `enemy_house`, `tunnel`, `no_up`. Intersections are derived by the game.
- `collectibles` grid: `dot`, `energizer`.
- Entities: `Player` (1, `dir`), `Enemy` (4, `name` BLINKY, PINKY, INKY or CLYDE, `inHouse`, `dir`), `Fruit` (1) and `ScatterTarget` (4, `name` of its enemy, a cell on or outside the maze's edge). An entity's `x`, `y` is its pivot, so a spawn between two tiles (the game's `seamPx`) is exact.

**Animation clips**, drawn with pivot 0.5, 0.5 unless the sheet says otherwise; `frames` at `fpsBasis` 60.606 or `ms`:

| Clips                                                                                     | Playback | Notes                                                                    |
| ----------------------------------------------------------------------------------------- | -------- | ------------------------------------------------------------------------ |
| `player.move.left`, `.right`, `.up`, `.down`                                              | loop     | 4 frames; stepped by distance moved (durations ignored); frame 0 at rest |
| `player.death`                                                                            | once     | about 11 frames                                                          |
| `player.giant.move.right`                                                                 | loop     | the intermission's giant; falls back to `player.move.right` at 2×        |
| `enemy.<NAME>.move.<dir>` (BLINKY, PINKY, INKY, CLYDE × left, right, up, down)            | loop     | 2 frames, eyes looking that way                                          |
| `enemy.frightened`, `enemy.frightened.flash`                                              | loop     | 2 frames each, alternated near the end of frightened time                |
| `enemy.eyes.<dir>`                                                                        | –        | 1 frame each                                                             |
| `fruit.Cherry`, `.Strawberry`, `.Peach`, `.Apple`, `.Melon`, `.Galaxian`, `.Bell`, `.Key` | –        | 1 frame each, also in the HUD                                            |
| `life`                                                                                    | –        | 1 frame; falls back to a `player.move.left` frame                        |
| `score.200`, `.400`, `.800`, `.1600`; `score.100` … `score.5000` (fruit)                  | –        | optional; the game falls back to text                                    |

Later, optional: maze wall tiles, `dot`, `energizer`. The game draws its actors in code today; until a sheet is supplied, a default skin baked from those drawings keeps its look.

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
