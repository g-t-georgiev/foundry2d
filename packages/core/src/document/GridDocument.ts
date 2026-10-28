import { GridLayer } from "./GridLayer";

export interface DocumentOptions<Buffer extends Uint32Array | Int32Array> {
  width: number;
  height: number;
  emptyValue: number;
  bufferCtor: new (size: number) => Buffer;
}

export class GridDocument<Buffer extends Uint32Array | Int32Array = Uint32Array> {
  public width: number;
  public height: number;
  public layers: GridLayer<Buffer>[] = [];
  public activeLayerId: string | null = null;
  private layerIdCounter = 0;

  constructor(public readonly options: DocumentOptions<Buffer>) {
    this.width = options.width;
    this.height = options.height;
  }

  public addLayer(name?: string, visible = true): GridLayer<Buffer> {
    const id = `layer_${++this.layerIdCounter}`;
    const layer = new GridLayer<Buffer>(
      id,
      name || `Layer ${this.layerIdCounter}`,
      this.width,
      this.height,
      this.options.emptyValue,
      this.options.bufferCtor,
      visible
    );
    this.layers.push(layer);
    if (!this.activeLayerId) this.activeLayerId = id;
    return layer;
  }

  public getActiveLayer(): GridLayer<Buffer> | undefined {
    return this.layers.find((l) => l.id === this.activeLayerId) || this.layers[0];
  }

  public getLayer(id: string): GridLayer<Buffer> | undefined {
    return this.layers.find((l) => l.id === id);
  }

  public resize(newWidth: number, newHeight: number): void {
    this.width = newWidth;
    this.height = newHeight;
    for (const layer of this.layers) {
      layer.resize(newWidth, newHeight);
    }
  }

  /**
   * Internal invariant: Deleting a layer must guarantee that:
   * 1. At least 1 layer remains.
   * 2. If the active layer is deleted, an adjacent layer is automatically selected.
   */
  public removeLayer(
    id: string
  ): { removedLayer: GridLayer<Buffer>; newActiveId: string; index: number } | null {
    if (this.layers.length <= 1) {
      console.warn("Invariant violation: Cannot delete the only remaining layer.");
      return null;
    }

    const index = this.layers.findIndex((l) => l.id === id);
    if (index === -1) return null;

    const [removedLayer] = this.layers.splice(index, 1);

    // If the active layer was deleted, select an adjacent layer
    if (this.activeLayerId === id) {
      const nextIndex = Math.min(index, this.layers.length - 1);
      this.activeLayerId = this.layers[nextIndex].id;
    }

    return { removedLayer, newActiveId: this.activeLayerId!, index };
  }

  /** Inserts a layer back at a specific index */
  public insertLayer(layer: GridLayer<Buffer>, index: number): void {
    this.layers.splice(index, 0, layer);
    this.activeLayerId = layer.id;
  }
}
