import type { Position, PointerAction } from "../types";
import type { CellBuffer } from "../document";
import type { ITool, ToolContext, ToolType } from "./types";
import type { Unsubscribe } from "../utils/EventEmitter";
import { PenTool } from "./PenTool";
import { EraserTool } from "./EraserTool";
import { BucketTool } from "./BucketTool";
import { EyedropperTool } from "./EyedropperTool";

export interface ToolManagerOptions {
  /** Register pen, eraser, bucket and eyedropper. Defaults to `true`. */
  registerDefaults?: boolean;
  /** Initially active tool. Defaults to the first registered tool. */
  initialTool?: ToolType;
}

export type ToolChangeListener = (tool: ToolType, previous: ToolType) => void;

/**
 * Registry of tools plus the active-tool state machine.
 *
 * Tools that write cells are refused on hidden, locked or fully transparent
 * layers. "Transient" tools (the eyedropper by default) don't overwrite the
 * remembered previous tool, so `returnToPreviousTool` can switch back.
 */
export class ToolManager<Buffer extends CellBuffer = CellBuffer> {
  private tools = new Map<ToolType, ITool<Buffer>>();
  private transient = new Set<ToolType>(["eyedropper"]);
  private listeners = new Set<ToolChangeListener>();
  private activeToolName: ToolType = "";
  private previousToolName: ToolType = "";
  private strokeActive = false;

  constructor(options: ToolManagerOptions = {}) {
    if (options.registerDefaults ?? true) {
      this.registerTool(new PenTool<Buffer>());
      this.registerTool(new EraserTool<Buffer>());
      this.registerTool(new BucketTool<Buffer>());
      this.registerTool(new EyedropperTool<Buffer>());
    }
    if (options.initialTool) this.setTool(options.initialTool);
  }

  public registerTool(tool: ITool<Buffer>, opts: { transient?: boolean } = {}): void {
    this.tools.set(tool.name, tool);
    if (opts.transient) this.transient.add(tool.name);
    if (!this.activeToolName) {
      this.activeToolName = tool.name;
      this.previousToolName = tool.name;
    }
  }

  public hasTool(name: ToolType): boolean {
    return this.tools.has(name);
  }

  public get toolNames(): ToolType[] {
    return [...this.tools.keys()];
  }

  public get activeTool(): ToolType {
    return this.activeToolName;
  }

  public get previousTool(): ToolType {
    return this.previousToolName;
  }

  /** Switches tool. Returns `false` when unknown or already active. */
  public setTool(name: ToolType): boolean {
    if (!this.tools.has(name) || this.activeToolName === name) return false;

    const previous = this.activeToolName;
    if (!this.transient.has(previous)) this.previousToolName = previous;
    this.activeToolName = name;
    for (const listener of this.listeners) listener(name, previous);
    return true;
  }

  public returnToPreviousTool(): void {
    this.setTool(this.previousToolName);
  }

  public getActiveTool(): ITool<Buffer> | undefined {
    return this.tools.get(this.activeToolName);
  }

  public onChange(listener: ToolChangeListener): Unsubscribe {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Whether the active tool may act on the context's layer. */
  public canApply(ctx: ToolContext<Buffer>): boolean {
    const tool = this.getActiveTool();
    if (!tool) return false;
    return !tool.modifiesLayer || ctx.layer.isEditable;
  }

  public executePointerAction(
    action: PointerAction,
    coords: Position,
    ctx: ToolContext<Buffer>
  ): void {
    const tool = this.getActiveTool();
    if (!tool) return;

    if (action === "down") {
      if (!this.canApply(ctx)) return;
      this.strokeActive = true;
      tool.onMouseDown(coords, ctx);
      return;
    }

    // Moves/ups only matter for a stroke that started on an editable layer.
    if (!this.strokeActive) return;

    if (action === "move") {
      tool.onMouseMove?.(coords, ctx);
    } else {
      tool.onMouseUp?.(coords, ctx);
      this.strokeActive = false;
    }
  }

  /** Aborts an in-progress stroke (e.g. Escape or pointercancel). */
  public cancelStroke(ctx: ToolContext<Buffer>): void {
    if (!this.strokeActive) return;
    this.getActiveTool()?.cancel?.(ctx);
    this.strokeActive = false;
  }
}
