import type { Selection } from "@foundry2d/core";
import type { RenderContext, RenderPass } from "@foundry2d/render";

/**
 * Selection outline: alternating black/white dashes so it reads on any
 * colour, drawn in screen space for crisp 1px lines.
 */
export class SelectionPass implements RenderPass {
  readonly id = "selection";
  readonly space = "screen";
  enabled = true;

  constructor(private readonly selection: Selection) {}

  render(rc: RenderContext): void {
    const r = this.selection.rect;
    if (!r) return;
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
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 4]);
    ctx.strokeStyle = "rgba(76, 159, 254, 0.9)";
    ctx.beginPath();
    if (mirror.x) {
      const cx = Math.round(center.x) + 0.5;
      ctx.moveTo(cx, tl.y);
      ctx.lineTo(cx, br.y);
    }
    if (mirror.y) {
      const cy = Math.round(center.y) + 0.5;
      ctx.moveTo(tl.x, cy);
      ctx.lineTo(br.x, cy);
    }
    ctx.stroke();
    ctx.setLineDash([]);
  }
}
