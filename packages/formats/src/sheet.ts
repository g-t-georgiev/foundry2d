/**
 * Spritesheet data formats for game engines (roadmap item 40). Every writer
 * takes the same placement data, so a format is written once and used by the
 * pixel editor's exporter and the Sprite Packer (Phase 9).
 *
 * Placement uses TexturePacker's field names: `frame` is the rectangle in
 * the sheet, `spriteSourceSize` where that rectangle sits inside the
 * untrimmed `sourceSize`.
 */

/** One frame's placement in the sheet. */
export interface SheetFrame {
  /** Frame key, e.g. "walk_0.png". */
  filename: string;
  /**
   * The sprite's rectangle on the sheet, with its unrotated width and height.
   * A `rotated` sprite is stored turned 90° clockwise, covering `h × w`.
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
  /** Can describe sprites stored rotated (TexturePacker's 90° clockwise convention). */
  supportsRotation: boolean;
  /** Writes sprite pivots. */
  supportsPivot: boolean;
  write(sheet: SheetData, options: SheetWriteOptions): string;
}

/** For formats that can't describe rotated sprites: fail loudly rather than write wrong data. */
function noRotation(format: string, sheet: SheetData): void {
  if (sheet.frames.some((f) => f.rotated)) {
    throw new Error(`${format} can't describe rotated sprites; pack without rotation.`);
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
 */
function starlingXml(sheet: SheetData, options: SheetWriteOptions): string {
  noRotation("Starling XML", sheet);
  const lines = sheet.frames.map((f) => {
    const attrs = [
      `name="${xmlEscape(stem(f.filename))}"`,
      `x="${f.frame.x}"`,
      `y="${f.frame.y}"`,
      `width="${f.frame.w}"`,
      `height="${f.frame.h}"`,
    ];
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
  noRotation("Godot SpriteFrames", sheet);
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
 * the original image.
 */
function libgdxAtlas(sheet: SheetData, options: SheetWriteOptions): string {
  noRotation("The LibGDX atlas writer", sheet);
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
      "  rotate: false",
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
  noRotation("CSS sprites", sheet);
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
    id: "json-hash",
    label: "TexturePacker JSON (Hash)",
    readers: "Phaser, PixiJS, Aseprite-style tools",
    extension: ".json",
    mime: "application/json",
    supportsRotation: true,
    supportsPivot: true,
    write: texturePacker("hash"),
  },
  {
    id: "json-array",
    label: "TexturePacker JSON (Array)",
    readers: "Phaser, PixiJS",
    extension: ".json",
    mime: "application/json",
    supportsRotation: true,
    supportsPivot: true,
    write: texturePacker("array"),
  },
  {
    id: "starling-xml",
    label: "Starling / Sparrow XML",
    readers: "Starling, Phaser (atlasXML), HaxeFlixel",
    extension: ".xml",
    mime: "application/xml",
    supportsRotation: false,
    supportsPivot: true,
    write: starlingXml,
  },
  {
    id: "godot-tres",
    label: "Godot SpriteFrames (.tres)",
    readers: "Godot 4 (AnimatedSprite2D)",
    extension: ".tres",
    mime: "text/plain",
    supportsRotation: false,
    supportsPivot: false,
    write: godotTres,
  },
  {
    id: "libgdx-atlas",
    label: "LibGDX atlas",
    readers: "LibGDX TextureAtlas",
    extension: ".atlas",
    mime: "text/plain",
    supportsRotation: false,
    supportsPivot: false,
    write: libgdxAtlas,
  },
  {
    id: "css",
    label: "CSS sprites",
    readers: "Web pages",
    extension: ".css",
    mime: "text/css",
    supportsRotation: false,
    supportsPivot: false,
    write: cssSprites,
  },
];

export function sheetFormat(id: SheetFormatId): SheetFormat {
  const format = SHEET_FORMATS.find((f) => f.id === id);
  if (!format) throw new Error(`Unknown spritesheet format: ${id}`);
  return format;
}
