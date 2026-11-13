import type { CellBuffer, CellBufferCtor, CellChange } from "./types";

export interface GridLayerOptions<Buffer extends CellBuffer> {
  id: string;
  name: string;
  width: number;
  height: number;
  emptyValue: number;
  bufferCtor: CellBufferCtor<Buffer>;
  visible?: boolean;
  locked?: boolean;
  opacity?: number;
  /** Optional initial cell data; copied, must be `width * height` long. */
  data?: ArrayLike<number>;
}

/**
 * A dense 2D grid of numeric cells backed by a typed array.
 *
 * Every mutation bumps `version`, which renderers use to know when a cached
 * bitmap of the layer is stale.
 */
export class GridLayer<Buffer extends CellBuffer = CellBuffer> {
  public readonly id: string;
  public name: string;
  public width: number;
  public height: number;
  public readonly emptyValue: number;
  public opacity: number;
  public visible: boolean;
  public locked: boolean;
  public data: Buffer;
  /** Monotonic counter bumped on every content change. */
  public version = 0;

  private readonly bufferCtor: CellBufferCtor<Buffer>;

  constructor(options: GridLayerOptions<Buffer>) {
    this.id = options.id;
    this.name = options.name;
    this.width = options.width;
    this.height = options.height;
    this.emptyValue = options.emptyValue;
    this.bufferCtor = options.bufferCtor;
    this.visible = options.visible ?? true;
    this.locked = options.locked ?? false;
    this.opacity = options.opacity ?? 1;
    this.data = this.allocate(this.width, this.height);

    if (options.data) {
      if (options.data.length !== this.data.length) {
        throw new RangeError(
          `Layer data length ${options.data.length} does not match ${this.width}x${this.height}`
        );
      }
      this.data.set(options.data);
    }
  }

  /** Whether tools are allowed to modify this layer. */
  get isEditable(): boolean {
    return this.visible && !this.locked && this.opacity > 0.001;
  }

  isWithinBounds(x: number, y: number): boolean {
    return x >= 0 && x < this.width && y >= 0 && y < this.height;
  }

  getIndex(x: number, y: number): number {
    return y * this.width + x;
  }

  get(x: number, y: number): number {
    if (!this.isWithinBounds(x, y)) return this.emptyValue;
    return this.data[this.getIndex(x, y)];
  }

  /** Sets a cell. Returns `true` when the value actually changed. */
  set(x: number, y: number, value: number): boolean {
    if (!this.isWithinBounds(x, y)) return false;
    const index = this.getIndex(x, y);
    if (this.data[index] === value) return false;
    this.data[index] = value;
    this.version++;
    return true;
  }

  /** Applies a list of changes, using either their new or old values. */
  applyChanges(changes: readonly CellChange<number>[], direction: "forward" | "backward"): void {
    for (const change of changes) {
      const value = direction === "forward" ? change.newValue : change.oldValue;
      if (this.isWithinBounds(change.x, change.y)) {
        this.data[this.getIndex(change.x, change.y)] = value;
      }
    }
    if (changes.length > 0) this.version++;
  }

  /**
   * Resizes the layer. Existing content is kept relative to the new origin:
   * `offsetX/offsetY` shift old content right/down (use negative values to crop
   * from the left/top, e.g. when growing or shrinking a level on its left edge).
   */
  resize(newWidth: number, newHeight: number, offsetX = 0, offsetY = 0): void {
    const oldWidth = this.width;
    const oldHeight = this.height;
    const oldData = this.data;

    this.width = newWidth;
    this.height = newHeight;
    this.data = this.allocate(newWidth, newHeight);

    for (let y = 0; y < oldHeight; y++) {
      const ny = y + offsetY;
      if (ny < 0 || ny >= newHeight) continue;
      for (let x = 0; x < oldWidth; x++) {
        const nx = x + offsetX;
        if (nx < 0 || nx >= newWidth) continue;
        this.data[ny * newWidth + nx] = oldData[y * oldWidth + x];
      }
    }
    this.version++;
  }

  /** Replaces the whole buffer (used by undo of destructive operations). */
  restore(width: number, height: number, data: Buffer): void {
    this.width = width;
    this.height = height;
    this.data = data;
    this.version++;
  }

  /** Returns a detached copy of the current buffer. */
  snapshot(): Buffer {
    return this.data.slice() as Buffer;
  }

  /** Clears all cells, returning the changes so they can be undone. */
  clear(): CellChange<number>[] {
    const changes: CellChange<number>[] = [];
    for (let i = 0; i < this.data.length; i++) {
      const val = this.data[i];
      if (val !== this.emptyValue) {
        changes.push({
          x: i % this.width,
          y: Math.floor(i / this.width),
          oldValue: val,
          newValue: this.emptyValue,
        });
        this.data[i] = this.emptyValue;
      }
    }
    if (changes.length > 0) this.version++;
    return changes;
  }

  isEmpty(): boolean {
    for (let i = 0; i < this.data.length; i++) {
      if (this.data[i] !== this.emptyValue) return false;
    }
    return true;
  }

  private allocate(width: number, height: number): Buffer {
    const buffer = new this.bufferCtor(width * height);
    if (this.emptyValue !== 0) buffer.fill(this.emptyValue);
    return buffer;
  }
}
