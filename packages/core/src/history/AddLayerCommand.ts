import type { ICommand } from "./types";
import type { AddLayerOptions, CellBuffer, GridDocument, GridLayer } from "../document";

export class AddLayerCommand<Buffer extends CellBuffer = CellBuffer> implements ICommand {
  public readonly label = "Add layer";
  private layer: GridLayer<Buffer> | null = null;
  private prevActiveId: string | null = null;

  constructor(
    private readonly doc: GridDocument<Buffer>,
    private readonly options: AddLayerOptions = {}
  ) {}

  /** The created layer (available after the first `execute`). */
  get createdLayer(): GridLayer<Buffer> | null {
    return this.layer;
  }

  execute(): void {
    this.prevActiveId = this.doc.activeLayerId;
    const index = this.options.index ?? this.doc.layers.length;
    const activate = this.options.activate ?? true;
    if (this.layer) {
      this.doc.insertLayer(this.layer, index, activate);
    } else {
      this.layer = this.doc.addLayer({ ...this.options, index, activate });
    }
  }

  undo(): void {
    if (!this.layer) return;
    this.doc.removeLayer(this.layer.id, true);
    this.doc.setActiveLayer(this.prevActiveId);
  }
}
