import { encodeTile } from "./tiles";

/**
 * Auto-layer rules (LDtk's model, simplified): a Tiles layer can be
 * generated from an IntGrid "source" layer. Each rule is a small pattern of
 * neighbour conditions around a cell; the first active rule that matches a
 * cell places one of its tiles there.
 *
 * Pattern cell values:
 * - `0`: anything;
 * - `v > 0`: the source cell must hold value `v`;
 * - `-v`: the source cell must not hold `v`;
 * - `ANY_VALUE`: the source cell must be non-empty;
 * - `-ANY_VALUE`: the source cell must be empty.
 *
 * Cells outside the level read as their nearest edge cell, so maps behave as
 * if they continued past their borders (ground touching the bottom edge
 * doesn't grow a border there).
 */
export const ANY_VALUE = 1_000_001;

export type AutoRuleSize = 1 | 3 | 5;
export const AUTO_RULE_SIZES: readonly AutoRuleSize[] = [1, 3, 5];

export interface AutoRule {
  uid: number;
  active: boolean;
  /** Pattern side length (odd). */
  size: AutoRuleSize;
  /** `size * size` conditions, row-major, centred on the cell being tiled. */
  pattern: number[];
  /** Tile ids to place; one is picked per cell (random but stable). */
  tileIds: number[];
  /** Probability (0..1) that a matching cell gets a tile from this rule. */
  chance: number;
  /** Also try the pattern mirrored horizontally / vertically (tile flipped to match). */
  flipX: boolean;
  flipY: boolean;
}

/** A new rule: "every cell holding `value`", or an empty 3×3 pattern. */
export function createRule(uid: number, value: number | null, size: AutoRuleSize = 3): AutoRule {
  const pattern = Array.from({ length: size * size }, () => 0);
  if (value !== null) pattern[(size * size - 1) / 2] = value;
  return { uid, active: true, size, pattern, tileIds: [], chance: 1, flipX: false, flipY: false };
}

/** Resizes a pattern, keeping conditions that still fit around the centre. */
export function resizePattern(pattern: number[], from: AutoRuleSize, to: AutoRuleSize): number[] {
  const next = Array.from({ length: to * to }, () => 0);
  const rFrom = (from - 1) / 2;
  const rTo = (to - 1) / 2;
  for (let dy = -rTo; dy <= rTo; dy++) {
    for (let dx = -rTo; dx <= rTo; dx++) {
      if (Math.abs(dx) > rFrom || Math.abs(dy) > rFrom) continue;
      next[(dy + rTo) * to + (dx + rTo)] = pattern[(dy + rFrom) * from + (dx + rFrom)] ?? 0;
    }
  }
  return next;
}

/** Whether a source value satisfies one pattern condition. */
export function conditionMatches(condition: number, value: number): boolean {
  if (condition === 0) return true;
  if (condition === ANY_VALUE) return value !== 0;
  if (condition === -ANY_VALUE) return value === 0;
  return condition > 0 ? value === condition : value !== -condition;
}

/** Deterministic 32-bit hash of a few integers (for stable "random" choices). */
export function hashCells(a: number, b: number, c: number, d: number): number {
  let h = 0x811c9dc5 ^ d;
  for (const n of [a, b, c]) {
    h = Math.imul(h ^ (n & 0xffff), 0x01000193);
    h = Math.imul(h ^ (n >>> 16), 0x01000193);
  }
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return h >>> 0;
}

/**
 * Generates tile cells (`encodeTile` values, 0 = empty) for a whole layer.
 * `seed` varies the random choices (tile variants, chance).
 */
export function generateAutoTiles(
  source: ArrayLike<number>,
  width: number,
  height: number,
  rules: readonly AutoRule[],
  seed = 0
): Int32Array {
  const out = new Int32Array(width * height);
  const active = rules.filter((r) => r.active && r.tileIds.length > 0 && r.chance > 0);
  if (active.length === 0) return out;

  const read = (x: number, y: number) => {
    const cx = x < 0 ? 0 : x >= width ? width - 1 : x;
    const cy = y < 0 ? 0 : y >= height ? height - 1 : y;
    return source[cy * width + cx];
  };

  // Pre-split each pattern into its non-trivial conditions per mirror variant.
  const compiled = active.map((rule) => {
    const r = (rule.size - 1) / 2;
    const variants: { fx: boolean; fy: boolean; checks: [number, number, number][] }[] = [];
    const mirrors: [boolean, boolean][] = [[false, false]];
    if (rule.flipX) mirrors.push([true, false]);
    if (rule.flipY) mirrors.push([false, true]);
    if (rule.flipX && rule.flipY) mirrors.push([true, true]);
    for (const [fx, fy] of mirrors) {
      const checks: [number, number, number][] = [];
      for (let py = -r; py <= r; py++) {
        for (let px = -r; px <= r; px++) {
          const condition = rule.pattern[(py + r) * rule.size + (px + r)];
          if (condition !== 0) checks.push([fx ? -px : px, fy ? -py : py, condition]);
        }
      }
      variants.push({ fx, fy, checks });
    }
    return { rule, variants };
  });

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      rules: for (const { rule, variants } of compiled) {
        for (const { fx, fy, checks } of variants) {
          let ok = true;
          for (const [dx, dy, condition] of checks) {
            if (!conditionMatches(condition, read(x + dx, y + dy))) {
              ok = false;
              break;
            }
          }
          if (!ok) continue;
          if (rule.chance < 1) {
            const roll = hashCells(x, y, rule.uid, seed) / 0x1_0000_0000;
            // A failed roll skips the whole rule; later rules may still match.
            if (roll >= rule.chance) continue rules;
          }
          const pick = hashCells(y, x, rule.uid, seed ^ 0x5bd1e995) % rule.tileIds.length;
          out[y * width + x] = encodeTile(rule.tileIds[pick], fx, fy);
          break rules;
        }
      }
    }
  }
  return out;
}
