import { EventEmitter, GridDocument } from "@foundry2d/core";

export type PixelDocument = GridDocument<Uint32Array>;

export interface Frame {
  readonly id: string;
  doc: PixelDocument;
  /** Display time in ms; `null` uses the sprite's FPS. */
  duration: number | null;
}

export type SpriteEventMap = {
  /** Frames were added, removed, reordered or retimed. */
  "frames:changed": () => void;
  /** Another frame became current. */
  "frame:selected": (payload: { index: number }) => void;
  /** FPS changed. */
  "settings:changed": () => void;
  /** The whole sprite was replaced (New/Open). */
  replaced: () => void;
};

export const DEFAULT_FPS = 8;

/**
 * An animated sprite: frames that all share the same layer structure (Piskel
 * model). Each frame owns a `GridDocument`; layer edits are applied to every
 * frame by the sprite-wide commands in `commands.ts`.
 */
export class Sprite {
  readonly events = new EventEmitter<SpriteEventMap>();
  frames: Frame[] = [];
  fps = DEFAULT_FPS;
  private index = 0;
  private frameCounter = 0;
  private layerCounter = 0;

  /** A blank sprite with one frame and one layer. */
  static create(width: number, height: number): Sprite {
    const sprite = new Sprite();
    const doc = Sprite.emptyDocument(width, height);
    doc.addLayer({ id: sprite.nextLayerId(), name: "Layer 1" });
    sprite.frames = [{ id: sprite.nextFrameId(), doc, duration: null }];
    return sprite;
  }

  static emptyDocument(width: number, height: number): PixelDocument {
    return new GridDocument<Uint32Array>({
      width,
      height,
      emptyValue: 0x00000000,
      bufferCtor: Uint32Array,
    });
  }

  /** Builds a sprite from existing frame documents (they must share layer ids). */
  static fromFrames(
    frames: { doc: PixelDocument; duration: number | null }[],
    fps = DEFAULT_FPS
  ): Sprite {
    if (frames.length === 0) throw new Error("A sprite needs at least one frame");
    const sprite = new Sprite();
    sprite.fps = fps;
    sprite.frames = frames.map((f) => ({ ...f, id: sprite.nextFrameId() }));
    return sprite;
  }

  get currentIndex(): number {
    return this.index;
  }

  get current(): Frame {
    return this.frames[this.index];
  }

  /** The document being edited. */
  get doc(): PixelDocument {
    return this.current.doc;
  }

  get width(): number {
    return this.frames[0].doc.width;
  }

  get height(): number {
    return this.frames[0].doc.height;
  }

  /** Effective duration of a frame in ms. */
  frameDuration(index: number): number {
    return this.frames[index]?.duration ?? Math.round(1000 / this.fps);
  }

  nextFrameId(): string {
    return `frame_${++this.frameCounter}`;
  }

  /** A layer id unused in every frame. */
  nextLayerId(): string {
    let id: string;
    do id = `layer_${++this.layerCounter}`;
    while (this.frames.some((f) => f.doc.getLayer(id)));
    return id;
  }

  selectFrame(index: number): void {
    const next = Math.max(0, Math.min(index, this.frames.length - 1));
    if (next === this.index) return;
    // Keep working on the same layer when switching frames.
    const activeLayer = this.doc.activeLayerId;
    this.index = next;
    if (activeLayer) this.doc.setActiveLayer(activeLayer);
    this.events.emit("frame:selected", { index: next });
  }

  /** A new frame with the same layers as the current one, blank or copied from `copyOf`. */
  createFrame(copyOf: number | null = null): Frame {
    const template = this.frames[copyOf ?? this.index].doc;
    const doc = Sprite.emptyDocument(template.width, template.height);
    for (const layer of template.layers) {
      doc.addLayer({
        id: layer.id,
        name: layer.name,
        visible: layer.visible,
        opacity: layer.opacity,
        locked: layer.locked,
        data: copyOf === null ? undefined : layer.data,
        activate: false,
      });
    }
    doc.setActiveLayer(template.activeLayerId);
    return {
      id: this.nextFrameId(),
      doc,
      duration: copyOf === null ? null : this.frames[copyOf].duration,
    };
  }

  insertFrame(frame: Frame, index: number): void {
    const at = Math.max(0, Math.min(index, this.frames.length));
    this.frames.splice(at, 0, frame);
    this.events.emit("frames:changed");
    this.selectFrameForce(at);
  }

  /** Removes a frame (at least one stays). Returns the removed frame or null. */
  removeFrame(index: number): Frame | null {
    if (this.frames.length <= 1 || index < 0 || index >= this.frames.length) return null;
    const [removed] = this.frames.splice(index, 1);
    this.events.emit("frames:changed");
    this.selectFrameForce(Math.min(this.index, this.frames.length - 1));
    return removed;
  }

  moveFrame(from: number, to: number): boolean {
    const n = this.frames.length;
    if (from === to || from < 0 || to < 0 || from >= n || to >= n) return false;
    const current = this.current;
    const [frame] = this.frames.splice(from, 1);
    this.frames.splice(to, 0, frame);
    this.index = this.frames.indexOf(current);
    this.events.emit("frames:changed");
    this.events.emit("frame:selected", { index: this.index });
    return true;
  }

  setFrameDuration(index: number, duration: number | null): void {
    const frame = this.frames[index];
    if (!frame || frame.duration === duration) return;
    frame.duration = duration === null ? null : Math.max(10, Math.round(duration));
    this.events.emit("frames:changed");
  }

  setFps(fps: number): void {
    const next = Math.max(1, Math.min(60, Math.round(fps)));
    if (next === this.fps) return;
    this.fps = next;
    this.events.emit("settings:changed");
  }

  /** Swaps in another sprite's contents, keeping this instance (and listeners). */
  replaceWith(other: Sprite): void {
    this.frames = other.frames;
    this.fps = other.fps;
    this.index = 0;
    this.frameCounter = Math.max(this.frameCounter, other.frameCounter);
    this.layerCounter = Math.max(this.layerCounter, other.layerCounter);
    this.events.emit("replaced");
    this.events.emit("frames:changed");
    this.events.emit("frame:selected", { index: 0 });
  }

  private selectFrameForce(index: number): void {
    const activeLayer = this.frames[this.index]?.doc.activeLayerId ?? null;
    this.index = index;
    if (activeLayer) this.doc.setActiveLayer(activeLayer);
    this.events.emit("frame:selected", { index });
  }
}
