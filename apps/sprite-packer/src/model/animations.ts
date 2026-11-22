import type { FrameTag } from "@foundry2d/formats";

/** Sprites that form a sequence, in playing order. */
export interface Animation {
  name: string;
  /** Sprite names. */
  frames: string[];
}

/** "walk_01", "walk-1", "walk (1)", "run/1" and "walk1": the part before the number, and the number. */
const NUMBERED = /^(.*?)[\s_\-./]*\(?(\d+)\)?$/;

/**
 * Sequences among sprite names: names that only differ in a trailing number,
 * two or more of them. Numbers order the frames; gaps are fine.
 */
export function detectAnimations(names: readonly string[]): Animation[] {
  const groups = new Map<string, { name: string; number: number }[]>();
  for (const name of names) {
    const match = NUMBERED.exec(name);
    if (!match) continue;
    const base = match[1] || "animation";
    const group = groups.get(base);
    const frame = { name, number: Number(match[2]) };
    if (group) group.push(frame);
    else groups.set(base, [frame]);
  }
  return [...groups]
    .filter(([, frames]) => frames.length > 1)
    .map(([name, frames]) => ({
      name,
      frames: frames.sort((a, b) => a.number - b.number).map((f) => f.name),
    }));
}

/**
 * Names in packing order: as listed, but with each animation's frames
 * together (data formats describe animations as frame ranges).
 */
export function packOrder(names: readonly string[], animations: readonly Animation[]): string[] {
  const animationOf = new Map(animations.flatMap((a) => a.frames.map((f) => [f, a] as const)));
  const done = new Set<Animation>();
  return names.flatMap((name) => {
    const animation = animationOf.get(name);
    if (!animation) return [name];
    if (done.has(animation)) return [];
    done.add(animation);
    return animation.frames;
  });
}

/**
 * The animations as frame ranges of one sheet (`frames`: its sprite names in
 * order). Animations that aren't completely on this sheet are left out.
 */
export function frameTags(frames: readonly string[], animations: readonly Animation[]): FrameTag[] {
  const index = new Map(frames.map((name, i) => [name, i]));
  return animations.flatMap((a): FrameTag[] => {
    const from = index.get(a.frames[0]);
    if (from === undefined) return [];
    const together = a.frames.every((name, i) => index.get(name) === from + i);
    const to = from + a.frames.length - 1;
    return together ? [{ name: a.name, from, to, direction: "forward" }] : [];
  });
}
