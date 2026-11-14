import EventEmitter from "../utils/EventEmitter";
import { GridLayer } from "./GridLayer";
import type { Rect } from "../types";
import type {
  CellBuffer,
  CellBufferCtor,
  DocumentEventMap,
  EditableLayerProperties,
  LayerChanges,
} from "./types";

export interface DocumentOptions<Buffer extends CellBuffer> {
  width: number;
  height: number;
  emptyValue: number;
  bufferCtor: CellBufferCtor<Buffer>;
}

export type LayerPolicyReason = "NO_LAYER" | "HIDDEN" | "TRANSPARENT" | "LOCKED";

export interface LayerPolicy {
  /** Drawing tools may modify the layer. */
  canDraw: boolean;
  /** Deleting keeps at least one layer. */
  canDelete: boolean;
  /** The layer is not already top-most. */
  canMoveUp: boolean;
  /** The layer is not already bottom-most. */
  canMoveDown: boolean;
  /** Why drawing is blocked, if it is. */
  reason?: LayerPolicyReason;
}

export interface AddLayerOptions {
  id?: string;
  name?: string;
  visible?: boolean;
  locked?: boolean;
  opacity?: number;
  /** Insert position; appended (top-most) when omitted. */
  index?: number;
  /** Make the new layer active. Defaults to `true` when no layer is active yet. */
  activate?: boolean;
  /** Cell size in document cells (see `GridLayer.scale`). Defaults to 1. */
  scale?: number;
  data?: ArrayLike<number>;
}

/**
 * An ordered stack of `GridLayer`s covering the same area.
 *
 * Most layers have one cell per document cell. A layer with a `scale` other
 * than 1 has bigger (or smaller) cells and so a different size in cells,
 * always enough to cover the document (see `layerSize`); LDtk calls this a
 * per-layer grid size.
 *
 * Index 0 is the bottom-most layer. All structural mutations emit events so
 * UI and renderers can stay in sync without polling.
 */
export class GridDocument<Buffer extends CellBuffer = Uint32Array> {
  public width: number;
  public height: number;
  public layers: GridLayer<Buffer>[] = [];
  public readonly events = new EventEmitter<DocumentEventMap>();
  private _activeLayerId: string | null = null;
  private layerIdCounter = 0;

  constructor(public readonly options: DocumentOptions<Buffer>) {
    this.width = options.width;
    this.height = options.height;
  }

  get activeLayerId(): string | null {
    return this._activeLayerId;
  }

  set activeLayerId(id: string | null) {
    this.setActiveLayer(id);
  }

  get emptyValue(): number {
    return this.options.emptyValue;
  }

  /**
   * Size in cells of a layer whose cells are `scale` document cells wide:
   * enough cells to cover the document (the last row and column may stick
   * out when the sizes don't divide).
   */
  public layerSize(scale = 1, width = this.width, height = this.height) {
    // The epsilon keeps float noise (e.g. 3 / 1.5) from adding a cell.
    return {
      width: Math.max(1, Math.ceil(width / scale - 1e-9)),
      height: Math.max(1, Math.ceil(height / scale - 1e-9)),
    };
  }

  /** Creates a detached layer matching this document's size and buffer type. */
  public createLayer(options: AddLayerOptions = {}): GridLayer<Buffer> {
    const counter = ++this.layerIdCounter;
    let id = options.id ?? `layer_${counter}`;
    while (this.getLayer(id)) id = `layer_${++this.layerIdCounter}`;
    const scale = options.scale ?? 1;
    const size = this.layerSize(scale);

    return new GridLayer<Buffer>({
      id,
      name: options.name ?? `Layer ${counter}`,
      width: size.width,
      height: size.height,
      scale,
      emptyValue: this.options.emptyValue,
      bufferCtor: this.options.bufferCtor,
      visible: options.visible,
      locked: options.locked,
      opacity: options.opacity,
      data: options.data,
    });
  }

  public addLayer(nameOrOptions?: string | AddLayerOptions, visible = true): GridLayer<Buffer> {
    const options: AddLayerOptions =
      typeof nameOrOptions === "string" || nameOrOptions === undefined
        ? { name: nameOrOptions, visible }
        : nameOrOptions;

    const layer = this.createLayer(options);
    const activate = options.activate ?? this._activeLayerId === null;
    this.insertLayer(layer, options.index ?? this.layers.length, activate);
    return layer;
  }

  /** Inserts an existing layer at `index` (clamped). */
  public insertLayer(layer: GridLayer<Buffer>, index: number, activate = true): void {
    const size = this.layerSize(layer.scale);
    if (layer.width !== size.width || layer.height !== size.height) {
      layer.resize(size.width, size.height);
    }
    const at = Math.max(0, Math.min(index, this.layers.length));
    this.layers.splice(at, 0, layer);
    this.events.emit("layers:changed");
    if (activate || this._activeLayerId === null) this.setActiveLayer(layer.id);
  }

  public getActiveLayer(): GridLayer<Buffer> | undefined {
    return this.layers.find((l) => l.id === this._activeLayerId) ?? this.layers[0];
  }

  public setActiveLayer(id: string | null): void {
    if (id !== null && !this.getLayer(id)) return;
    if (this._activeLayerId === id) return;
    this._activeLayerId = id;
    this.events.emit("layer:activated", { layerId: id });
  }

  public getLayer(id: string): GridLayer<Buffer> | undefined {
    return this.layers.find((l) => l.id === id);
  }

  public indexOfLayer(id: string): number {
    return this.layers.findIndex((l) => l.id === id);
  }

  public resize(newWidth: number, newHeight: number, offsetX = 0, offsetY = 0): void {
    if (newWidth < 1 || newHeight < 1) throw new RangeError("Document size must be >= 1x1");
    this.width = newWidth;
    this.height = newHeight;
    for (const layer of this.layers) {
      const size = this.layerSize(layer.scale);
      // Offsets are in document cells; scaled layers move by whole cells of their own.
      layer.resize(
        size.width,
        size.height,
        Math.round(offsetX / layer.scale),
        Math.round(offsetY / layer.scale)
      );
    }
    this.events.emit("resized", { width: newWidth, height: newHeight });
  }

  /**
   * Gives a layer another cell size. `resample` keeps the picture in place
   * at the new resolution (see `GridLayer.rescale`); otherwise cells keep
   * their indices and the layer is only cropped or extended.
   */
  public setLayerScale(layerId: string, scale: number, resample = true): boolean {
    const layer = this.getLayer(layerId);
    if (!layer) return false;
    const size = this.layerSize(scale);
    if (layer.scale === scale && layer.width === size.width && layer.height === size.height) {
      return false;
    }
    if (resample) {
      layer.rescale(scale, size.width, size.height);
    } else {
      layer.resize(size.width, size.height);
      layer.scale = scale;
    }
    this.events.emit("layer:updated", { layerId, property: "scale" });
    this.notifyCellsChanged(layerId);
    return true;
  }

  /**
   * Removes a layer. Invariants:
   * 1. At least one layer remains (unless `allowEmpty`).
   * 2. If the active layer is removed, an adjacent layer becomes active.
   */
  public removeLayer(
    id: string,
    allowEmpty = false
  ): { removedLayer: GridLayer<Buffer>; newActiveId: string | null; index: number } | null {
    if (!allowEmpty && this.layers.length <= 1) return null;

    const index = this.indexOfLayer(id);
    if (index === -1) return null;

    const [removedLayer] = this.layers.splice(index, 1);
    this.events.emit("layers:changed");

    if (this._activeLayerId === id) {
      const next = this.layers[Math.min(index, this.layers.length - 1)];
      this.setActiveLayer(next?.id ?? null);
    }

    return { removedLayer, newActiveId: this._activeLayerId, index };
  }

  /** Moves a layer from one stack index to another. Returns `false` if out of range. */
  public moveLayer(fromIndex: number, toIndex: number): boolean {
    const count = this.layers.length;
    if (fromIndex < 0 || fromIndex >= count || toIndex < 0 || toIndex >= count) return false;
    if (fromIndex === toIndex) return false;
    const [moved] = this.layers.splice(fromIndex, 1);
    this.layers.splice(toIndex, 0, moved);
    this.events.emit("layers:changed");
    return true;
  }

  public setLayerProperty<K extends EditableLayerProperties>(
    layerId: string,
    property: K,
    value: GridLayer<Buffer>[K]
  ): boolean {
    const layer = this.getLayer(layerId);
    if (!layer || layer[property] === value) return false;
    layer[property] = value;
    this.events.emit("layer:updated", { layerId, property });
    return true;
  }

  /** Clears one layer (when `layerId` is given) or all layers. Returns undoable changes. */
  public clear(layerId: string | null = null): LayerChanges {
    const targets = layerId
      ? this.layers.filter((l) => l.id === layerId)
      : this.layers.filter((l) => !l.locked);
    const result: LayerChanges = [];
    for (const layer of targets) {
      const changes = layer.clear();
      if (changes.length) {
        result.push([layer.id, changes]);
        this.notifyCellsChanged(layer.id);
      }
    }
    return result;
  }

  /**
   * What the UI may do with a layer (the active one by default). Single source
   * for disabled buttons and the canvas "not-allowed" cursor.
   */
  public getPolicy(layerId: string | null = this._activeLayerId): LayerPolicy {
    const layer = layerId ? this.getLayer(layerId) : this.getActiveLayer();
    if (!layer) {
      return {
        canDraw: false,
        canDelete: false,
        canMoveUp: false,
        canMoveDown: false,
        reason: "NO_LAYER",
      };
    }
    const index = this.indexOfLayer(layer.id);
    const multi = this.layers.length > 1;
    const reason: LayerPolicyReason | undefined = !layer.visible
      ? "HIDDEN"
      : layer.opacity <= 0.001
        ? "TRANSPARENT"
        : layer.locked
          ? "LOCKED"
          : undefined;
    return {
      canDraw: reason === undefined,
      canDelete: multi,
      canMoveUp: index < this.layers.length - 1,
      canMoveDown: index > 0,
      reason,
    };
  }

  /**
   * Replaces this document's size and layers with `source`'s, keeping this
   * instance (and every reference to it) alive. Used when opening a project.
   */
  public replaceWith(source: GridDocument<Buffer>): void {
    this.width = source.width;
    this.height = source.height;
    this.layers = source.layers.slice();
    for (const layer of this.layers) layer.version++;
    this.layerIdCounter = Math.max(this.layerIdCounter, source.layerIdCounter, this.layers.length);
    this.events.emit("resized", { width: this.width, height: this.height });
    this.events.emit("layers:changed");
    this._activeLayerId = null;
    this.setActiveLayer(source.activeLayerId ?? this.layers[0]?.id ?? null);
  }

  /**
   * Call after mutating layer cells directly (tools do this once per stroke
   * step). Pass the changed area when known, so listeners (e.g. auto-layers)
   * can update just that region.
   */
  public notifyCellsChanged(layerId: string, rect?: Rect): void {
    this.events.emit("cells:changed", rect ? { layerId, rect } : { layerId });
  }
}
