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

describe("RectangleTool", () => {
  it("previews while dragging and commits one undoable rectangle", async () => {
    const { RectangleTool } = await import("../src");
    const { layer, history, tools, ctx } = setup(5, 5);
    tools.registerTool(new RectangleTool<Int32Array>("rect"));
    tools.setTool("rect");
    tools.executePointerAction("down", { x: 0, y: 0 }, ctx());
    tools.executePointerAction("move", { x: 4, y: 4 }, ctx());
    tools.executePointerAction("move", { x: 1, y: 2 }, ctx());
    // Shrinking the drag reverts cells outside the new rectangle.
    expect(layer.get(4, 4)).toBe(-1);
    tools.executePointerAction("up", { x: 1, y: 2 }, ctx());
    let filled = 0;
    for (let i = 0; i < layer.data.length; i++) if (layer.data[i] === 1) filled++;
    expect(filled).toBe(6);
    history.undo();
    expect(layer.isEmpty()).toBe(true);
    expect(history.canUndo).toBe(false);
  });

  it("draws only the border when not filled", async () => {
    const { RectangleTool } = await import("../src");
    const { layer, tools, ctx } = setup(5, 5);
    tools.registerTool(new RectangleTool<Int32Array>("outline", false));
    tools.setTool("outline");
    tools.executePointerAction("down", { x: 0, y: 0 }, ctx());
    tools.executePointerAction("up", { x: 2, y: 2 }, ctx());
    expect(layer.get(1, 1)).toBe(-1);
    expect(layer.get(2, 1)).toBe(1);
  });
});

describe("Line and ellipse tools", () => {
  const filledCells = (layer: { data: Int32Array; width: number }) => {
    const cells: string[] = [];
    for (let i = 0; i < layer.data.length; i++) {
      if (layer.data[i] === 1) cells.push(`${i % layer.width},${Math.floor(i / layer.width)}`);
    }
    return cells;
  };

  it("draws a Bresenham line and undoes it in one step", async () => {
    const { LineTool } = await import("../src");
    const { layer, history, tools, ctx } = setup(5, 5);
    tools.registerTool(new LineTool<Int32Array>());
    tools.setTool("line");
    tools.executePointerAction("down", { x: 0, y: 0 }, ctx());
    tools.executePointerAction("move", { x: 4, y: 0 }, ctx());
    tools.executePointerAction("move", { x: 4, y: 4 }, ctx());
    tools.executePointerAction("up", { x: 4, y: 4 }, ctx());
    expect(filledCells(layer)).toEqual(["0,0", "1,1", "2,2", "3,3", "4,4"]);
    history.undo();
    expect(layer.isEmpty()).toBe(true);
  });

  it("draws symmetric ellipse outlines and fills", async () => {
    const { EllipseTool } = await import("../src");
    const { layer, tools, ctx } = setup(7, 7);
    tools.registerTool(new EllipseTool<Int32Array>("ellipse", false));
    tools.setTool("ellipse");
    tools.executePointerAction("down", { x: 0, y: 0 }, ctx());
    tools.executePointerAction("up", { x: 6, y: 6 }, ctx());
    const outline = filledCells(layer);
    // Mirror symmetry and a hollow centre.
    for (const cell of outline) {
      const [x, y] = cell.split(",").map(Number);
      expect(outline).toContain(`${6 - x},${y}`);
      expect(outline).toContain(`${x},${6 - y}`);
    }
    expect(layer.get(3, 3)).toBe(-1);
    expect(layer.get(3, 0)).toBe(1);

    const filled = setup(4, 4);
    filled.tools.registerTool(new EllipseTool<Int32Array>("disc", true));
    filled.tools.setTool("disc");
    filled.tools.executePointerAction("down", { x: 0, y: 0 }, filled.ctx());
    filled.tools.executePointerAction("up", { x: 3, y: 3 }, filled.ctx());
    expect(filled.layer.get(1, 1)).toBe(1);
    expect(filled.layer.get(0, 0)).toBe(-1);
  });
});
