import type { Rect } from "@foundry2d/core";
import type { RenderContext, RenderPass } from "../types";

export interface BoundsPassOptions {
  getBounds: () => Rect | null;
  /** Overrides the theme color. */
  color?: string;
  lineWidth?: number;
}

/** Outline around the document/level, drawn in screen space for a constant width. */
export class BoundsPass implements RenderPass {
  readonly id: string;
  readonly space = "screen";
  enabled = true;

  constructor(
    private readonly options: BoundsPassOptions,
    id = "bounds"
  ) {
    this.id = id;
  }

  render(rc: RenderContext): void {
    const bounds = this.options.getBounds();
    if (!bounds) return;
    const { ctx, camera } = rc;
    const tl = camera.worldToLocal(bounds.x, bounds.y);
    const br = camera.worldToLocal(bounds.x + bounds.width, bounds.y + bounds.height);
    const lw = this.options.lineWidth ?? 1;
    ctx.lineWidth = lw;
    ctx.strokeStyle = this.options.color ?? rc.theme.bounds;
    ctx.strokeRect(
      Math.round(tl.x) - lw / 2,
      Math.round(tl.y) - lw / 2,
      Math.round(br.x - tl.x) + lw,
      Math.round(br.y - tl.y) + lw
    );
  }
}
