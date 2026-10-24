import type { ICommand } from "./HistoryManager";
import type { GridLayer, CellChange } from "../document/GridLayer";

export class DrawCommand<TArray extends Uint32Array | Int32Array> implements ICommand {
  constructor(
    private layer: GridLayer<TArray>,
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
