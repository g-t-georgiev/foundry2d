import type { Position } from "../types";
import type { ToolContext } from "./types";
import { Tool } from "./Tool";

export class EyedropperTool<
  Buffer extends Uint32Array | Int32Array = Uint32Array,
> extends Tool<Buffer> {
  constructor() {
    super("eyedropper", "crosshair");
  }

  onMouseDown(coords: Position, ctx: ToolContext<Buffer>): void {
    if (!ctx.layer.isWithinBounds(coords.x, coords.y)) return;

    const value = ctx.layer.get(coords.x, coords.y);
    ctx.onPickValue?.(value);
  }
}
