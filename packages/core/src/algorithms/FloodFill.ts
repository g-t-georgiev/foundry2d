import type { GridLayer, CellChange } from "../document/GridLayer";

export class FloodFill {
  static execute<TArray extends Uint32Array | Int32Array>(
    layer: GridLayer<TArray>,
    startX: number,
    startY: number,
    fillValue: number
  ): CellChange<number>[] {
    if (!layer.isWithinBounds(startX, startY)) return [];
    const targetValue = layer.get(startX, startY);
    if (targetValue === fillValue) return [];

    const width = layer.width;
    const height = layer.height;
    const affected: CellChange<number>[] = [];
    const stack: number[] = [startX, startY];

    while (stack.length > 0) {
      const y = stack.pop()!;
      const x = stack.pop()!;
      let currentX = x;

      while (currentX >= 0 && layer.get(currentX, y) === targetValue) {
        currentX--;
      }
      currentX++;

      let spanAbove = false;
      let spanBelow = false;

      while (currentX < width && layer.get(currentX, y) === targetValue) {
        layer.set(currentX, y, fillValue);
        affected.push({ x: currentX, y, oldValue: targetValue, newValue: fillValue });

        if (y > 0) {
          const above = layer.get(currentX, y - 1);
          if (!spanAbove && above === targetValue) {
            stack.push(currentX, y - 1);
            spanAbove = true;
          } else if (spanAbove && above !== targetValue) {
            spanAbove = false;
          }
        }

        if (y < height - 1) {
          const below = layer.get(currentX, y + 1);
          if (!spanBelow && below === targetValue) {
            stack.push(currentX, y + 1);
            spanBelow = true;
          } else if (spanBelow && below !== targetValue) {
            spanBelow = false;
          }
        }
        currentX++;
      }
    }
    return affected;
  }
}
