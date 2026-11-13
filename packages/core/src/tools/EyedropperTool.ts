import type { Position } from "../types";
import type { CellBuffer } from "../document";
import type { ToolContext } from "./types";
import { Tool } from "./Tool";

export class EyedropperTool<Buffer extends CellBuffer = CellBuffer> extends Tool<Buffer> {
  public override readonly modifiesLayer = false;

  constructor() {
    super("eyedropper", "crosshair");
  }

  onMouseDown(coords: Position, ctx: ToolContext<Buffer>): void {
    if (!ctx.layer.isWithinBounds(coords.x, coords.y)) return;
    ctx.onPickValue?.(ctx.layer.get(coords.x, coords.y));
  }
}
