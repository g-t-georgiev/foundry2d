import type { RenderContext, RenderPass } from "../types";

export interface RulersPassOptions {
  /** Ruler thickness in CSS pixels; should match `camera.uiPadding`. */
  size?: number;
  /** World units per displayed unit (e.g. tile size to label in tiles). */
  unitScale?: () => number;
  /** Label in the corner box. */
  unitLabel?: () => string;
  /**
   * Label steps: `"binary"` (1, 2, 4, 8, 16…) for cell grids, so labels fall
   * on the grid's stronger lines (every 4 or 8 cells); `"decimal"` (1, 2, 5,
   * 10, 20, 50…) for plain coordinates. Default `"decimal"`.
   */
  steps?: () => RulerSteps;
}

export type RulerSteps = "binary" | "decimal";

/** The label step and tick step of a ruler, both whole units (see `rulerScale`). */
export interface RulerScale {
  /** Units between labels. */
  step: number;
  /** Units between ticks; divides `step`, never below one unit. */
  tick: number;
}

/** 1, 2, 4, 8… or 1, 2, 5, 10, 20, 50… */
function* candidates(kind: RulerSteps): Generator<number> {
  if (kind === "binary") {
    for (let n = 1; ; n *= 2) yield n;
  }
  for (let decade = 1; ; decade *= 10) {
    for (const m of [1, 2, 5]) yield m * decade;
  }
}

/**
 * Picks whole-unit steps for a ruler: labels at least `minLabelPx` apart,
 * ticks at least `minTickPx` apart and only on whole units (cells or
 * pixels), so ticks never split a cell.
 */
export function rulerScale(
  pxPerUnit: number,
  kind: RulerSteps,
  minLabelPx = 53,
  minTickPx = 5
): RulerScale {
  let step = 1;
  for (const c of candidates(kind)) {
    step = c;
    if (c * pxPerUnit >= minLabelPx || c > 1e9) break;
  }
  let tick = step;
  for (const c of candidates(kind)) {
    if (c >= step) break;
    if (step % c === 0 && c * pxPerUnit >= minTickPx) {
      tick = c;
      break;
    }
  }
  return { step, tick };
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
    const scale = rulerScale(pxPerUnit, this.options.steps?.() ?? "decimal");

    ctx.font = `11px ${theme.font}`;
    ctx.lineWidth = 1;

    this.drawAxis(rc, viewWidth, rc.camera.x, pxPerUnit, scale, false);
    this.drawAxis(rc, viewHeight, rc.camera.y, pxPerUnit, scale, true);

    if (rc.pointer?.inside) {
      const size = this.size;
      // The unit (cell) under the pointer, shaded on both rulers when it is wide enough to see.
      if (pxPerUnit >= 6) {
        ctx.fillStyle = theme.rulerHighlight;
        ctx.globalAlpha = 0.25;
        const cellX = Math.floor((rc.pointer.local.x - rc.camera.x) / pxPerUnit);
        const cellY = Math.floor((rc.pointer.local.y - rc.camera.y) / pxPerUnit);
        const x0 = Math.max(size, cellX * pxPerUnit + rc.camera.x);
        const x1 = cellX * pxPerUnit + rc.camera.x + pxPerUnit;
        const y0 = Math.max(size, cellY * pxPerUnit + rc.camera.y);
        const y1 = cellY * pxPerUnit + rc.camera.y + pxPerUnit;
        if (x1 > size) ctx.fillRect(x0, 0, x1 - x0, size);
        if (y1 > size) ctx.fillRect(0, y0, size, y1 - y0);
        ctx.globalAlpha = 1;
      }
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
    scale: RulerScale,
    vertical: boolean
  ): void {
    const { ctx, theme } = rc;
    const size = this.size;

    ctx.fillStyle = theme.rulerBar;
    if (vertical) ctx.fillRect(0, size, size, length - size);
    else ctx.fillRect(size, 0, length - size, size);

    const startUnit = (size - cameraOffset) / pxPerUnit;
    const endUnit = (length - cameraOffset) / pxPerUnit;
    const { step, tick } = scale;
    const ticksPerStep = Math.round(step / tick);
    const startK = Math.floor(startUnit / tick);
    const endK = Math.ceil(endUnit / tick);
    // Guard against pathological zoom levels producing huge loops.
    if (endK - startK > 5000) return;

    ctx.beginPath();
    ctx.strokeStyle = theme.rulerTick;
    ctx.fillStyle = theme.rulerLabel;

    for (let k = startK; k <= endK; k++) {
      const unitPos = k * tick;
      const screenPos = Math.round(unitPos * pxPerUnit + cameraOffset) + 0.5;
      if (screenPos < size || screenPos > length) continue;

      // Labels on whole steps (lines between cells: "8" is the line after the 8th cell).
      const isMajor = k % ticksPerStep === 0;
      const isMiddle = ticksPerStep % 2 === 0 && k % (ticksPerStep / 2) === 0;
      const tickStart = isMajor ? 10 : isMiddle ? 16 : 20;

      if (vertical) {
        ctx.moveTo(tickStart, screenPos);
        ctx.lineTo(size, screenPos);
      } else {
        ctx.moveTo(screenPos, tickStart);
        ctx.lineTo(screenPos, size);
      }

      if (!isMajor) continue;
      const label = String(unitPos === 0 ? 0 : unitPos);
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
