import type { Position, PointerAction } from "../types";
import type { ITool, ToolContext, ToolType } from "./types";
import { PenTool } from "./PenTool";
import { EraserTool } from "./EraserTool";
import { BucketTool } from "./BucketTool";
import { EyedropperTool } from "./EyedropperTool";

export class ToolManager<Buffer extends Uint32Array | Int32Array = Uint32Array> {
  private tools = new Map<ToolType, ITool<Buffer>>();
  private activeToolName: ToolType = "pen";
  private previousToolName: ToolType = "pen";

  constructor() {
    // Register standard default tools
    this.registerTool(new PenTool<Buffer>());
    this.registerTool(new EraserTool<Buffer>());
    this.registerTool(new BucketTool<Buffer>());
    this.registerTool(new EyedropperTool<Buffer>());
  }

  public registerTool(tool: ITool<Buffer>): void {
    this.tools.set(tool.name, tool);
  }

  public setTool(name: ToolType): boolean {
    if (!this.tools.has(name) || this.activeToolName === name) return false;

    if (this.activeToolName !== "eyedropper") {
      this.previousToolName = this.activeToolName;
    }

    this.activeToolName = name;
    return true;
  }

  public returnToPreviousTool(): void {
    this.setTool(this.previousToolName);
  }

  public getActiveTool(): ITool<Buffer> {
    return this.tools.get(this.activeToolName) || this.tools.get("pen")!;
  }

  public executePointerAction(
    action: PointerAction,
    coords: Position,
    ctx: ToolContext<Buffer>
  ): void {
    // Guard against drawing on non-drawable or hidden layers
    if (ctx.layer.opacity <= 0.001) return;

    const tool = this.getActiveTool();

    if (!tool) return;

    if (action === "down") {
      tool.onMouseDown(coords, ctx);
    } else if (action === "move") {
      tool.onMouseMove?.(coords, ctx);
    } else if (action === "up") {
      tool.onMouseUp?.(coords, ctx);
    }
  }
}
