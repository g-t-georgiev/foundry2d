import type { RenderContext, RenderPass } from "../types";

export interface RulersPassOptions {
  /** Ruler thickness in CSS pixels; should match `camera.uiPadding`. */
  size?: number;
  /** World units per displayed unit (e.g. tile size to label in tiles). */
  unitScale?: () => number;
  /** Label in the corner box. */
  unitLabel?: () => string;
}

/** Picks a 1/2/5 × 10^n step so labels are at least `minSpacing` px apart. */
export function niceStep(rawStep: number, minimum = 1): number {
  if (!(rawStep > 0)) return minimum;
  const exponent = Math.floor(Math.log10(rawStep));
  const fraction = rawStep / Math.pow(10, exponent);
  let nice = 10;
  if (fraction <= 1) nice = 1;
  else if (fraction <= 2) nice = 2;
  else if (fraction <= 5) nice = 5;
  return Math.max(minimum, nice * Math.pow(10, exponent));
}

/** Top and left rulers with ticks, labels and pointer indicators. */
export class RulersPass implements RenderPass {
  readonly id = "rulers";
  readonly space = "screen";
  enabled = true;

  constructor(private readonly options: RulersPassOptions = {}) {}

  get size(): number {
    return this.options.size ?? 24;
  }

  render(rc: RenderContext): void {
    const { ctx, theme, viewWidth, viewHeight } = rc;
    const unitScale = this.options.unitScale?.() ?? 1;
    // Screen pixels per displayed unit.
    const pxPerUnit = rc.camera.zoom * unitScale;
    const step = niceStep(53 / pxPerUnit, unitScale >= 1 ? 1 : 0);
    const subStep = step / 10;

    ctx.font = `11px ${theme.font}`;
    ctx.lineWidth = 1;

    this.drawAxis(rc, viewWidth, rc.camera.x, pxPerUnit, subStep, false);
    this.drawAxis(rc, viewHeight, rc.camera.y, pxPerUnit, subStep, true);

    if (rc.pointer?.inside) {
      const size = this.size;
      ctx.lineWidth = 2;
      ctx.strokeStyle = theme.rulerHighlight;
      ctx.beginPath();
      const mx = Math.round(rc.pointer.local.x) + 0.5;
      const my = Math.round(rc.pointer.local.y) + 0.5;
      if (mx >= size) {
        ctx.moveTo(mx, 0);
        ctx.lineTo(mx, size);
      }
      if (my >= size) {
        ctx.moveTo(0, my);
        ctx.lineTo(size, my);
      }
      ctx.stroke();
    }

    this.drawCorner(rc);
  }

  private drawAxis(
    rc: RenderContext,
    length: number,
    cameraOffset: number,
    pxPerUnit: number,
    subStep: number,
    vertical: boolean
  ): void {
    const { ctx, theme } = rc;
    const size = this.size;

    ctx.fillStyle = theme.rulerBar;
    if (vertical) ctx.fillRect(0, size, size, length - size);
    else ctx.fillRect(size, 0, length - size, size);

    const startUnit = (size - cameraOffset) / pxPerUnit;
    const endUnit = (length - cameraOffset) / pxPerUnit;
    const startK = Math.floor(startUnit / subStep);
    const endK = Math.ceil(endUnit / subStep);
    // Guard against pathological zoom levels producing huge loops.
    if (endK - startK > 5000) return;

    ctx.beginPath();
    ctx.strokeStyle = theme.rulerTick;
    ctx.fillStyle = theme.rulerLabel;

    for (let k = startK; k <= endK; k++) {
      const unitPos = k * subStep;
      const screenPos = Math.round(unitPos * pxPerUnit + cameraOffset) + 0.5;
      if (screenPos < size || screenPos > length) continue;

      const isMajor = k % 10 === 0;
      const isMiddle = k % 5 === 0;
      const tickStart = isMajor ? 10 : isMiddle ? 16 : 20;

      if (vertical) {
        ctx.moveTo(tickStart, screenPos);
        ctx.lineTo(size, screenPos);
      } else {
        ctx.moveTo(screenPos, tickStart);
        ctx.lineTo(screenPos, size);
      }

      if (!isMajor) continue;
      const label = `${Math.abs(unitPos) < 1e-6 ? 0 : +unitPos.toFixed(2)}`;
      if (vertical) {
        ctx.save();
        ctx.translate(2, screenPos + 3);
        ctx.rotate(-Math.PI / 2);
        ctx.textAlign = "right";
        ctx.textBaseline = "top";
        ctx.fillText(label, 0, 0);
        ctx.restore();
      } else {
        ctx.textAlign = "left";
        ctx.textBaseline = "top";
        ctx.fillText(label, screenPos + 3, 2);
      }
    }
    ctx.stroke();
  }

  private drawCorner(rc: RenderContext): void {
    const { ctx, theme, viewWidth, viewHeight } = rc;
    const size = this.size;

    ctx.fillStyle = theme.rulerCorner;
    ctx.fillRect(0, 0, size, size);

    ctx.lineWidth = 1;
    ctx.strokeStyle = theme.rulerTick;
    ctx.beginPath();
    ctx.moveTo(size, size + 0.5);
    ctx.lineTo(viewWidth, size + 0.5);
    ctx.moveTo(size + 0.5, size);
    ctx.lineTo(size + 0.5, viewHeight);
    ctx.stroke();

    ctx.font = `10px ${theme.font}`;
    ctx.fillStyle = theme.rulerLabel;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(this.options.unitLabel?.() ?? "px", size / 2, size / 2);
  }
}
