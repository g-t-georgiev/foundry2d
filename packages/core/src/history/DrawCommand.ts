import type { ICommand } from "./types";
import type { GridLayer, CellChange } from "../document";

export class DrawCommand<Buffer extends Uint32Array | Int32Array> implements ICommand {
  constructor(
    private layer: GridLayer<Buffer>,
    private changes: CellChange<number>[]
  ) {}

  execute() {
    for (const change of this.changes) {
      this.layer.set(change.x, change.y, change.newValue);
    }
  }

  undo() {
    for (const change of this.changes) {
      this.layer.set(change.x, change.y, change.oldValue);
    }
  }
}
