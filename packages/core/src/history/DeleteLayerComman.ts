import type { GridDocument, GridLayer } from "../document";
import type { ICommand } from "./types";

export class DeleteLayerCommand<Buffer extends Uint32Array | Int32Array> implements ICommand {
  private prevActiveId: string | null = null;
  private removedLayer: GridLayer<Buffer> | null = null;
  private originalIndex: number = -1;

  constructor(
    private doc: GridDocument<Buffer>,
    private layerId: string,
    private onStateChange?: () => void
  ) {}

  execute(): void {
    this.prevActiveId = this.doc.activeLayerId;
    const deleted = this.doc.removeLayer(this.layerId);

    if (!deleted) return;

    this.originalIndex = deleted.index;
    this.removedLayer = deleted.removedLayer;
    this.onStateChange?.();
  }

  undo(): void {
    if (!this.removedLayer || this.originalIndex === -1) return;

    this.doc.insertLayer(this.removedLayer, this.originalIndex);

    if (this.prevActiveId) {
      this.doc.activeLayerId = this.prevActiveId;
    }

    this.onStateChange?.();
  }
}
