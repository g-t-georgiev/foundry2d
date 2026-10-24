import { GridLayer } from "./GridLayer";

export interface DocumentOptions<TArray extends Uint32Array | Int32Array> {
  width: number;
  height: number;
  emptyValue: number;
  bufferCtor: new (size: number) => TArray;
}

export class GridDocument<TArray extends Uint32Array | Int32Array = Uint32Array> {
  public width: number;
  public height: number;
  public layers: GridLayer<TArray>[] = [];
  public activeLayerId: string | null = null;
  private layerIdCounter = 0;

  constructor(public readonly options: DocumentOptions<TArray>) {
    this.width = options.width;
    this.height = options.height;
  }

  addLayer(name?: string, visible = true): GridLayer<TArray> {
    const id = `layer_${++this.layerIdCounter}`;
    const layer = new GridLayer<TArray>(
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

  getActiveLayer(): GridLayer<TArray> | undefined {
    return this.layers.find((l) => l.id === this.activeLayerId) || this.layers[0];
  }

  getLayer(id: string): GridLayer<TArray> | undefined {
    return this.layers.find((l) => l.id === id);
  }

  resize(newWidth: number, newHeight: number): void {
    this.width = newWidth;
    this.height = newHeight;
    for (const layer of this.layers) {
      layer.resize(newWidth, newHeight);
    }
  }
}
