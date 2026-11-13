import type { ICommand } from "./types";
import type { CellBuffer, GridDocument } from "../document";

export class MoveLayerCommand<Buffer extends CellBuffer = CellBuffer> implements ICommand {
  public readonly label = "Reorder layers";

  constructor(
    private readonly doc: GridDocument<Buffer>,
    private readonly fromIndex: number,
    private readonly toIndex: number
  ) {}

  execute(): void {
    this.doc.moveLayer(this.fromIndex, this.toIndex);
  }

  undo(): void {
    this.doc.moveLayer(this.toIndex, this.fromIndex);
  }
}
