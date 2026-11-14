/**
 * Colour reduction for formats with a small palette (GIF: 255 colours plus
 * transparency). Colours are packed as `0xRRGGBB`.
 */

interface Box {
  /** Distinct colours in this box with their pixel counts. */
  colors: { rgb: number; count: number }[];
  /** Pixels covered (sum of counts). */
  total: number;
}

const channel = (rgb: number, c: 0 | 1 | 2) => (rgb >> (16 - c * 8)) & 255;

/** The channel with the widest spread in a box, and that spread. */
function widestChannel(box: Box): { c: 0 | 1 | 2; range: number } {
  let best: { c: 0 | 1 | 2; range: number } = { c: 0, range: -1 };
  for (const c of [0, 1, 2] as const) {
    let min = 255;
    let max = 0;
    for (const { rgb } of box.colors) {
      const v = channel(rgb, c);
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (max - min > best.range) best = { c, range: max - min };
  }
  return best;
}

/**
 * Median cut, weighted by pixel count: repeatedly split the box whose
 * colours are most spread out (range × pixels) at the weighted median of its
 * widest channel, until there are `size` boxes. Each box becomes its
 * pixel-weighted average colour, so the palette spans the whole colour range
 * rather than just the most frequent colours.
 *
 * With `size` or fewer distinct colours, they are returned unchanged.
 */
export function medianCut(counts: Map<number, number>, size: number): number[] {
  if (counts.size <= size) return [...counts.keys()];
  const all = [...counts.entries()].map(([rgb, count]) => ({ rgb, count }));
  const boxes: Box[] = [{ colors: all, total: all.reduce((n, c) => n + c.count, 0) }];

  while (boxes.length < size) {
    // The box that most needs splitting.
    let pick = -1;
    let score = 0;
    let axis: 0 | 1 | 2 = 0;
    boxes.forEach((box, i) => {
      if (box.colors.length < 2) return;
      const { c, range } = widestChannel(box);
      const s = range * box.total;
      if (s > score) {
        score = s;
        pick = i;
        axis = c;
      }
    });
    if (pick === -1) break; // every box is a single colour

    const box = boxes[pick];
    box.colors.sort((a, b) => channel(a.rgb, axis) - channel(b.rgb, axis));
    // Weighted median: first colour where the running count passes half.
    let running = 0;
    let cut = 1;
    for (let i = 0; i < box.colors.length - 1; i++) {
      running += box.colors[i].count;
      cut = i + 1;
      if (running >= box.total / 2) break;
    }
    const low = box.colors.slice(0, cut);
    const high = box.colors.slice(cut);
    const sum = (cs: Box["colors"]) => cs.reduce((n, c) => n + c.count, 0);
    boxes.splice(pick, 1, { colors: low, total: sum(low) }, { colors: high, total: sum(high) });
  }

  return boxes.map(({ colors, total }) => {
    let r = 0;
    let g = 0;
    let b = 0;
    for (const { rgb, count } of colors) {
      r += channel(rgb, 0) * count;
      g += channel(rgb, 1) * count;
      b += channel(rgb, 2) * count;
    }
    return (Math.round(r / total) << 16) | (Math.round(g / total) << 8) | Math.round(b / total);
  });
}

/** Index of the palette colour closest to `rgb` (squared RGB distance), cached. */
export function nearestColor(palette: readonly number[], cache = new Map<number, number>()) {
  return (rgb: number): number => {
    const hit = cache.get(rgb);
    if (hit !== undefined) return hit;
    let best = 0;
    let bestDist = Infinity;
    const r = (rgb >> 16) & 255;
    const g = (rgb >> 8) & 255;
    const b = rgb & 255;
    for (let i = 0; i < palette.length; i++) {
      const c = palette[i];
      const dr = ((c >> 16) & 255) - r;
      const dg = ((c >> 8) & 255) - g;
      const db = (c & 255) - b;
      const dist = dr * dr + dg * dg + db * db;
      if (dist < bestDist) {
        bestDist = dist;
        best = i;
        if (dist === 0) break;
      }
    }
    cache.set(rgb, best);
    return best;
  };
}
