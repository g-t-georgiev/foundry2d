import type { Rect } from "@gs2d/core";
import type { RenderContext, RenderPass } from "@gs2d/render";

/**
 * Fills the level with its own background colour, drawn over the
 * transparency checkerboard. Levels without one keep the checkerboard, so
 * empty cells still read as empty while editing.
 */
export class LevelBackgroundPass implements RenderPass {
  readonly id = "level-background";
  readonly space = "world";
  enabled = true;

  constructor(
    private readonly getColor: () => string | null,
    private readonly getBounds: () => Rect
  ) {}

  render(rc: RenderContext): void {
    const color = this.getColor();
    if (!color) return;
    const { x, y, width, height } = this.getBounds();
    rc.ctx.fillStyle = color;
    rc.ctx.fillRect(x, y, width, height);
  }
}
