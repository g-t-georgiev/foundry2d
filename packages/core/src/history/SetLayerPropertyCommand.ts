import type { GridDocument, GridLayer, AllowedLayerKeys } from "../document";
import type { ICommand } from "./types";

export class SetLayerPropertyCommand<
  Buffer extends Uint32Array | Int32Array,
  K extends AllowedLayerKeys<GridLayer<Buffer>>,
> implements ICommand {
  private oldValue!: GridLayer<Buffer>[K];

  constructor(
    private doc: GridDocument<Buffer>,
    private layerId: string,
    private property: K,
    private newValue: GridLayer<Buffer>[K],
    private onStateChange?: () => void | null
  ) {}

  execute(): void {
    const layer = this.doc.getLayer(this.layerId);
    if (!layer) return;

    this.oldValue = layer[this.property];
    layer[this.property] = this.newValue;
    this.onStateChange?.();
  }

  undo(): void {
    const layer = this.doc.getLayer(this.layerId);
    if (!layer) return;

    layer[this.property] = this.oldValue;
    this.onStateChange?.();
  }
}
