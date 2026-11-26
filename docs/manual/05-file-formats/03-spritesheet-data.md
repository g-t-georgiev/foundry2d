# Spritesheet data

Pixel's spritesheet export and Packer write the same data formats. All describe where each frame (sprite) is on the sheet; they differ in what else they can say.

| Format                     | File     | Read by                                                     | Rotation              | Pivots | Animations               |
| -------------------------- | -------- | ----------------------------------------------------------- | --------------------- | ------ | ------------------------ |
| TexturePacker JSON (Hash)  | `.json`  | Phaser, PixiJS, Aseprite-style tools                        | 90° clockwise         | yes    | frame tags, `animations` |
| TexturePacker JSON (Array) | `.json`  | Phaser, PixiJS                                              | 90° clockwise         | yes    | frame tags, `animations` |
| Starling / Sparrow XML     | `.xml`   | Starling, HaxeFlixel, Phaser (`atlasXML`, without rotation) | 90° clockwise         | yes    | no                       |
| Godot SpriteFrames         | `.tres`  | Godot 4 (`AnimatedSprite2D`)                                | no                    | no     | yes                      |
| LibGDX atlas               | `.atlas` | LibGDX `TextureAtlas`                                       | 90° counter-clockwise | no     | no                       |
| CSS sprites                | `.css`   | web pages                                                   | no                    | no     | no                       |

Rotation only happens when you allow it in Packer, and only with formats that can describe it.

## The common model

Every format is written from the same frame data, with TexturePacker's names:

- **`frame`:** the sprite's rectangle on the sheet (`x`, `y`, and its upright width and height).
- **`rotated`:** stored turned by 90°; on the sheet it then covers height × width.
- **`trimmed`**, **`spriteSourceSize`:** where the stored, trimmed rectangle sits inside the original image.
- **`sourceSize`:** the original image's size.
- **`duration`:** milliseconds (animations).
- **`pivot`:** 0 to 1 from the top-left of the original image.

## TexturePacker JSON

```json
{
  "frames": {
    "walk_1.png": {
      "frame": { "x": 2, "y": 2, "w": 14, "h": 22 },
      "rotated": false,
      "trimmed": true,
      "spriteSourceSize": { "x": 1, "y": 2, "w": 14, "h": 22 },
      "sourceSize": { "w": 16, "h": 24 },
      "duration": 100,
      "anchor": { "x": 0.5, "y": 1 }
    }
  },
  "animations": { "walk": ["walk_1.png", "walk_2.png"] },
  "meta": {
    "image": "hero.png",
    "size": { "w": 64, "h": 32 },
    "scale": "1",
    "frameTags": [{ "name": "walk", "from": 0, "to": 1, "direction": "forward" }]
  }
}
```

The Array variant lists the frames in an array, each with a `filename`. `anchor` is the pivot (Phaser and PixiJS read it). In `meta.frameTags`, `from` and `to` are positions in the frame list.

## Starling / Sparrow XML

```xml
<TextureAtlas imagePath="hero.png">
  <SubTexture name="walk_1" x="2" y="2" width="14" height="22" frameX="-1" frameY="-2" frameWidth="16" frameHeight="24" pivotX="8" pivotY="24"/>
</TextureAtlas>
```

`frameX` and `frameY` are the negative offset of the trimmed rectangle. A rotated sprite has `rotated="true"` and its `width` and `height` as stored on the sheet (swapped). Pivots are in pixels of the original image.

## Godot SpriteFrames

A `SpriteFrames` resource with an `AtlasTexture` per frame (`region` on the sheet, `margin` for trimmed borders) and an animation per animation, at the speed of the shortest frame; longer frames get a relative duration. Without animations, all frames form one called `default`. The sheet image is referenced as `res://` plus its file name, so keep both files together in the project.

## LibGDX atlas

```
hero.png
size: 64, 32
format: RGBA8888
filter: Nearest, Nearest
repeat: none
walk_1
  rotate: false
  xy: 2, 2
  size: 14, 22
  orig: 16, 24
  offset: 1, 0
  index: -1
```

`offset` is measured from the bottom-left of the original image, as LibGDX expects. Rotated regions say `rotate: true`; their sizes stay upright.

## CSS sprites

A class for the sheet and one per sprite, with its untrimmed size and background position:

```css
.hero {
  display: inline-block;
  background-image: url("hero.png");
  background-repeat: no-repeat;
  image-rendering: pixelated;
}
.hero.walk_1 {
  width: 16px;
  height: 24px;
  background-position: -1px 0px;
}
```

## Reading sheets back

Packer can unpack TexturePacker JSON (including Phaser's multi-atlas), Starling XML and LibGDX atlases into separate sprites again, rotated and trimmed frames included. See [Adding sprites](../04-packer/02-adding-sprites.md).
