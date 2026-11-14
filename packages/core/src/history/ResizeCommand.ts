import type { ICommand } from "./types";
import type { CellBuffer, GridDocument } from "../document";
import type { Dimensions, Position } from "../types";

/**
 * Resizes a document. Snapshots every layer first, so shrinking and then
 * undoing restores the cropped content (a plain resize back would lose it).
 */
export class ResizeCommand<Buffer extends CellBuffer = CellBuffer> implements ICommand {
  public readonly label = "Resize";
  private before: {
    size: Dimensions;
    layers: Map<string, { width: number; height: number; data: Buffer }>;
  } | null = null;

  constructor(
    private readonly doc: GridDocument<Buffer>,
    private readonly newSize: Dimensions,
    /** Shift applied to existing content (e.g. growing on the left/top edge). */
    private readonly offset: Position = { x: 0, y: 0 }
  ) {}

  execute(): void {
    this.before = {
      size: { width: this.doc.width, height: this.doc.height },
      layers: new Map(
        this.doc.layers.map((l) => [l.id, { width: l.width, height: l.height, data: l.snapshot() }])
      ),
    };
    this.doc.resize(this.newSize.width, this.newSize.height, this.offset.x, this.offset.y);
  }

  undo(): void {
    if (!this.before) return;
    const { size, layers } = this.before;
    this.doc.width = size.width;
    this.doc.height = size.height;
    for (const layer of this.doc.layers) {
      const saved = layers.get(layer.id);
      if (saved) layer.restore(saved.width, saved.height, saved.data.slice() as Buffer);
      else {
        const fit = this.doc.layerSize(layer.scale);
        layer.resize(fit.width, fit.height);
      }
    }
    this.doc.events.emit("resized", { width: size.width, height: size.height });
  }
}
