import type { AnimationAsset, AnimationClip, SpriteFrame, SpriteSheetAsset } from "@gs2d/contracts";
import type { SheetData, SheetWriteOptions } from "./sheet";

/**
 * Game Studio 2D's own contracts (roadmap 12.1): a `spritesheet` file, and
 * beside it an `animation` file naming the sheet by id. Sprites are named
 * without the image extension ("walk_0.png" → "walk_0").
 */

const stem = (name: string) => name.replace(/\.[^./]+$/, "");

/** The sheet's id: its image's name without the extension ("hero@2x.png" → "hero@2x"). */
export const contractSheetId = (image: string) => stem(image.split(/[\\/]/).pop() ?? image);

export function contractSpriteSheet(
  sheet: SheetData,
  options: SheetWriteOptions
): SpriteSheetAsset {
  const id = contractSheetId(options.image);
  const frames: Record<string, SpriteFrame> = {};
  for (const f of sheet.frames) {
    const frame: SpriteFrame = { ...f.frame };
    if (f.rotated) frame.rotated = true;
    if (f.trimmed) {
      const { x, y } = f.spriteSourceSize;
      frame.source = { x, y, w: f.sourceSize.w, h: f.sourceSize.h };
    }
    if (f.pivot) frame.pivot = { ...f.pivot };
    frames[stem(f.filename)] = frame;
  }
  return {
    version: 1,
    kind: "spritesheet",
    id,
    name: id,
    image: options.image,
    width: sheet.width,
    height: sheet.height,
    ...(options.scale !== 1 && { scale: options.scale }),
    frames,
  };
}

/** The sheet's animations, from its frame tags; `null` without any. */
export function contractAnimation(
  sheet: SheetData,
  options: SheetWriteOptions
): AnimationAsset | null {
  const tags = options.frameTags ?? [];
  if (!tags.length) return null;
  const id = contractSheetId(options.image);
  const clips: Record<string, AnimationClip> = {};
  for (const tag of tags) {
    const frames = sheet.frames.slice(tag.from, tag.to + 1).map((f) => ({
      sprite: stem(f.filename),
      ms: Math.max(1, Math.round(f.duration)),
    }));
    if (!frames.length) continue;
    if (tag.direction === "reverse") frames.reverse();
    clips[tag.name] = tag.direction === "pingpong" ? { playback: "pingpong", frames } : { frames };
  }
  if (!Object.keys(clips).length) return null;
  return { version: 1, kind: "animation", id: `${id}-animation`, name: id, sheet: id, clips };
}

export const gs2dSheet = (sheet: SheetData, options: SheetWriteOptions) =>
  `${JSON.stringify(contractSpriteSheet(sheet, options), null, 2)}\n`;

export function gs2dAnimation(sheet: SheetData, options: SheetWriteOptions): string | null {
  const animation = contractAnimation(sheet, options);
  return animation && `${JSON.stringify(animation, null, 2)}\n`;
}
