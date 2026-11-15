import type { SelectionShape } from "./SelectTool";
import type { ToolContext } from "./types";
import type { CellBuffer } from "../document";

/**
 * How a new selection combines with the current one: replace it, add to it
 * (Shift), or subtract from it (Alt), as in Photoshop and Aseprite.
 */
export type SelectionOp = "replace" | "add" | "subtract";

/** The combine mode for a pointer press, from its modifier keys. */
export function selectionOp(ctx: Pick<ToolContext<CellBuffer>, "modifiers">): SelectionOp {
  if (ctx.modifiers?.alt) return "subtract";
  if (ctx.modifiers?.shift) return "add";
  return "replace";
}

/** Shrinks a full-size mask to its bounding box; `null` when nothing is set. */
export function cropMask(full: Uint8Array, width: number, height: number): SelectionShape | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (!full[y * width + x]) continue;
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < 0) return null;
  const rect = { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
  const mask = new Uint8Array(rect.width * rect.height);
  for (let y = 0; y < rect.height; y++) {
    for (let x = 0; x < rect.width; x++) {
      mask[y * rect.width + x] = full[(y + rect.y) * width + (x + rect.x)];
    }
  }
  return { rect, mask };
}

/**
 * `base` with `shape` added or subtracted, on a layer of `bounds`. Replace
 * returns `shape` itself. `null` means nothing selected.
 */
export function combineShapes(
  base: SelectionShape | null,
  shape: SelectionShape | null,
  op: SelectionOp,
  bounds: { width: number; height: number }
): SelectionShape | null {
  if (op === "replace") return shape;
  if (!shape) return base;
  if (!base) return op === "add" ? shape : null;
  const { width, height } = bounds;
  const full = new Uint8Array(width * height);
  const paint = (s: SelectionShape, value: 0 | 1) => {
    const { rect, mask } = s;
    for (let y = 0; y < rect.height; y++) {
      const ty = rect.y + y;
      if (ty < 0 || ty >= height) continue;
      for (let x = 0; x < rect.width; x++) {
        const tx = rect.x + x;
        if (tx < 0 || tx >= width) continue;
        if (mask && mask[y * rect.width + x] !== 1) continue;
        full[ty * width + tx] = value;
      }
    }
  };
  paint(base, 1);
  paint(shape, op === "add" ? 1 : 0);
  return cropMask(full, width, height);
}
