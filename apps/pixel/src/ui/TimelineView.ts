import type { Sprite } from "../model/Sprite";
import { FrameCompositor, fitScale } from "./frameRendering";

export interface TimelineHooks {
  select(index: number): void;
  add(): void;
  duplicate(): void;
  remove(): void;
  move(direction: "left" | "right"): void;
  /** `null` = use the sprite FPS. */
  setDuration(ms: number | null): void;
  setFps(fps: number): void;
  setOnionSkin(enabled: boolean): void;
}

const THUMB = 48;

/**
 * Frame strip under the canvas: thumbnails, frame actions, the selected
 * frame's duration, the sprite FPS and the onion-skin toggle.
 */
export default class TimelineView {
  private readonly list: HTMLElement;
  private readonly durationInput: HTMLInputElement;
  private readonly fpsInput: HTMLInputElement;
  private readonly onion: HTMLInputElement;
  private readonly compositor = new FrameCompositor();
  private sprite: Sprite | null = null;
  private pendingThumbs = new Set<number>();
  private rafId = 0;

  constructor(
    root: HTMLElement,
    private readonly hooks: TimelineHooks
  ) {
    const $ = <T extends Element>(sel: string) => root.querySelector<T>(sel)!;
    this.list = $("#framesList");
    this.durationInput = $("#frameDuration");
    this.fpsInput = $("#spriteFps");
    this.onion = $("#onionSkin");

    root.querySelector(".timeline-rail")!.addEventListener("click", (ev) => {
      const button = (ev.target as Element).closest<HTMLButtonElement>("[data-frame-action]");
      if (!button || button.disabled) return;
      switch (button.dataset.frameAction) {
        case "add":
          hooks.add();
          break;
        case "duplicate":
          hooks.duplicate();
          break;
        case "delete":
          hooks.remove();
          break;
        case "left":
          hooks.move("left");
          break;
        case "right":
          hooks.move("right");
          break;
      }
    });
    this.list.addEventListener("click", (ev) => {
      const item = (ev.target as Element).closest<HTMLElement>("[data-index]");
      if (item) hooks.select(Number(item.dataset.index));
    });
    this.durationInput.addEventListener("change", () => {
      const raw = this.durationInput.value.trim();
      const ms = Number(raw);
      hooks.setDuration(raw === "" || !(ms > 0) ? null : ms);
    });
    this.fpsInput.addEventListener("change", () => {
      const fps = Number(this.fpsInput.value);
      if (fps >= 1 && fps <= 60) hooks.setFps(fps);
      else if (this.sprite) this.fpsInput.value = String(this.sprite.fps);
    });
    this.onion.addEventListener("change", () => hooks.setOnionSkin(this.onion.checked));
  }

  render(sprite: Sprite, onionSkin: boolean): void {
    this.sprite = sprite;
    const current = sprite.currentIndex;
    const items = sprite.frames.map((frame, index) => {
      const item = document.createElement("button");
      item.className = "frame";
      item.dataset.index = String(index);
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", String(index === current));
      item.title = `Frame ${index + 1} · ${sprite.frameDuration(index)} ms`;

      const canvas = document.createElement("canvas");
      canvas.className = "frame-thumb";
      const label = document.createElement("span");
      label.className = "frame-label";
      label.textContent = `${index + 1}`;
      const time = document.createElement("span");
      time.className = "frame-time";
      time.textContent = frame.duration === null ? "" : `${frame.duration}ms`;
      item.append(canvas, label, time);
      return item;
    });
    this.list.replaceChildren(...items);
    this.compositor.prune(sprite.frames);
    sprite.frames.forEach((_, i) => this.pendingThumbs.add(i));
    this.scheduleThumbs();
    items[current]?.scrollIntoView({ block: "nearest", inline: "nearest" });

    const frame = sprite.current;
    const duration = frame.duration === null ? "" : String(frame.duration);
    if (document.activeElement !== this.durationInput) this.durationInput.value = duration;
    this.durationInput.placeholder = `${sprite.frameDuration(current)} (auto)`;
    if (document.activeElement !== this.fpsInput) this.fpsInput.value = String(sprite.fps);
    this.onion.checked = onionSkin;

    const set = (action: string, enabled: boolean) => {
      const button = document.querySelector<HTMLButtonElement>(`[data-frame-action="${action}"]`);
      if (button) button.disabled = !enabled;
    };
    set("delete", sprite.frames.length > 1);
    set("left", current > 0);
    set("right", current < sprite.frames.length - 1);
  }

  /** Redraws one thumbnail (or all) on the next animation frame. */
  invalidateThumb(index: number | "all"): void {
    if (!this.sprite) return;
    if (index === "all") this.sprite.frames.forEach((_, i) => this.pendingThumbs.add(i));
    else this.pendingThumbs.add(index);
    this.scheduleThumbs();
  }

  private scheduleThumbs(): void {
    if (this.rafId) return;
    this.rafId = requestAnimationFrame(() => {
      this.rafId = 0;
      this.drawThumbs();
    });
  }

  private drawThumbs(): void {
    const sprite = this.sprite;
    if (!sprite) return;
    const dpr = window.devicePixelRatio || 1;
    const canvases = this.list.querySelectorAll<HTMLCanvasElement>(".frame-thumb");
    const scale = fitScale(sprite.width, sprite.height, THUMB, THUMB);
    const w = Math.max(1, Math.round(sprite.width * scale));
    const h = Math.max(1, Math.round(sprite.height * scale));
    for (const index of this.pendingThumbs) {
      const canvas = canvases[index];
      const frame = sprite.frames[index];
      if (!canvas || !frame) continue;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      const ctx = canvas.getContext("2d");
      if (!ctx) continue;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      this.compositor.draw(ctx, frame, 0, 0, canvas.width, canvas.height);
    }
    this.pendingThumbs.clear();
  }
}
