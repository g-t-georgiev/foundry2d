import type { Rect } from "@foundry2d/core";
import type { RenderContext, RenderPass } from "../types";

export interface GridLinesPassOptions {
  /** World-space rectangle covered by the grid. */
  getBounds: () => Rect | null;
  /** World size of one grid step (a function when it varies, e.g. per active layer). */
  step: { width: number; height: number } | (() => { width: number; height: number });
  /** Every Nth line is drawn with the major color (0 disables). */
  majorEvery?: number;
  /** Hide the grid when a cell is smaller than this many CSS pixels on screen. */
  minScreenSpacing?: number;
}

/**
 * Cell grid, drawn in screen space and snapped to device pixels so lines stay
 * one pixel wide and crisp at every zoom level. Only visible lines are drawn.
 */
export class GridLinesPass implements RenderPass {
  readonly id = "grid";
  readonly space = "screen";
  enabled = true;

  constructor(private readonly options: GridLinesPassOptions) {}

  render(rc: RenderContext): void {
    const bounds = this.options.getBounds();
    if (!bounds) return;

    const { ctx, camera, theme, devicePixelRatio: dpr } = rc;
    const step = typeof this.options.step === "function" ? this.options.step() : this.options.step;
    const spacing = Math.min(step.width, step.height) * camera.zoom;
    if (spacing < (this.options.minScreenSpacing ?? 4)) return;

    const majorEvery = this.options.majorEvery ?? 0;
    const visible = camera.getVisibleWorldRect(rc.viewWidth, rc.viewHeight);

    // Lines inside the bounds only: a coarse grid need not divide them evenly.
    const cols = Math.floor(bounds.width / step.width + 1e-6);
    const rows = Math.floor(bounds.height / step.height + 1e-6);
    const firstCol = Math.max(0, Math.floor((visible.x - bounds.x) / step.width));
    const lastCol = Math.min(cols, Math.ceil((visible.x + visible.width - bounds.x) / step.width));
    const firstRow = Math.max(0, Math.floor((visible.y - bounds.y) / step.height));
    const lastRow = Math.min(
      rows,
      Math.ceil((visible.y + visible.height - bounds.y) / step.height)
    );
    if (firstCol > lastCol || firstRow > lastRow) return;

    const top = camera.worldToLocal(bounds.x, bounds.y).y;
    const bottom = camera.worldToLocal(bounds.x, bounds.y + bounds.height).y;
    const left = camera.worldToLocal(bounds.x, bounds.y).x;
    const right = camera.worldToLocal(bounds.x + bounds.width, bounds.y).x;
    // Snap to the center of a device pixel for crisp 1px lines.
    const snap = (v: number) => (Math.round(v * dpr) + 0.5) / dpr;

    ctx.lineWidth = 1 / dpr;

    const strokeLines = (major: boolean) => {
      ctx.beginPath();
      for (let c = firstCol; c <= lastCol; c++) {
        const isMajor = majorEvery > 0 && c % majorEvery === 0;
        if (isMajor !== major) continue;
        const x = snap(camera.worldToLocal(bounds.x + c * step.width, 0).x);
        ctx.moveTo(x, top);
        ctx.lineTo(x, bottom);
      }
      for (let r = firstRow; r <= lastRow; r++) {
        const isMajor = majorEvery > 0 && r % majorEvery === 0;
        if (isMajor !== major) continue;
        const y = snap(camera.worldToLocal(0, bounds.y + r * step.height).y);
        ctx.moveTo(left, y);
        ctx.lineTo(right, y);
      }
      ctx.strokeStyle = major ? theme.gridLineMajor : theme.gridLine;
      ctx.stroke();
    };

    strokeLines(false);
    if (majorEvery > 0) strokeLines(true);
  }
}
