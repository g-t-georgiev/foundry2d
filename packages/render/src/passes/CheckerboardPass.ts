import type { Rect } from "@gs2d/core";
import type { RenderContext, RenderPass } from "../types";
import { createSurface } from "../canvas";

export interface CheckerboardPassOptions {
  /** World-space area to fill (e.g. document bounds). */
  getBounds: () => Rect | null;
  /** Size of one checker square in world units. */
  squareSize?: number;
}

/** Transparency checkerboard behind the document. */
export class CheckerboardPass implements RenderPass {
  readonly id = "checkerboard";
  readonly space = "world";
  enabled = true;
  private pattern: CanvasPattern | null = null;
  private patternColors = "";

  constructor(private readonly options: CheckerboardPassOptions) {}

  render(rc: RenderContext): void {
    const bounds = this.options.getBounds();
    if (!bounds) return;
    const { ctx, theme } = rc;
    const size = this.options.squareSize ?? 1;

    const colorsKey = `${theme.checkerLight}|${theme.checkerDark}`;
    if (!this.pattern || this.patternColors !== colorsKey) {
      const { canvas, ctx: pctx } = createSurface(2, 2);
      pctx.fillStyle = theme.checkerLight;
      pctx.fillRect(0, 0, 2, 2);
      pctx.fillStyle = theme.checkerDark;
      pctx.fillRect(0, 0, 1, 1);
      pctx.fillRect(1, 1, 1, 1);
      this.pattern = ctx.createPattern(canvas, "repeat");
      this.patternColors = colorsKey;
    }

    ctx.fillStyle = theme.checkerDark;
    ctx.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
    if (!this.pattern) return;

    // Pattern space follows the current (world) transform; scale squares to `size`.
    this.pattern.setTransform(new DOMMatrix().translate(bounds.x, bounds.y).scale(size));
    ctx.fillStyle = this.pattern;
    ctx.fillRect(bounds.x, bounds.y, bounds.width, bounds.height);
  }

  dispose(): void {
    this.pattern = null;
  }
}
