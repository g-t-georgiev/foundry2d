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
