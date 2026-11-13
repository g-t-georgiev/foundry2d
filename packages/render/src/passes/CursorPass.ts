import type { RenderContext, RenderPass } from "../types";

/** A highlighted cell region under the pointer, in world units. */
export interface CursorShape {
  x: number;
  y: number;
  width: number;
  height: number;
  fill?: string;
  stroke?: string;
}

export interface CursorPassOptions {
  /** Return the shape to draw for the current pointer, or `null` to hide it. */
  getShape: (rc: RenderContext) => CursorShape | null;
}

/** Brush/tool hover preview. */
export class CursorPass implements RenderPass {
  readonly id = "cursor";
  readonly space = "world";
  enabled = true;

  constructor(private readonly options: CursorPassOptions) {}

  render(rc: RenderContext): void {
    if (!rc.pointer?.inside) return;
    const shape = this.options.getShape(rc);
    if (!shape) return;
    const { ctx, camera, theme } = rc;

    if (shape.fill) {
      ctx.fillStyle = shape.fill;
      ctx.fillRect(shape.x, shape.y, shape.width, shape.height);
    }
    ctx.lineWidth = 1 / camera.zoom;
    ctx.strokeStyle = shape.stroke ?? theme.cursorStroke;
    ctx.strokeRect(shape.x, shape.y, shape.width, shape.height);
  }
}
