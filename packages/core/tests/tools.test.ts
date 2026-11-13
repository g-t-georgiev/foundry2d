import { describe, it, expect, vi } from "vite-plus/test";
import {
  GridDocument,
  HistoryManager,
  ToolManager,
  FloodFill,
  Tool,
  type ToolContext,
  type Position,
} from "../src";

function setup(width = 5, height = 5) {
  const doc = new GridDocument<Int32Array>({
    width,
    height,
    emptyValue: -1,
    bufferCtor: Int32Array,
  });
  const layer = doc.addLayer("L");
  const history = new HistoryManager();
  const tools = new ToolManager<Int32Array>();
  const ctx = (overrides: Partial<ToolContext<Int32Array>> = {}): ToolContext<Int32Array> => ({
    doc,
    layer,
    history,
    value: 1,
    size: 1,
    isDrawing: true,
    ...overrides,
  });
  return { doc, layer, history, tools, ctx };
}

describe("PenTool via ToolManager", () => {
  it("draws an interpolated line and records one undo step", () => {
    const { layer, history, tools, ctx } = setup();
    tools.executePointerAction("down", { x: 0, y: 0 }, ctx());
    tools.executePointerAction("move", { x: 4, y: 0 }, ctx());
    tools.executePointerAction("up", { x: 4, y: 0 }, ctx());
    expect([0, 1, 2, 3, 4].map((x) => layer.get(x, 0))).toEqual([1, 1, 1, 1, 1]);
    history.undo();
    expect(layer.isEmpty()).toBe(true);
    history.redo();
    expect(layer.get(2, 0)).toBe(1);
  });

  it("records the original value once when a stroke crosses itself", () => {
    const { layer, history, tools, ctx } = setup();
    layer.set(1, 0, 9);
    tools.executePointerAction("down", { x: 0, y: 0 }, ctx());
    tools.executePointerAction("move", { x: 2, y: 0 }, ctx());
    tools.executePointerAction("move", { x: 0, y: 0 }, ctx());
    tools.executePointerAction("up", { x: 0, y: 0 }, ctx());
    history.undo();
    expect(layer.get(1, 0)).toBe(9);
    expect(layer.get(0, 0)).toBe(-1);
  });

  it("applies brush size around the pointer", () => {
    const { layer, tools, ctx } = setup();
    tools.executePointerAction("down", { x: 2, y: 2 }, ctx({ size: 3 }));
    tools.executePointerAction("up", { x: 2, y: 2 }, ctx({ size: 3 }));
    let filled = 0;
    for (let i = 0; i < layer.data.length; i++) if (layer.data[i] === 1) filled++;
    expect(filled).toBe(9);
  });

  it("is blocked on locked or hidden layers", () => {
    const { layer, history, tools, ctx } = setup();
    layer.locked = true;
    tools.executePointerAction("down", { x: 0, y: 0 }, ctx());
    tools.executePointerAction("move", { x: 3, y: 0 }, ctx());
    tools.executePointerAction("up", { x: 3, y: 0 }, ctx());
    expect(layer.isEmpty()).toBe(true);
    expect(history.canUndo).toBe(false);
  });

  it("cancelStroke reverts the in-progress stroke", () => {
    const { layer, history, tools, ctx } = setup();
    tools.executePointerAction("down", { x: 0, y: 0 }, ctx());
    tools.executePointerAction("move", { x: 3, y: 3 }, ctx());
    tools.cancelStroke(ctx());
    expect(layer.isEmpty()).toBe(true);
    expect(history.canUndo).toBe(false);
  });
});

describe("other tools", () => {
  it("eraser writes the empty value", () => {
    const { layer, tools, ctx } = setup();
    layer.set(0, 0, 5);
    tools.setTool("eraser");
    tools.executePointerAction("down", { x: 0, y: 0 }, ctx());
    tools.executePointerAction("up", { x: 0, y: 0 }, ctx());
    expect(layer.get(0, 0)).toBe(-1);
  });

  it("eyedropper picks values even on locked layers and is transient", () => {
    const { layer, tools, ctx } = setup();
    layer.set(1, 1, 7);
    layer.locked = true;
    const onPick = vi.fn();
    tools.setTool("bucket");
    tools.setTool("eyedropper");
    tools.executePointerAction("down", { x: 1, y: 1 }, ctx({ onPickValue: onPick }));
    expect(onPick).toHaveBeenCalledWith(7);
    tools.returnToPreviousTool();
    expect(tools.activeTool).toBe("bucket");
  });

  it("accepts custom tools", () => {
    class StampTool extends Tool<Int32Array> {
      constructor() {
        super("stamp");
      }
      onMouseDown(coords: Position, c: ToolContext<Int32Array>) {
        c.layer.set(coords.x, coords.y, 99);
      }
    }
    const { layer, tools, ctx } = setup();
    tools.registerTool(new StampTool());
    expect(tools.setTool("stamp")).toBe(true);
    tools.executePointerAction("down", { x: 3, y: 3 }, ctx());
    expect(layer.get(3, 3)).toBe(99);
  });
});

describe("FloodFill", () => {
  it("fills only the connected region", () => {
    const { layer } = setup(4, 4);
    // Vertical wall at x = 2
    for (let y = 0; y < 4; y++) layer.set(2, y, 5);
    const changes = FloodFill.execute(layer, 0, 0, 1);
    expect(changes).toHaveLength(8);
    expect(layer.get(3, 3)).toBe(-1);
    expect(layer.get(1, 3)).toBe(1);
  });

  it("returns no changes when filling with the same value", () => {
    const { layer } = setup(2, 2);
    expect(FloodFill.execute(layer, 0, 0, -1)).toEqual([]);
  });
});
