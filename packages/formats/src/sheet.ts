/**
 * Spritesheet data formats for game engines (roadmap item 40). Every writer
 * takes the same placement data, so a format is written once and used by the
 * exporter of Pixel and Packer (Phase 9).
 *
 * Placement uses TexturePacker's field names: `frame` is the rectangle in
 * the sheet, `spriteSourceSize` where that rectangle sits inside the
 * untrimmed `sourceSize`.
 */

import { gs2dAnimation, gs2dSheet } from "./gs2d";

/**
 * Which way a format stores rotated sprites: turned 90° clockwise
 * (TexturePacker, Starling) or counter-clockwise (LibGDX).
 */
export type Turn = "cw" | "ccw";

/** One frame's placement in the sheet. */
export interface SheetFrame {
  /** Frame key, e.g. "walk_0.png". */
  filename: string;
  /**
   * The sprite's rectangle on the sheet, with its unrotated width and height.
   * A `rotated` sprite is stored turned by 90° (see `Turn`), covering `h × w`.
   */
  frame: { x: number; y: number; w: number; h: number };
  rotated: boolean;
  trimmed: boolean;
  spriteSourceSize: { x: number; y: number; w: number; h: number };
  sourceSize: { w: number; h: number };
  /** Milliseconds. */
  duration: number;
  /** Pivot inside the untrimmed sprite (0..1 from the top-left), when one was chosen. */
  pivot?: { x: number; y: number };
}

/** A sheet's size and frames: everything a data format needs. */
export interface SheetData {
  width: number;
  height: number;
  frames: readonly SheetFrame[];
  /** Which way rotated frames are turned; clockwise when left out. */
  turn?: Turn;
}

/** A named animation over a frame range (Aseprite's frame tags). */
export interface FrameTag {
  name: string;
  from: number;
  to: number;
  direction: "forward" | "reverse" | "pingpong";
}

export interface SheetWriteOptions {
  /** File name of the sheet image, as referenced from the data. */
  image: string;
  /** Export scale (written where the format has a field for it). */
  scale: number;
  /**
   * Animations over frame ranges. Left out, formats made of animations
   * (Godot) get one with every frame; given, frames outside every tag become
   * single-frame animations there, so no sprite is unreachable.
   */
  frameTags?: readonly FrameTag[];
}

export type SheetFormatId =
  | "gs2d"
  | "json-hash"
  | "json-array"
  | "starling-xml"
  | "godot-tres"
  | "libgdx-atlas"
  | "css";

export interface SheetFormat {
  id: SheetFormatId;
  /** Shown in export dialogs. */
  label: string;
  /** Engines and tools that read it. */
  readers: string;
  /** Data file extension, with the dot. */
  extension: string;
  mime: string;
  /** Which way its readers expect rotated sprites to be turned; `null` when it has none. */
  rotation: Turn | null;
  /** Writes sprite pivots. */
  supportsPivot: boolean;
  write(sheet: SheetData, options: SheetWriteOptions): string;
  /**
   * A second file some formats write beside the data (Game Studio 2D's
   * animations), with its extension; `null` when there's nothing to write.
   */
  companion?: {
    extension: string;
    mime: string;
    write(sheet: SheetData, options: SheetWriteOptions): string | null;
  };
}

/** A data file of an export. */
export interface SheetDataFile {
  name: string;
  text: string;
  mime: string;
}

/** Every data file `format` writes for one sheet, named `base` + the extension. */
export function sheetDataFiles(
  format: SheetFormat,
  base: string,
  sheet: SheetData,
  options: SheetWriteOptions
): SheetDataFile[] {
  const files = [
    { name: `${base}${format.extension}`, text: format.write(sheet, options), mime: format.mime },
  ];
  const companion = format.companion;
  const text = companion?.write(sheet, options);
  if (companion && text) {
    files.push({ name: `${base}${companion.extension}`, text, mime: companion.mime });
  }
  return files;
}

/** Fails loudly on rotated sprites the format can't describe, rather than writing wrong data. */
function checkRotation(format: string, sheet: SheetData, rotation: Turn | null): void {
  if (!sheet.frames.some((f) => f.rotated)) return;
  if (!rotation)
    throw new Error(`${format} can't describe rotated sprites; pack without rotation.`);
  if ((sheet.turn ?? "cw") !== rotation) {
    throw new Error(`${format} needs rotated sprites turned the other way; pack for that format.`);
  }
}

/** Strips the extension: "walk_0.png" → "walk_0". */
const stem = (name: string) => name.replace(/\.[^./]+$/, "");

const round = (n: number) => Math.round(n * 1000) / 1000;

const xmlEscape = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** CSS identifiers: letters, digits, `-` and `_`, not starting with a digit. */
const cssName = (text: string) => {
  const clean = text.replace(/[^A-Za-z0-9_-]+/g, "-");
  return /^[0-9]/.test(clean) ? `_${clean}` : clean;
};

// ------------------------------------------------------------------ TexturePacker JSON

function texturePacker(format: "hash" | "array") {
  return (sheet: SheetData, options: SheetWriteOptions): string => {
    checkRotation("TexturePacker JSON", sheet, "cw");
    const meta = {
      app: "https://github.com/g-t-georgiev/foundry2d",
      version: "1.0",
      image: options.image,
      format: "RGBA8888",
      size: { w: sheet.width, h: sheet.height },
      scale: String(options.scale),
      frameTags: options.frameTags ?? [],
    };
    // PixiJS and Phaser read a sprite's pivot as `anchor`; PixiJS reads `animations`.
    const entries = sheet.frames.map(({ pivot, ...frame }) =>
      pivot ? { ...frame, anchor: pivot } : frame
    );
    const tags = options.frameTags ?? [];
    const animations = tags.length
      ? {
          animations: Object.fromEntries(
            tags.map((t) => [t.name, sheet.frames.slice(t.from, t.to + 1).map((f) => f.filename)])
          ),
        }
      : {};
    if (format === "array")
      return JSON.stringify({ frames: entries, ...animations, meta }, null, 2);
    const frames = Object.fromEntries(entries.map(({ filename, ...rest }) => [filename, rest]));
    return JSON.stringify({ frames, ...animations, meta }, null, 2);
  };
}

/** TexturePacker JSON as an object (for callers that embed it, and tests). */
export function texturePackerJson(
  sheet: SheetData,
  options: SheetWriteOptions & { format: "json-hash" | "json-array" }
): unknown {
  return JSON.parse(
    texturePacker(options.format === "json-array" ? "array" : "hash")(sheet, options)
  );
}

// ------------------------------------------------------------------ Starling / Sparrow XML

/**
 * Sparrow/Starling `TextureAtlas` XML. Trimmed frames carry `frameX/Y`
 * (negative offset of the trimmed rect) and the untrimmed `frameWidth/Height`.
 * `width` and `height` are the size on the sheet, so a rotated sprite's are
 * swapped; everything else is measured on the upright sprite.
 */
function starlingXml(sheet: SheetData, options: SheetWriteOptions): string {
  checkRotation("Starling XML", sheet, "cw");
  const lines = sheet.frames.map((f) => {
    const attrs = [
      `name="${xmlEscape(stem(f.filename))}"`,
      `x="${f.frame.x}"`,
      `y="${f.frame.y}"`,
      `width="${f.rotated ? f.frame.h : f.frame.w}"`,
      `height="${f.rotated ? f.frame.w : f.frame.h}"`,
    ];
    if (f.rotated) attrs.push(`rotated="true"`);
    if (f.trimmed) {
      attrs.push(
        `frameX="${-f.spriteSourceSize.x}"`,
        `frameY="${-f.spriteSourceSize.y}"`,
        `frameWidth="${f.sourceSize.w}"`,
        `frameHeight="${f.sourceSize.h}"`
      );
    }
    if (f.pivot) {
      attrs.push(
        `pivotX="${round(f.pivot.x * f.sourceSize.w)}"`,
        `pivotY="${round(f.pivot.y * f.sourceSize.h)}"`
      );
    }
    return `  <SubTexture ${attrs.join(" ")}/>`;
  });
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<TextureAtlas imagePath="${xmlEscape(options.image)}">`,
    ...lines,
    `</TextureAtlas>`,
    "",
  ].join("\n");
}

// ------------------------------------------------------------------ Godot SpriteFrames

/** Godot writes floats with a decimal point: 1 → "1.0". */
const godotFloat = (n: number) => (Number.isInteger(n) ? n.toFixed(1) : String(n));

/**
 * A Godot 4 `SpriteFrames` resource (`.tres`): one `AtlasTexture` per frame
 * and an animation per frame tag (or one "default" animation). Frame
 * durations become relative durations against the shortest frame, whose
 * rate becomes the animation speed. The image path assumes the sheet sits
 * next to the resource.
 */
function godotTres(sheet: SheetData, options: SheetWriteOptions): string {
  checkRotation("Godot SpriteFrames", sheet, null);
  const frames = sheet.frames;
  const base = Math.max(1, Math.min(...frames.map((f) => f.duration || 100)));
  const fps = Math.round((1000 / base) * 1000) / 1000;
  const given = options.frameTags;
  const tags: FrameTag[] = given
    ? [...given]
    : [{ name: "default", from: 0, to: frames.length - 1, direction: "forward" }];
  frames.forEach((f, i) => {
    if (tags.some((t) => i >= t.from && i <= t.to)) return;
    tags.push({ name: stem(f.filename), from: i, to: i, direction: "forward" });
  });
  const quoted = (text: string) => JSON.stringify(text);

  const out: string[] = [
    `[gd_resource type="SpriteFrames" load_steps=${frames.length + 2} format=3]`,
    "",
    `[ext_resource type="Texture2D" path="res://${options.image}" id="1_sheet"]`,
    "",
  ];
  frames.forEach((f, i) => {
    const margin = f.trimmed
      ? `\nmargin = Rect2(${f.spriteSourceSize.x}, ${f.spriteSourceSize.y}, ${f.sourceSize.w - f.frame.w}, ${f.sourceSize.h - f.frame.h})`
      : "";
    out.push(
      `[sub_resource type="AtlasTexture" id="AtlasTexture_${i}"]`,
      `atlas = ExtResource("1_sheet")`,
      `region = Rect2(${f.frame.x}, ${f.frame.y}, ${f.frame.w}, ${f.frame.h})${margin}`,
      ""
    );
  });
  const animation = (tag: FrameTag) => {
    const range: number[] = [];
    for (let i = tag.from; i <= tag.to; i++) range.push(i);
    const order =
      tag.direction === "reverse"
        ? range.reverse()
        : tag.direction === "pingpong"
          ? [...range, ...range.slice(1, -1).reverse()]
          : range;
    const entries = order.map((i) => {
      const relative = Math.round(((frames[i].duration || base) / base) * 1000) / 1000;
      return `{\n"duration": ${godotFloat(relative)},\n"texture": SubResource("AtlasTexture_${i}")\n}`;
    });
    return `{\n"frames": [${entries.join(", ")}],\n"loop": true,\n"name": &${quoted(tag.name)},\n"speed": ${godotFloat(fps)}\n}`;
  };
  out.push("[resource]", `animations = [${tags.map(animation).join(", ")}]`, "");
  return out.join("\n");
}

// ------------------------------------------------------------------ LibGDX atlas

/**
 * LibGDX `TextureAtlas` text format (the classic layout TexturePacker and
 * gdx-texturepacker write). LibGDX measures `offset` from the bottom-left of
 * the original image. Rotated regions are turned counter-clockwise, and all
 * their sizes and offsets are measured on the upright sprite.
 */
function libgdxAtlas(sheet: SheetData, options: SheetWriteOptions): string {
  checkRotation("The LibGDX atlas", sheet, "ccw");
  const out = [
    "",
    options.image,
    `size: ${sheet.width}, ${sheet.height}`,
    "format: RGBA8888",
    "filter: Nearest, Nearest",
    "repeat: none",
  ];
  for (const f of sheet.frames) {
    const offsetY = f.sourceSize.h - f.frame.h - f.spriteSourceSize.y;
    out.push(
      stem(f.filename),
      `  rotate: ${f.rotated}`,
      `  xy: ${f.frame.x}, ${f.frame.y}`,
      `  size: ${f.frame.w}, ${f.frame.h}`,
      `  orig: ${f.sourceSize.w}, ${f.sourceSize.h}`,
      `  offset: ${f.spriteSourceSize.x}, ${offsetY}`,
      "  index: -1"
    );
  }
  return out.join("\n") + "\n";
}

// ------------------------------------------------------------------ CSS sprites

/**
 * CSS sprites: a class per frame with the frame's size and background
 * position. Trimmed frames keep their untrimmed size, with the image
 * shifted by the trim offset, so they line up like the original frames.
 */
function cssSprites(sheet: SheetData, options: SheetWriteOptions): string {
  checkRotation("CSS sprites", sheet, null);
  const base = cssName(stem(options.image));
  const rules = sheet.frames.map((f) => {
    const x = f.frame.x - f.spriteSourceSize.x;
    const y = f.frame.y - f.spriteSourceSize.y;
    return [
      `.${base}.${cssName(stem(f.filename))} {`,
      `  width: ${f.sourceSize.w}px;`,
      `  height: ${f.sourceSize.h}px;`,
      `  background-position: ${-x}px ${-y}px;`,
      `}`,
    ].join("\n");
  });
  return [
    `.${base} {`,
    `  display: inline-block;`,
    `  background-image: url("${options.image}");`,
    `  background-repeat: no-repeat;`,
    `  image-rendering: pixelated;`,
    `}`,
    ...rules,
    "",
  ].join("\n");
}

// ------------------------------------------------------------------ registry

export const SHEET_FORMATS: readonly SheetFormat[] = [
  {
    id: "gs2d",
    label: "Game Studio 2D (sheet + animations)",
    readers: "Games with a gs2d.json (the spritesheet and animation contracts)",
    extension: ".sheet.json",
    mime: "application/json",
    rotation: "cw",
    supportsPivot: true,
    write: (sheet, options) => {
      checkRotation("Game Studio 2D", sheet, "cw");
      return gs2dSheet(sheet, options);
    },
    companion: { extension: ".animation.json", mime: "application/json", write: gs2dAnimation },
  },
  {
    id: "json-hash",
    label: "TexturePacker JSON (Hash)",
    readers: "Phaser, PixiJS, Aseprite-style tools",
    extension: ".json",
    mime: "application/json",
    rotation: "cw",
    supportsPivot: true,
    write: texturePacker("hash"),
  },
  {
    id: "json-array",
    label: "TexturePacker JSON (Array)",
    readers: "Phaser, PixiJS",
    extension: ".json",
    mime: "application/json",
    rotation: "cw",
    supportsPivot: true,
    write: texturePacker("array"),
  },
  {
    id: "starling-xml",
    label: "Starling / Sparrow XML",
    readers: "Starling, HaxeFlixel, Phaser (atlasXML, without rotation)",
    extension: ".xml",
    mime: "application/xml",
    rotation: "cw",
    supportsPivot: true,
    write: starlingXml,
  },
  {
    id: "godot-tres",
    label: "Godot SpriteFrames (.tres)",
    readers: "Godot 4 (AnimatedSprite2D)",
    extension: ".tres",
    mime: "text/plain",
    rotation: null,
    supportsPivot: false,
    write: godotTres,
  },
  {
    id: "libgdx-atlas",
    label: "LibGDX atlas",
    readers: "LibGDX TextureAtlas",
    extension: ".atlas",
    mime: "text/plain",
    rotation: "ccw",
    supportsPivot: false,
    write: libgdxAtlas,
  },
  {
    id: "css",
    label: "CSS sprites",
    readers: "Web pages",
    extension: ".css",
    mime: "text/css",
    rotation: null,
    supportsPivot: false,
    write: cssSprites,
  },
];

export function sheetFormat(id: SheetFormatId): SheetFormat {
  const format = SHEET_FORMATS.find((f) => f.id === id);
  if (!format) throw new Error(`Unknown spritesheet format: ${id}`);
  return format;
}
