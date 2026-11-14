import { describe, it, expect } from "vite-plus/test";
import {
  GridDocument,
  HistoryManager,
  RectangleTool,
  SelectTool,
  Selection,
  ToolManager,
  clearRegionChanges,
  compositeRgba,
  pasteRegionChanges,
  readRegion,
  type ToolContext,
} from "../src";

function setup(width = 6, height = 4) {
  const doc = new GridDocument<Int32Array>({
    width,
    height,
    emptyValue: 0,
    bufferCtor: Int32Array,
  });
  const layer = doc.addLayer("L");
  const history = new HistoryManager();
  const selection = new Selection();
  const tools = new ToolManager<Int32Array>();
  tools.registerTool(new SelectTool<Int32Array>(selection));
  tools.registerTool(new RectangleTool<Int32Array>("rect", false));
  const ctx = (overrides: Partial<ToolContext<Int32Array>> = {}): ToolContext<Int32Array> => ({
    doc,
    layer,
    history,
    value: 7,
    size: 1,
    isDrawing: true,
    ...overrides,
  });
  const drag = (from: [number, number], to: [number, number], c = ctx()) => {
    tools.executePointerAction("down", { x: from[0], y: from[1] }, c);
    tools.executePointerAction("move", { x: to[0], y: to[1] }, c);
    tools.executePointerAction("up", { x: to[0], y: to[1] }, c);
  };
  const row = (y: number) => Array.from({ length: width }, (_, x) => layer.get(x, y));
  return { doc, layer, history, selection, tools, ctx, drag, row };
}

describe("mirror drawing", () => {
  it("mirrors pen strokes across one or both axes", () => {
    const { layer, tools, ctx, row } = setup(5, 3);
    tools.setTool("pen");
    tools.executePointerAction("down", { x: 0, y: 0 }, ctx({ mirror: { x: true, y: false } }));
    tools.executePointerAction("up", { x: 0, y: 0 }, ctx());
    expect(row(0)).toEqual([7, 0, 0, 0, 7]);
    tools.executePointerAction(
      "down",
      { x: 1, y: 0 },
      ctx({ value: 2, mirror: { x: true, y: true } })
    );
    tools.executePointerAction("up", { x: 1, y: 0 }, ctx());
    expect([layer.get(1, 0), layer.get(3, 0), layer.get(1, 2), layer.get(3, 2)]).toEqual([
      2, 2, 2, 2,
    ]);
  });
});

describe("shape modifiers", () => {
  it("Shift fills outline shapes", () => {
    const { layer, tools, ctx, drag } = setup(5, 5);
    tools.setTool("rect");
    drag([0, 0], [4, 4], ctx({ modifiers: { shift: true, alt: false, mod: false } }));
    expect(layer.get(2, 2)).toBe(7);
  });
});

describe("selection", () => {
  it("drags out a clipped selection and a click clears it", () => {
    const { selection, tools, drag } = setup();
    tools.setTool("select");
    drag([4, 1], [9, 9]);
    expect(selection.rect).toEqual({ x: 4, y: 1, width: 2, height: 3 });
    drag([0, 0], [0, 0]);
    expect(selection.rect).toBeNull();
  });

  it("moves selected pixels, keeps what's under transparent cells, and undoes in one step", () => {
    const { layer, history, selection, tools, drag, row } = setup();
    layer.set(0, 0, 1);
    layer.set(1, 0, 2);
    layer.set(4, 0, 9);
    tools.setTool("select");
    drag([0, 0], [2, 0]); // select 3 cells, the third is empty
    expect(selection.rect).toEqual({ x: 0, y: 0, width: 3, height: 1 });

    drag([1, 0], [3, 0]); // move right by 2
    expect(row(0)).toEqual([0, 0, 1, 2, 9, 0]);
    expect(selection.rect).toEqual({ x: 2, y: 0, width: 3, height: 1 });

    history.undo();
    expect(row(0)).toEqual([1, 2, 0, 0, 9, 0]);
    expect(selection.rect).toEqual({ x: 0, y: 0, width: 3, height: 1 });
    history.redo();
    expect(row(0)).toEqual([0, 0, 1, 2, 9, 0]);
  });

  it("does not move pixels on locked layers", () => {
    const { layer, selection, tools, drag, row } = setup();
    layer.set(0, 0, 1);
    tools.setTool("select");
    drag([0, 0], [0, 0]);
    selection.set({ x: 0, y: 0, width: 1, height: 1 });
    layer.locked = true;
    drag([0, 0], [3, 0]);
    expect(row(0)[0]).toBe(1);
  });

  it("keeps the selection and reports a blocked move on a locked layer", () => {
    const { doc, layer, history, selection, ctx, row } = setup();
    const blocked: string[] = [];
    const tools = new ToolManager<Int32Array>();
    tools.registerTool(
      new SelectTool<Int32Array>(selection, "select", { onBlocked: (l) => blocked.push(l.name) })
    );
    tools.setTool("select");
    layer.set(0, 0, 1);
    selection.set({ x: 0, y: 0, width: 2, height: 1 });
    layer.locked = true;
    const c = ctx();
    tools.executePointerAction("down", { x: 0, y: 0 }, c);
    tools.executePointerAction("move", { x: 3, y: 0 }, c);
    tools.executePointerAction("up", { x: 3, y: 0 }, c);
    expect(blocked).toEqual(["L"]);
    expect(selection.rect).toEqual({ x: 0, y: 0, width: 2, height: 1 });
    expect(row(0)[0]).toBe(1);
    expect(history.canUndo).toBe(false);
    expect(doc.layers).toHaveLength(1);
  });

  it("reads, clears and pastes regions", () => {
    const { layer } = setup(4, 2);
    layer.set(1, 0, 5);
    layer.set(2, 1, 6);
    const region = readRegion(layer, { x: 1, y: 0, width: 2, height: 2 });
    expect(region.values).toEqual([5, 0, 0, 6]);
    expect(clearRegionChanges(layer, { x: 0, y: 0, width: 4, height: 2 })).toHaveLength(2);
    const paste = pasteRegionChanges(layer, region, { x: 3, y: 0 });
    // Only the in-bounds, non-empty cell lands.
    expect(paste).toEqual([{ x: 3, y: 0, oldValue: 0, newValue: 5 }]);
  });
});

describe("compositeRgba", () => {
  it("blends visible layers with opacity", () => {
    const doc = new GridDocument<Uint32Array>({
      width: 1,
      height: 1,
      emptyValue: 0,
      bufferCtor: Uint32Array,
    });
    doc.addLayer("a").set(0, 0, 0xff0000ff); // red
    doc.addLayer({ name: "b", opacity: 0.5 }).set(0, 0, 0xffff0000); // blue
    expect(Array.from(compositeRgba(doc))).toEqual([128, 0, 128, 255]);
  });
});

describe("pixel byte order", () => {
  it("runs on a little-endian host", async () => {
    const { HOST_IS_LITTLE_ENDIAN, assertPixelByteOrder } = await import("../src");
    expect(HOST_IS_LITTLE_ENDIAN).toBe(true);
    expect(() => assertPixelByteOrder()).not.toThrow();
  });
});

describe("region transforms", () => {
  it("flips and rotates blocks", async () => {
    const { transformRegion } = await import("../src");
    // 3×2:  1 2 3
    //       4 5 6
    const r = { width: 3, height: 2, values: [1, 2, 3, 4, 5, 6] };
    expect(transformRegion(r, "flipX").values).toEqual([3, 2, 1, 6, 5, 4]);
    expect(transformRegion(r, "flipY").values).toEqual([4, 5, 6, 1, 2, 3]);
    // Clockwise: 2×3   4 1 / 5 2 / 6 3
    expect(transformRegion(r, "rotateCW")).toEqual({
      width: 2,
      height: 3,
      values: [4, 1, 5, 2, 6, 3],
    });
    // Counter-clockwise: 3 6 / 2 5 / 1 4
    expect(transformRegion(r, "rotateCCW").values).toEqual([3, 6, 2, 5, 1, 4]);
    // Four quarter turns are the identity.
    let t = r;
    for (let i = 0; i < 4; i++) t = transformRegion(t, "rotateCW");
    expect(t).toEqual(r);
  });
});
