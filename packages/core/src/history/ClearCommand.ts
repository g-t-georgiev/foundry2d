import type { ICommand } from "./types";
import type { CellBuffer, GridDocument, LayerChanges } from "../document";

/** Clears one layer, or every unlocked layer when no layer id is given. */
export class ClearCommand<Buffer extends CellBuffer = CellBuffer> implements ICommand {
  public readonly label = "Clear";
  private changes: LayerChanges = [];

  constructor(
    private readonly doc: GridDocument<Buffer>,
    private readonly layerId: string | null = null
  ) {}

  /** True when executing found nothing to clear (no need to record it). */
  get isNoop(): boolean {
    return this.changes.length === 0;
  }

  execute(): void {
    this.changes = this.doc.clear(this.layerId);
  }

  undo(): void {
    for (const [layerId, changes] of this.changes) {
      const layer = this.doc.getLayer(layerId);
      if (!layer) continue;
      layer.applyChanges(changes, "backward");
      this.doc.notifyCellsChanged(layerId);
    }
  }
}
