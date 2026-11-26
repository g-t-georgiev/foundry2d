import type { Sprite } from "../model/Sprite";
import { FrameCompositor, fitScale } from "./frameRendering";

/**
 * Looping animation preview. Each frame is shown for its own duration;
 * single-frame sprites just show the image. Pausing shows the current frame.
 */
export default class AnimationPreview {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly compositor = new FrameCompositor();
  private playing = true;
  private frame = 0;
  private frameStart = 0;
  private rafId = 0;
  private dirty = true;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    private readonly sprite: Sprite,
    private readonly toggle: HTMLButtonElement | null
  ) {
    this.ctx = canvas.getContext("2d")!;
    toggle?.addEventListener("click", () => this.setPlaying(!this.playing));
    new ResizeObserver(() => this.invalidate()).observe(canvas.parentElement ?? canvas);
    this.loop = this.loop.bind(this);
    this.rafId = requestAnimationFrame(this.loop);
    this.updateToggle();
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  setPlaying(playing: boolean): void {
    this.playing = playing;
    this.frameStart = performance.now();
    this.updateToggle();
    this.invalidate();
  }

  /** Redraw on the next frame (pixels or frame list changed). */
  invalidate(): void {
    this.dirty = true;
  }

  destroy(): void {
    cancelAnimationFrame(this.rafId);
  }

  private updateToggle(): void {
    if (!this.toggle) return;
    this.toggle.textContent = this.playing ? "❚❚" : "▶";
    this.toggle.title = this.playing ? "Pause preview" : "Play preview";
    this.toggle.setAttribute("aria-label", this.toggle.title);
  }

  private loop(now: number): void {
    this.rafId = requestAnimationFrame(this.loop);
    const { sprite } = this;
    const count = sprite.frames.length;

    if (!this.playing || count === 1) {
      if (this.frame !== sprite.currentIndex) {
        this.frame = sprite.currentIndex;
        this.dirty = true;
      }
    } else {
      if (this.frame >= count) this.frame = 0;
      if (now - this.frameStart >= sprite.frameDuration(this.frame)) {
        this.frame = (this.frame + 1) % count;
        this.frameStart = now;
        this.dirty = true;
      }
    }
    if (this.dirty) this.draw();
  }

  private draw(): void {
    this.dirty = false;
    const { sprite, canvas, ctx } = this;
    const box = canvas.parentElement ?? canvas;
    const dpr = window.devicePixelRatio || 1;
    const scale = fitScale(sprite.width, sprite.height, box.clientWidth, box.clientHeight);
    const w = Math.max(1, Math.round(sprite.width * scale));
    const h = Math.max(1, Math.round(sprite.height * scale));
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    }
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const frame = sprite.frames[Math.min(this.frame, sprite.frames.length - 1)];
    this.compositor.draw(ctx, frame, 0, 0, canvas.width, canvas.height);
    this.compositor.prune(sprite.frames);
  }
}
