import { selectionHandles, type Selection } from "@gs2d/core";
import type { RenderContext, RenderPass } from "@gs2d/render";

/**
 * Selection outline: alternating black/white dashes so it reads on any
 * colour, drawn in screen space for crisp 1px lines.
 */
export class SelectionPass implements RenderPass {
  readonly id = "selection";
  readonly space = "screen";
  enabled = true;

  constructor(
    private readonly selection: Selection,
    /** Whether to draw the resize handles (the select tool is active). */
    private readonly showHandles: () => boolean = () => false
  ) {}

  render(rc: RenderContext): void {
    const r = this.selection.rect;
    if (!r) return;
    if (this.showHandles()) this.renderHandles(rc, r);
    if (this.selection.mask) {
      this.renderMask(rc, r, this.selection.mask);
      return;
    }
    const { ctx, camera } = rc;
    const tl = camera.worldToLocal(r.x, r.y);
    const br = camera.worldToLocal(r.x + r.width, r.y + r.height);
    const x = Math.round(tl.x) + 0.5;
    const y = Math.round(tl.y) + 0.5;
    const w = Math.round(br.x - tl.x) - 1;
    const h = Math.round(br.y - tl.y) - 1;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = "#000";
    ctx.strokeRect(x, y, w, h);
    ctx.lineDashOffset = 4;
    ctx.strokeStyle = "#fff";
    ctx.strokeRect(x, y, w, h);
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
  }

  /** Small squares in the cells around the selection that resize it. */
  private renderHandles(
    rc: RenderContext,
    r: { x: number; y: number; width: number; height: number }
  ): void {
    const { ctx, camera } = rc;
    const size = Math.max(5, Math.min(9, camera.zoom * 0.6));
    for (const h of selectionHandles(r)) {
      const c = camera.worldToLocal(h.x + 0.5, h.y + 0.5);
      const x = Math.round(c.x - size / 2) + 0.5;
      const y = Math.round(c.y - size / 2) + 0.5;
      ctx.fillStyle = "#fff";
      ctx.fillRect(x, y, size, size);
      ctx.lineWidth = 1;
      ctx.strokeStyle = "#000";
      ctx.strokeRect(x, y, size, size);
    }
  }

  /**
   * Outline of a non-rectangular selection: every side of a selected cell
   * whose neighbour isn't selected becomes a segment.
   */
  private renderMask(
    rc: RenderContext,
    r: { x: number; y: number; width: number; height: number },
    mask: Uint8Array
  ): void {
    const { ctx, camera } = rc;
    const at = (x: number, y: number) => {
      const p = camera.worldToLocal(r.x + x, r.y + y);
      return { x: Math.round(p.x) + 0.5, y: Math.round(p.y) + 0.5 };
    };
    const selected = (x: number, y: number) =>
      x >= 0 && y >= 0 && x < r.width && y < r.height && mask[y * r.width + x] === 1;
    const path = new Path2D();
    const segment = (x0: number, y0: number, x1: number, y1: number) => {
      const a = at(x0, y0);
      const b = at(x1, y1);
      path.moveTo(a.x, a.y);
      path.lineTo(b.x, b.y);
    };
    for (let y = 0; y < r.height; y++) {
      for (let x = 0; x < r.width; x++) {
        if (!selected(x, y)) continue;
        if (!selected(x, y - 1)) segment(x, y, x + 1, y);
        if (!selected(x, y + 1)) segment(x, y + 1, x + 1, y + 1);
        if (!selected(x - 1, y)) segment(x, y, x, y + 1);
        if (!selected(x + 1, y)) segment(x + 1, y, x + 1, y + 1);
      }
    }
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.strokeStyle = "#000";
    ctx.stroke(path);
    ctx.lineDashOffset = 4;
    ctx.strokeStyle = "#fff";
    ctx.stroke(path);
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
  }
}

/** Dashed centre lines showing the active mirror axes. */
export class MirrorGuidePass implements RenderPass {
  readonly id = "mirror-guides";
  readonly space = "screen";
  enabled = true;

  constructor(
    private readonly getMirror: () => { x: boolean; y: boolean },
    private readonly getSize: () => { width: number; height: number }
  ) {}

  render(rc: RenderContext): void {
    const mirror = this.getMirror();
    if (!mirror.x && !mirror.y) return;
    const { ctx, camera } = rc;
    const { width, height } = this.getSize();
    const tl = camera.worldToLocal(0, 0);
    const br = camera.worldToLocal(width, height);
    const center = camera.worldToLocal(width / 2, height / 2);
    // Overshoot past the sprite so the axis reads even over busy pixels.
    const over = 14;
    const path = () => {
      ctx.beginPath();
      if (mirror.x) {
        const cx = Math.round(center.x);
        ctx.moveTo(cx, tl.y - over);
        ctx.lineTo(cx, br.y + over);
      }
      if (mirror.y) {
        const cy = Math.round(center.y);
        ctx.moveTo(tl.x - over, cy);
        ctx.lineTo(br.x + over, cy);
      }
    };
    // Dark casing under a bright dashed line: visible on light and dark pixels alike.
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(0, 0, 0, 0.55)";
    path();
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 5]);
    ctx.strokeStyle = "#4c9ffe";
    path();
    ctx.stroke();
    ctx.setLineDash([]);

    // Axis labels at the line ends, outside the sprite.
    ctx.font = `bold 11px ${rc.theme.font}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const label = (text: string, x: number, y: number) => {
      ctx.fillStyle = "#4c9ffe";
      ctx.beginPath();
      ctx.arc(x, y, 8, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.fillText(text, x, y + 0.5);
    };
    if (mirror.x) label("X", Math.round(center.x), tl.y - over - 9);
    if (mirror.y) label("Y", tl.x - over - 9, Math.round(center.y));
    ctx.textAlign = "start";
  }
}
