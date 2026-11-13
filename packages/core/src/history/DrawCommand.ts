import type { ICommand } from "./types";
import type { CellBuffer, CellChange, GridDocument } from "../document";

/** Cell edits on a single layer. Usually recorded after the stroke has already been applied. */
export class DrawCommand<Buffer extends CellBuffer = CellBuffer> implements ICommand {
  constructor(
    private readonly doc: GridDocument<Buffer>,
    private readonly layerId: string,
    private readonly changes: CellChange<number>[],
    public readonly label = "Draw"
  ) {}

  execute(): void {
    this.apply("forward");
  }

  undo(): void {
    this.apply("backward");
  }

  private apply(direction: "forward" | "backward"): void {
    const layer = this.doc.getLayer(this.layerId);
    if (!layer) return;
    layer.applyChanges(this.changes, direction);
    this.doc.notifyCellsChanged(this.layerId);
  }
}
