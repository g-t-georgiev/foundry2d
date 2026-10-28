import type { CellChange } from "./types";

export class GridLayer<Buffer extends Uint32Array | Int32Array> {
  public opacity: number = 1;
  public visible: boolean = true;
  public data: Buffer;

  constructor(
    public readonly id: string,
    public name: string,
    public width: number,
    public height: number,
    public readonly emptyValue: number,
    private bufferCtor: new (size: number) => Buffer,
    visible = true
  ) {
    this.visible = visible;
    this.data = new bufferCtor(width * height);
    if (emptyValue !== 0) {
      this.data.fill(emptyValue);
    }
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

  set(x: number, y: number, value: number): void {
    if (!this.isWithinBounds(x, y)) return;
    this.data[this.getIndex(x, y)] = value;
  }

  resize(newWidth: number, newHeight: number): void {
    const oldWidth = this.width;
    const oldHeight = this.height;
    const oldData = this.data;

    this.width = newWidth;
    this.height = newHeight;
    this.data = new this.bufferCtor(newWidth * newHeight);
    if (this.emptyValue !== 0) this.data.fill(this.emptyValue);

    for (let y = 0; y < Math.min(oldHeight, newHeight); y++) {
      for (let x = 0; x < Math.min(oldWidth, newWidth); x++) {
        this.data[y * newWidth + x] = oldData[y * oldWidth + x];
      }
    }
  }

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
    return changes;
  }
}
