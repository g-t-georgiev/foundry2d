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
    private readonly newValue: GridLayer<Buffer>[K]
  ) {
    this.label = `Change layer ${property}`;
  }

  execute(): void {
    const layer = this.doc.getLayer(this.layerId);
    if (!layer) return;
    this.oldValue = layer[this.property];
    this.doc.setLayerProperty(this.layerId, this.property, this.newValue);
  }

  undo(): void {
    if (this.oldValue === undefined) return;
    this.doc.setLayerProperty(this.layerId, this.property, this.oldValue);
  }
}
