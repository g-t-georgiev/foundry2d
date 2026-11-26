import type { Camera } from "@gs2d/core";
import { defaultTheme, type PointerInfo, type RenderPass, type RenderTheme } from "./types";

export interface FrameParams {
  camera: Camera;
  viewWidth: number;
  viewHeight: number;
  devicePixelRatio: number;
  pointer: PointerInfo | null;
}

/**
 * Runs an ordered list of passes against a canvas. Owns no scene state:
 * everything a pass needs is either given at construction time or read
 * through getters, so the same renderer can switch scenes.
 */
export class Renderer {
  public readonly ctx: CanvasRenderingContext2D;
  public theme: RenderTheme;
  private passes: RenderPass[] = [];

  constructor(
    public readonly canvas: HTMLCanvasElement,
    theme: Partial<RenderTheme> = {}
  ) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context is not available");
    this.ctx = ctx;
    this.theme = { ...defaultTheme, ...theme };
  }

  /** Replaces all passes. Disposes passes that are no longer used. */
  setPasses(passes: RenderPass[]): void {
    for (const old of this.passes) {
      if (!passes.includes(old)) old.dispose?.();
    }
    this.passes = [...passes];
  }

  getPass<T extends RenderPass>(id: string): T | undefined {
    return this.passes.find((p) => p.id === id) as T | undefined;
  }

  render(frame: FrameParams): void {
    const { ctx, canvas } = this;
    const { camera, devicePixelRatio: dpr } = frame;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = this.theme.workspaceBackground;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const rc = {
      ctx,
      camera,
      viewWidth: frame.viewWidth,
      viewHeight: frame.viewHeight,
      devicePixelRatio: dpr,
      pointer: frame.pointer,
      theme: this.theme,
      time: performance.now(),
    };

    for (const pass of this.passes) {
      if (!pass.enabled) continue;
      ctx.save();
      if (pass.space === "world") {
        ctx.setTransform(
          dpr * camera.zoom,
          0,
          0,
          dpr * camera.zoom,
          dpr * camera.x,
          dpr * camera.y
        );
      } else {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      }
      ctx.imageSmoothingEnabled = false;
      pass.render(rc);
      ctx.restore();
    }
  }

  dispose(): void {
    for (const pass of this.passes) pass.dispose?.();
    this.passes = [];
  }
}
