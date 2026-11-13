import type { ICommand } from "./types";
import type { CellBuffer, GridDocument, GridLayer } from "../document";

export class DeleteLayerCommand<Buffer extends CellBuffer = CellBuffer> implements ICommand {
  public readonly label = "Delete layer";
  private prevActiveId: string | null = null;
  private removedLayer: GridLayer<Buffer> | null = null;
  private originalIndex = -1;

  constructor(
    private readonly doc: GridDocument<Buffer>,
    private readonly layerId: string
  ) {}

  /** False when the delete was refused (e.g. the last remaining layer). Check before recording. */
  get succeeded(): boolean {
    return this.removedLayer !== null;
  }

  execute(): void {
    this.prevActiveId = this.doc.activeLayerId;
    const deleted = this.doc.removeLayer(this.layerId);
    if (!deleted) {
      this.removedLayer = null;
      return;
    }
    this.originalIndex = deleted.index;
    this.removedLayer = deleted.removedLayer;
  }

  undo(): void {
    if (!this.removedLayer || this.originalIndex === -1) return;
    this.doc.insertLayer(this.removedLayer, this.originalIndex, false);
    this.doc.setActiveLayer(this.prevActiveId);
  }
}
