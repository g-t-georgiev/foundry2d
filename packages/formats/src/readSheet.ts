import type { SheetFrame } from "./sheet";

/**
 * Reads spritesheet data written by other tools (and by our own writers), so
 * existing atlases can be unpacked: TexturePacker JSON (hash, array and
 * Phaser multi-atlas), Starling/Sparrow XML and LibGDX atlases.
 *
 * Rotated regions are read from TexturePacker JSON only: the other formats
 * turn sprites their own way, so rotated regions there are an error instead
 * of sprites that come out wrong.
 */
export interface SheetPage {
  /** Image file the frames are on, as the data names it; "" when it doesn't. */
  image: string;
  frames: SheetFrame[];
}

/** The data was recognised but can't be used; the message is safe to show. */
export class SheetReadError extends Error {}

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;
const isInt = (v: unknown): v is number => Number.isInteger(v);

function box(v: unknown): { x: number; y: number; w: number; h: number } | null {
  return isRecord(v) && isInt(v.x) && isInt(v.y) && isInt(v.w) && isInt(v.h) && v.w > 0 && v.h > 0
    ? { x: v.x, y: v.y, w: v.w, h: v.h }
    : null;
}

// ------------------------------------------------------------------ TexturePacker JSON

function jsonFrame(filename: unknown, raw: unknown): SheetFrame {
  const frame = isRecord(raw) ? box(raw.frame) : null;
  if (typeof filename !== "string" || !isRecord(raw) || !frame) {
    throw new SheetReadError(`Frame "${String(filename)}" is invalid.`);
  }
  const source = raw.sourceSize;
  const sourceSize =
    isRecord(source) && isInt(source.w) && isInt(source.h) && source.w > 0 && source.h > 0
      ? { w: source.w, h: source.h }
      : { w: frame.w, h: frame.h };
  const spriteSourceSize = box(raw.spriteSourceSize) ?? { x: 0, y: 0, w: frame.w, h: frame.h };
  return {
    filename,
    frame,
    rotated: raw.rotated === true,
    trimmed: raw.trimmed === true,
    spriteSourceSize,
    sourceSize,
    duration: typeof raw.duration === "number" ? raw.duration : 100,
  };
}

function jsonFrames(frames: unknown): SheetFrame[] {
  if (Array.isArray(frames)) {
    return frames.map((f: unknown) => jsonFrame(isRecord(f) ? f.filename : undefined, f));
  }
  return Object.entries(frames as object).map(([name, f]) => jsonFrame(name, f));
}

function readJson(text: string): SheetPage[] | null {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  if (!isRecord(json)) return null;
  if (Array.isArray(json.textures)) {
    return json.textures.filter(isRecord).map((t) => ({
      image: typeof t.image === "string" ? t.image : "",
      frames: isRecord(t.frames) ? jsonFrames(t.frames) : [],
    }));
  }
  if (!isRecord(json.frames)) return null;
  const image = isRecord(json.meta) ? json.meta.image : undefined;
  return [{ image: typeof image === "string" ? image : "", frames: jsonFrames(json.frames) }];
}

// ------------------------------------------------------------------ Starling / Sparrow XML

const XML_ENTITIES: Record<string, string> = { lt: "<", gt: ">", quot: '"', apos: "'", amp: "&" };
const unescapeXml = (text: string) =>
  text.replace(/&(lt|gt|quot|apos|amp);/g, (_, name: string) => XML_ENTITIES[name]);

function attributes(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [, name, a, b] of tag.matchAll(/([A-Za-z]\w*)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) {
    out[name] = unescapeXml(a ?? b ?? "");
  }
  return out;
}

function readXml(text: string): SheetPage[] | null {
  const root = /<TextureAtlas\b[^>]*>/.exec(text);
  if (!root) return null;
  const frames = [...text.matchAll(/<SubTexture\b[^>]*>/g)].map(([tag]): SheetFrame => {
    const a = attributes(tag);
    const num = (key: string, fallback?: number) =>
      key in a ? Math.round(Number(a[key])) : (fallback ?? NaN);
    const frame = box({ x: num("x"), y: num("y"), w: num("width"), h: num("height") });
    if (!frame || !a.name) throw new SheetReadError(`SubTexture "${a.name ?? "?"}" is invalid.`);
    if (a.rotated === "true") {
      throw new SheetReadError(`"${a.name}" is rotated, which isn't supported for this format.`);
    }
    return {
      filename: a.name,
      frame,
      rotated: false,
      trimmed: "frameWidth" in a,
      spriteSourceSize: {
        x: -num("frameX", 0) + 0,
        y: -num("frameY", 0) + 0,
        w: frame.w,
        h: frame.h,
      },
      sourceSize: { w: num("frameWidth", frame.w), h: num("frameHeight", frame.h) },
      duration: 100,
    };
  });
  return [{ image: attributes(root[0]).imagePath ?? "", frames }];
}

// ------------------------------------------------------------------ LibGDX atlas

/** Both layouts: the classic one (xy, size, orig, offset) and the newer (bounds, offsets). */
function readAtlasText(text: string): SheetPage[] | null {
  const lines = text.split(/\r?\n/);
  if (!lines.some((l) => /^\s*(xy|bounds)\s*:/.test(l))) return null;
  const pages: SheetPage[] = [];
  let page: SheetPage | null = null;
  let region: { name: string; values: Record<string, string> } | null = null;
  let inHeader = false;

  const finish = () => {
    if (!page || !region) return;
    const { name, values } = region;
    region = null;
    const ints = (key: string) => values[key]?.split(",").map((v) => Number(v.trim()));
    const bounds = ints("bounds") ?? [...(ints("xy") ?? []), ...(ints("size") ?? [])];
    const frame = box({ x: bounds[0], y: bounds[1], w: bounds[2], h: bounds[3] });
    if (!frame) throw new SheetReadError(`Region "${name}" is invalid.`);
    if (values.rotate && values.rotate !== "false" && values.rotate !== "0") {
      throw new SheetReadError(`"${name}" is rotated, which isn't supported for this format.`);
    }
    const offsets = ints("offsets") ?? [
      ...(ints("offset") ?? [0, 0]),
      ...(ints("orig") ?? [frame.w, frame.h]),
    ];
    const [left, bottom, w, h] = offsets;
    const index = values.index === undefined ? -1 : Number(values.index);
    page.frames.push({
      filename: index >= 0 ? `${name}_${index}` : name,
      frame,
      rotated: false,
      trimmed: w !== frame.w || h !== frame.h,
      // LibGDX counts the offset from the bottom.
      spriteSourceSize: { x: left, y: h - frame.h - bottom, w: frame.w, h: frame.h },
      sourceSize: { w, h },
      duration: 100,
    });
  };

  for (const line of lines) {
    const pair = /^\s*([A-Za-z]\w*)\s*:\s*(.*)$/.exec(line);
    if (line.trim() === "") {
      finish();
      page = null;
    } else if (!page) {
      page = { image: line.trim(), frames: [] };
      pages.push(page);
      inHeader = true;
    } else if (pair && region) {
      region.values[pair[1]] = pair[2].trim();
    } else if (pair && inHeader) {
      continue; // page settings (size, format, filter…)
    } else {
      finish();
      inHeader = false;
      region = { name: line.trim(), values: {} };
    }
  }
  finish();
  return pages;
}

/**
 * The sheets described by `text`, or `null` when it isn't a known data
 * format. Throws `SheetReadError` when it is one but can't be used.
 */
export function readSheetData(text: string): SheetPage[] | null {
  const start = text.trimStart();
  if (start.startsWith("{")) return readJson(text);
  if (start.startsWith("<")) return readXml(text);
  return readAtlasText(text);
}
