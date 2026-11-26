# Work files

Work files keep everything needed to continue editing. They are JSON (the packaged level file is a ZIP), versioned, and opened leniently: newer apps read older versions. Games should read the [exports](02-level-exports.md) instead; work files may change between versions.

| App    | Extension     | MIME type                          | `format`      | Version |
| ------ | ------------- | ---------------------------------- | ------------- | ------- |
| Pixel  | `.gs2dsprite` | `application/vnd.gs2d.sprite+json` | `gs2d.sprite` | 2       |
| Levels | `.gs2dlevel`  | `application/vnd.gs2d.level+json`  | `gs2d.level`  | 3       |
| Packer | `.gs2dpack`   | `application/vnd.gs2d.pack+json`   | `gs2d.pack`   | 1       |

Files from before Game Studio 2D (named Foundry2D then: `.f2dsprite`, `.f2dlevel`, `.f2dpack`, and the even older `.f2d.json` and `.f2dlevel.json`) still open; saving writes the new names. Their `format` ids were `foundry2d.pixel`, `foundry2d.level` and `foundry2d.pack`. Every file can also carry an `editor` block with the view state (camera, tool, open level…); it is restored on open and safe to ignore.

## Cells: run-length encoding

Layer cells are stored row by row, run-length encoded as a flat `[count, value, count, value, …]` array. `[3, 0, 2, 7]` means three cells of 0, then two cells of 7.

## `.gs2dsprite`

```json
{
  "format": "gs2d.sprite",
  "version": 2,
  "name": "coin",
  "fps": 8,
  "palette": ["#ffcc00", "#aa7700"],
  "frames": [
    {
      "duration": null,
      "document": {
        "width": 16,
        "height": 16,
        "emptyValue": 0,
        "activeLayerId": "layer-1",
        "layers": [
          {
            "id": "layer-1",
            "name": "Layer 1",
            "visible": true,
            "locked": false,
            "opacity": 1,
            "data": [256, 0]
          }
        ]
      }
    }
  ]
}
```

- `duration` is the frame's time in milliseconds, or `null` to use `fps`.
- Every frame has the same layers.
- A pixel is a 32-bit number whose bytes, lowest first, are red, green, blue and alpha (`0xAABBGGRR`); 0 is transparent.

## `.gs2dlevel`

The project's definitions (`defs`: layers, tilesets, entities, enums, level fields), its grid size and world layout, and its levels with their layers (one RLE array per layer), entities and field values. Tileset images are embedded as data URLs.

With **Packaged file** (Project settings → Tilesets) the file is a ZIP instead: `project.json` plus the images under `images/`. Apps tell the two apart by the first bytes, so both use the same extension.

## `.gs2dpack`

```json
{
  "format": "gs2d.pack",
  "version": 1,
  "name": "game",
  "settings": { "algorithm": "maxrects", "padding": 2, "dataFormat": "json-hash", "…": "…" },
  "sprites": [
    {
      "name": "player/walk_1",
      "width": 16,
      "height": 24,
      "image": "data:image/png;base64,…",
      "pivot": { "x": 0.5, "y": 1 }
    }
  ]
}
```

Sprites keep their original files as data URLs, so saving never recompresses them. Unknown or missing settings fall back to the defaults.
