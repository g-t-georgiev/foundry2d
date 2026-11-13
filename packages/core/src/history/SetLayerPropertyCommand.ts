import type { ICommand } from "./types";
import type { CellBuffer, EditableLayerProperties, GridDocument, GridLayer } from "../document";

export class SetLayerPropertyCommand<
  Buffer extends CellBuffer,
  K extends EditableLayerProperties,
> implements ICommand {
  public readonly label: string;
  private oldValue: GridLayer<Buffer>[K] | undefined;

  constructor(
    private readonly doc: GridDocument<Buffer>,
    private readonly layerId: string,
    private readonly property: K,
    private readonly newValue: GridLayer<Buffer>[K],
    /**
     * Value to restore on undo. Pass it when the property was already
     * previewed live (e.g. while dragging an opacity slider); otherwise the
     * current value is captured on the first execute.
     */
    previousValue?: GridLayer<Buffer>[K]
  ) {
    this.label = `Change layer ${property}`;
    this.oldValue = previousValue;
  }

  execute(): void {
    const layer = this.doc.getLayer(this.layerId);
    if (!layer) return;
    if (this.oldValue === undefined) this.oldValue = layer[this.property];
    this.doc.setLayerProperty(this.layerId, this.property, this.newValue);
  }

  undo(): void {
    if (this.oldValue === undefined) return;
    this.doc.setLayerProperty(this.layerId, this.property, this.oldValue);
  }
}
