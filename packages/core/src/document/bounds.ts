import type { Rect } from "../types";

/** Bounding rectangle (in cells) of changed cells, or `undefined` when there are none. */
export function boundsOfChanges(cells: Iterable<{ x: number; y: number }>): Rect | undefined {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const { x, y } of cells) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return minX === Infinity
    ? undefined
    : { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
}

/** Smallest rectangle containing both (either may be missing). */
export function unionRects(a: Rect | undefined, b: Rect | undefined): Rect | undefined {
  if (!a) return b;
  if (!b) return a;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}
