import type { Atlas } from "@foundry2d/atlas";
import type { Position, Rect } from "@foundry2d/core";
import type { SheetFrame } from "@foundry2d/formats";
import {
  BoundsPass,
  CheckerboardPass,
  type RenderContext,
  type RenderPass,
} from "@foundry2d/render";
import type { ScenePointerEvent, Workspace, WorkspaceScene } from "@foundry2d/workspace";
import { spriteOfFrame, toCanvas } from "./export";

/** World pixels between sheets drawn next to each other. */
const SHEET_GAP = 32;

interface PlacedSheet {
  canvas: HTMLCanvasElement;
  rect: Rect;
  /** Frame rectangles in world pixels (as stored: rotated frames already turned). */
  frames: { name: string; rect: Rect; rotated: boolean; pivot: Position | null }[];
}

export interface SheetSceneOptions {
  /** Frame names that are selected. */
  isSelected: (name: string) => boolean;
  showOutlines: () => boolean;
  /** A frame (or nothing) was clicked; several names when sprites share a rectangle. */
  onPick: (names: string[], additive: boolean) => void;
}

/**
 * Preview of the packed sheets, side by side: click a sprite to select it.
 * Identical sprites share one rectangle, so a click picks all of them.
 */
export class SheetScene implements WorkspaceScene {
  readonly cellSize = { width: 1, height: 1 };
  private sheets: PlacedSheet[] = [];
  private workspace: Workspace | null = null;
  private hovered: string | null = null;

  constructor(private readonly options: SheetSceneOptions) {}

  /** Shows a packing result (`null`: nothing). */
  setAtlas(atlas: Atlas | null): void {
    let x = 0;
    this.sheets = (atlas?.sheets ?? []).map((sheet) => {
      const rect = { x, y: 0, width: sheet.image.width, height: sheet.image.height };
      x += rect.width + SHEET_GAP;
      return {
        canvas: toCanvas(sheet.image),
        rect,
        frames: sheet.frames.map((f) => ({
          name: f.filename,
          rotated: f.rotated,
          pivot: pivotOnSheet(f, rect.x),
          rect: {
            x: rect.x + f.frame.x,
            y: rect.y + f.frame.y,
            width: f.rotated ? f.frame.h : f.frame.w,
            height: f.rotated ? f.frame.w : f.frame.h,
          },
        })),
      };
    });
    this.hovered = null;
    this.workspace?.rebuildPasses();
  }

  getBounds(): Rect | null {
    const last = this.sheets.at(-1);
    if (!last) return null;
    return {
      x: 0,
      y: 0,
      width: last.rect.x + last.rect.width,
      height: Math.max(...this.sheets.map((s) => s.rect.height)),
    };
  }

  getPasses(): RenderPass[] {
    return [
      ...this.sheets.flatMap(({ rect }, i) => [
        new CheckerboardPass({ getBounds: () => rect, squareSize: 8 }),
        new BoundsPass({ getBounds: () => rect }, `bounds-${i}`),
      ]),
      new SheetsPass(() => this.sheets),
      new FramesPass(
        () => this.sheets,
        (name) => this.options.isSelected(name),
        () => this.options.showOutlines(),
        () => this.hovered
      ),
    ];
  }

  attach(workspace: Workspace): void {
    this.workspace = workspace;
  }

  detach(): void {
    this.workspace = null;
  }

  getCursor(): string {
    return this.hovered ? "pointer" : "default";
  }

  onPointerDown(ev: ScenePointerEvent): void {
    if (ev.button !== 0) return;
    const hit = this.hit(ev.world);
    const names = hit.map((f) => f.name);
    this.options.onPick(names, ev.shiftKey || ev.ctrlKey || ev.metaKey);
  }

  onPointerMove(ev: ScenePointerEvent): void {
    const name = this.hit(ev.world)[0]?.name ?? null;
    if (name === this.hovered) return;
    this.hovered = name;
    this.workspace?.refreshCursor();
    this.workspace?.requestRender();
  }

  /** The frame under a world point, for the status bar. */
  describe(world: Position): string | null {
    const hit = this.hit(world);
    if (hit.length === 0) return null;
    const names = hit.map((f) => spriteOfFrame(f.name)).join(", ");
    return hit[0].rotated ? `${names} (rotated)` : names;
  }

  /** Every frame at a point: one, or all the identical sprites sharing its rectangle. */
  private hit(p: Position) {
    return this.sheets.flatMap((s) =>
      s.frames.filter(
        ({ rect: r }) => p.x >= r.x && p.y >= r.y && p.x < r.x + r.width && p.y < r.y + r.height
      )
    );
  }
}

/** Where a frame's pivot lies on its sheet (turned with rotated frames), in world pixels. */
function pivotOnSheet(f: SheetFrame, sheetX: number): Position | null {
  if (!f.pivot) return null;
  const u = f.pivot.x * f.sourceSize.w - f.spriteSourceSize.x;
  const v = f.pivot.y * f.sourceSize.h - f.spriteSourceSize.y;
  return f.rotated
    ? { x: sheetX + f.frame.x + f.frame.h - v, y: f.frame.y + u }
    : { x: sheetX + f.frame.x + u, y: f.frame.y + v };
}

/** The sheet images. */
class SheetsPass implements RenderPass {
  readonly id = "sheets";
  readonly space = "world";
  enabled = true;

  constructor(private readonly getSheets: () => readonly PlacedSheet[]) {}

  render({ ctx }: RenderContext): void {
    ctx.imageSmoothingEnabled = false;
    for (const { canvas, rect } of this.getSheets()) ctx.drawImage(canvas, rect.x, rect.y);
  }
}

/** Frame outlines, the hovered and selected frames and their pivots, in screen space. */
class FramesPass implements RenderPass {
  readonly id = "frames";
  readonly space = "screen";
  enabled = true;

  constructor(
    private readonly getSheets: () => readonly PlacedSheet[],
    private readonly isSelected: (name: string) => boolean,
    private readonly showOutlines: () => boolean,
    private readonly getHovered: () => string | null
  ) {}

  render({ ctx, camera }: RenderContext): void {
    const outlines = this.showOutlines();
    const hovered = this.getHovered();
    const stroke = (r: Rect, color: string, width: number) => {
      const a = camera.worldToLocal(r.x, r.y);
      const b = camera.worldToLocal(r.x + r.width, r.y + r.height);
      ctx.strokeStyle = color;
      ctx.lineWidth = width;
      ctx.strokeRect(Math.round(a.x) + 0.5, Math.round(a.y) + 0.5, b.x - a.x - 1, b.y - a.y - 1);
    };
    const cross = (p: Position) => {
      const { x, y } = camera.worldToLocal(p.x, p.y);
      for (const [color, width] of [
        ["#000", 3],
        ["#fff", 1],
      ] as const) {
        ctx.strokeStyle = color;
        ctx.lineWidth = width;
        ctx.beginPath();
        ctx.moveTo(x - 6, y);
        ctx.lineTo(x + 6, y);
        ctx.moveTo(x, y - 6);
        ctx.lineTo(x, y + 6);
        ctx.stroke();
      }
    };
    for (const { frames } of this.getSheets()) {
      if (outlines) for (const f of frames) stroke(f.rect, "rgba(96, 205, 255, 0.45)", 1);
      for (const f of frames) if (f.name === hovered) stroke(f.rect, "rgba(255, 255, 255, 0.8)", 1);
      for (const f of frames) {
        if (!this.isSelected(f.name)) continue;
        stroke(f.rect, "#facc15", 2);
        if (f.pivot) cross(f.pivot);
      }
    }
  }
}
