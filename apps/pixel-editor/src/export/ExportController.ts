import { downloadBlob } from "@foundry2d/workspace";
import type { Sprite } from "../model/Sprite";
import {
  compositeFrame,
  flattenOnto,
  opaqueBounds,
  cropImage,
  parseHexColor,
  scaleImage,
  type RgbaImage,
} from "./raster";
import { createZip, encodeBmp, encodeGif, type ZipEntry } from "./encoders";
import { sheetFormat, type SheetFormatId } from "@foundry2d/formats";
import { buildSpritesheet, sheetData, type SheetLayout, type Spritesheet } from "./spritesheet";

export type ImageFormat = "png" | "webp" | "webp-lossy" | "jpeg" | "bmp";
export type ExportSource = "flattened" | "layer";

export interface ImageExportOptions {
  format: ImageFormat;
  /** 0..1, for lossy WebP and JPEG. */
  quality: number;
  /** Background for JPEG (no alpha). */
  background: string;
  scale: number;
  source: ExportSource;
  frames: "current" | "all";
  trim: boolean;
  /** Placeholders: {name} {frame} {w} {h}. */
  pattern: string;
}

export interface SheetExportOptions {
  layout: SheetLayout;
  columns: number | null;
  padding: number;
  extrude: number;
  trim: boolean;
  scale: number;
  source: ExportSource;
  /** Data file format (`@foundry2d/formats`), or the image only. */
  data: SheetFormatId | "none";
  /** One ZIP, or the image and data file as separate downloads. */
  output: "zip" | "files";
}

export interface GifExportOptions {
  scale: number;
  source: ExportSource;
  /** Loop forever (otherwise play once). */
  loop: boolean;
  /** Dither when the sprite has more than 255 colours. */
  dither: boolean;
}

const MIME: Record<Exclude<ImageFormat, "bmp">, string> = {
  png: "image/png",
  webp: "image/webp",
  "webp-lossy": "image/webp",
  jpeg: "image/jpeg",
};

const EXTENSION: Record<ImageFormat, string> = {
  png: "png",
  webp: "webp",
  "webp-lossy": "webp",
  jpeg: "jpg",
  bmp: "bmp",
};

/** Keeps file names portable. */
const safeName = (name: string) => name.replace(/[\\/:*?"<>|]+/g, "_").trim() || "sprite";

export function applyPattern(
  pattern: string,
  values: { name: string; frame: number; w: number; h: number }
): string {
  return safeName(
    (pattern || "{name}")
      .replaceAll("{name}", values.name)
      .replaceAll("{frame}", String(values.frame))
      .replaceAll("{w}", String(values.w))
      .replaceAll("{h}", String(values.h))
  );
}

/**
 * Turns the sprite into files: single images in several formats, image
 * sequences, TexturePacker-style spritesheets and animated GIFs.
 * Pixels are composited in software (see `compositeFrame`); only PNG, WebP
 * and JPEG encoding uses the browser's canvas encoder.
 */
export class ExportController {
  constructor(
    private readonly sprite: Sprite,
    private readonly getName: () => string,
    private readonly getActiveLayerId: () => string | null
  ) {}

  get frameCount(): number {
    return this.sprite.frames.length;
  }

  get spriteWidth(): number {
    return this.sprite.width;
  }

  get spriteHeight(): number {
    return this.sprite.height;
  }

  /** A frame's pixels at `scale`, flattened or the active layer only. */
  renderFrame(index: number, source: ExportSource, scale: number): RgbaImage {
    const layerId = source === "layer" ? (this.getActiveLayerId() ?? undefined) : undefined;
    return scaleImage(compositeFrame(this.sprite.frames[index], layerId), scale);
  }

  async encode(
    image: RgbaImage,
    format: ImageFormat,
    quality: number,
    background: string
  ): Promise<Blob> {
    if (format === "bmp")
      return new Blob([encodeBmp(image) as Uint8Array<ArrayBuffer>], { type: "image/bmp" });
    const pixels = format === "jpeg" ? flattenOnto(image, parseHexColor(background)) : image;
    const canvas = document.createElement("canvas");
    canvas.width = pixels.width;
    canvas.height = pixels.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context is not available");
    ctx.putImageData(
      new ImageData(pixels.data as Uint8ClampedArray<ArrayBuffer>, pixels.width, pixels.height),
      0,
      0
    );
    const mime = MIME[format];
    // Lossless WebP: quality 1 makes Chromium use its lossless encoder.
    const q = format === "webp" ? 1 : Math.min(1, Math.max(0, quality));
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, mime, q));
    if (!blob) throw new Error("Image encoding failed.");
    if (blob.type !== mime) {
      throw new Error(`This browser can't encode ${format.toUpperCase()} images.`);
    }
    return blob;
  }

  /** Output size of a single exported image. */
  imageSize(options: ImageExportOptions): { width: number; height: number } {
    const image = this.prepareImage(this.sprite.currentIndex, options);
    return { width: image.width, height: image.height };
  }

  private prepareImage(index: number, options: ImageExportOptions): RgbaImage {
    let image = compositeFrame(
      this.sprite.frames[index],
      options.source === "layer" ? (this.getActiveLayerId() ?? undefined) : undefined
    );
    if (options.trim) {
      const bounds = opaqueBounds(image);
      if (bounds) image = cropImage(image, bounds);
    }
    return scaleImage(image, options.scale);
  }

  /** Exports the current frame, or every frame as a ZIP of images. Returns the file name. */
  async exportImages(options: ImageExportOptions): Promise<string> {
    const name = this.getName();
    const ext = EXTENSION[options.format];
    const indices =
      options.frames === "all" ? this.sprite.frames.map((_, i) => i) : [this.sprite.currentIndex];

    const files: { name: string; blob: Blob }[] = [];
    for (const index of indices) {
      const image = this.prepareImage(index, options);
      const blob = await this.encode(image, options.format, options.quality, options.background);
      const base = applyPattern(options.pattern, {
        name,
        frame: index,
        w: image.width,
        h: image.height,
      });
      files.push({ name: `${base}.${ext}`, blob });
    }

    if (files.length === 1) {
      downloadBlob(files[0].blob, files[0].name);
      return files[0].name;
    }
    const entries: ZipEntry[] = await Promise.all(
      files.map(async (f) => ({ name: f.name, data: new Uint8Array(await f.blob.arrayBuffer()) }))
    );
    const zipName = `${safeName(name)}-frames.zip`;
    downloadBlob(
      new Blob([createZip(entries) as Uint8Array<ArrayBuffer>], { type: "application/zip" }),
      zipName
    );
    return zipName;
  }

  buildSheet(options: SheetExportOptions): Spritesheet {
    const name = safeName(this.getName());
    return buildSpritesheet(
      this.sprite.frames.map((_, i) => ({
        name: `${name}_${i}.png`,
        image: this.renderFrame(i, options.source, options.scale),
        duration: this.sprite.frameDuration(i),
      })),
      {
        layout: options.layout,
        columns: options.columns ?? undefined,
        padding: options.padding,
        extrude: options.extrude,
        trim: options.trim,
      }
    );
  }

  /** Exports the spritesheet PNG plus its data file in the chosen format. Returns a summary. */
  async exportSpritesheet(options: SheetExportOptions): Promise<string> {
    const base = safeName(this.getName());
    const sheet = this.buildSheet(options);
    const png = await this.encode(sheet.image, "png", 1, "#000000");
    const imageName = `${base}.png`;
    const format = options.data === "none" ? null : sheetFormat(options.data);
    const data = format?.write(sheetData(sheet), {
      image: imageName,
      scale: options.scale,
      frameTags: [{ name: base, from: 0, to: this.sprite.frames.length - 1, direction: "forward" }],
    });
    const dataName = format ? `${base}${format.extension}` : "";

    if (options.output === "files" || !format || data === undefined) {
      downloadBlob(png, imageName);
      if (format && data !== undefined)
        downloadBlob(new Blob([data], { type: format.mime }), dataName);
      return format ? `${imageName} + ${dataName}` : imageName;
    }
    const zip = createZip([
      { name: imageName, data: new Uint8Array(await png.arrayBuffer()) },
      { name: dataName, data: new TextEncoder().encode(data) },
    ]);
    const zipName = `${base}-spritesheet.zip`;
    downloadBlob(new Blob([zip as Uint8Array<ArrayBuffer>], { type: "application/zip" }), zipName);
    return zipName;
  }

  /** Animated GIF using each frame's duration. */
  exportGif(options: GifExportOptions): string {
    const frames = this.sprite.frames.map((_, i) =>
      this.renderFrame(i, options.source, options.scale)
    );
    const delays = this.sprite.frames.map((_, i) => this.sprite.frameDuration(i));
    const gif = encodeGif(frames, delays, {
      loop: options.loop ? 0 : null,
      dither: options.dither,
    });
    const fileName = `${safeName(this.getName())}.gif`;
    downloadBlob(new Blob([gif as Uint8Array<ArrayBuffer>], { type: "image/gif" }), fileName);
    return fileName;
  }
}
