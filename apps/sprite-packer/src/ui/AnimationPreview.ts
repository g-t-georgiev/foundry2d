import type { RgbaImage } from "@foundry2d/atlas";
import { toCanvas } from "../export";

export interface PreviewFrame {
  image: RgbaImage;
  pivot?: { x: number; y: number };
}

export interface PreviewClip {
  name: string;
  frames: PreviewFrame[];
}

/**
 * Plays animations at the project's frame rate. Frames are lined up by
 * their pivot (the centre when none is set), like an engine shows them.
 */
export class AnimationPreview {
  private clips: PreviewClip[] = [];
  private canvases = new Map<RgbaImage, HTMLCanvasElement>();
  private fps = 10;
  private frame = 0;
  private playing = true;
  private timer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly select: HTMLSelectElement,
    private readonly toggle: HTMLButtonElement
  ) {
    select.addEventListener("change", () => this.restart());
    toggle.addEventListener("click", () => {
      this.playing = !this.playing;
      this.renderToggle();
      this.schedule();
    });
    this.renderToggle();
  }

  /** Shows these clips, keeping the chosen one when it is still there. */
  setClips(clips: PreviewClip[], fps: number): void {
    const chosen = this.select.value;
    this.clips = clips;
    this.fps = fps;
    const used = new Set(clips.flatMap((c) => c.frames.map((f) => f.image)));
    for (const image of this.canvases.keys()) if (!used.has(image)) this.canvases.delete(image);
    this.select.replaceChildren(
      ...clips.map((c) => new Option(`${c.name} (${c.frames.length})`, c.name))
    );
    if (clips.some((c) => c.name === chosen)) this.select.value = chosen;
    this.restart();
  }

  private get clip(): PreviewClip | undefined {
    return this.clips.find((c) => c.name === this.select.value);
  }

  private restart(): void {
    this.frame = 0;
    this.draw();
    this.schedule();
  }

  private schedule(): void {
    clearTimeout(this.timer);
    const clip = this.clip;
    if (!this.playing || !clip || clip.frames.length < 2) return;
    this.timer = setTimeout(() => {
      this.frame = (this.frame + 1) % clip.frames.length;
      this.draw();
      this.schedule();
    }, 1000 / this.fps);
  }

  private draw(): void {
    const { canvas, clip } = this;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    canvas.width = canvas.clientWidth * devicePixelRatio;
    canvas.height = canvas.clientHeight * devicePixelRatio;
    const frame = clip?.frames[this.frame];
    if (!clip || !frame) return;
    // Room every frame needs around the shared pivot point.
    const box = { left: 0, top: 0, right: 0, bottom: 0 };
    const pivotOf = (f: PreviewFrame) => ({
      x: (f.pivot?.x ?? 0.5) * f.image.width,
      y: (f.pivot?.y ?? 0.5) * f.image.height,
    });
    for (const f of clip.frames) {
      const p = pivotOf(f);
      box.left = Math.max(box.left, p.x);
      box.top = Math.max(box.top, p.y);
      box.right = Math.max(box.right, f.image.width - p.x);
      box.bottom = Math.max(box.bottom, f.image.height - p.y);
    }
    const width = box.left + box.right;
    const height = box.top + box.bottom;
    const fit = Math.min((canvas.width - 8) / width, (canvas.height - 8) / height);
    const scale = fit >= 1 ? Math.floor(fit) : fit;
    const p = pivotOf(frame);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      this.canvasFor(frame.image),
      Math.round((canvas.width - width * scale) / 2 + (box.left - p.x) * scale),
      Math.round((canvas.height - height * scale) / 2 + (box.top - p.y) * scale),
      frame.image.width * scale,
      frame.image.height * scale
    );
  }

  private canvasFor(image: RgbaImage): HTMLCanvasElement {
    let canvas = this.canvases.get(image);
    if (!canvas) this.canvases.set(image, (canvas = toCanvas(image)));
    return canvas;
  }

  private renderToggle(): void {
    this.toggle.textContent = this.playing ? "Pause" : "Play";
    this.toggle.setAttribute("aria-pressed", String(this.playing));
  }
}
