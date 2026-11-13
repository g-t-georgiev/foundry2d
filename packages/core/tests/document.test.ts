import { describe, it, expect, vi } from "vite-plus/test";
import {
  GridDocument,
  GridLayer,
  encodeRLE,
  decodeRLE,
  serializeDocument,
  deserializeDocument,
  type SerializedDocument,
} from "../src";

const makeDoc = (width = 4, height = 3) =>
  new GridDocument<Int32Array>({ width, height, emptyValue: -1, bufferCtor: Int32Array });

describe("GridLayer", () => {
  it("fills with the empty value and bumps version only on real changes", () => {
    const layer = new GridLayer({
      id: "a",
      name: "A",
      width: 2,
      height: 2,
      emptyValue: -1,
      bufferCtor: Int32Array,
    });
    expect([...layer.data]).toEqual([-1, -1, -1, -1]);
    expect(layer.set(1, 1, 5)).toBe(true);
    expect(layer.version).toBe(1);
    expect(layer.set(1, 1, 5)).toBe(false);
    expect(layer.version).toBe(1);
    expect(layer.set(9, 9, 5)).toBe(false);
    expect(layer.get(9, 9)).toBe(-1);
  });

  it("resizes with an offset, cropping and padding as needed", () => {
    const layer = new GridLayer({
      id: "a",
      name: "A",
      width: 2,
      height: 2,
      emptyValue: 0,
      bufferCtor: Uint32Array,
      data: [1, 2, 3, 4],
    });
    layer.resize(3, 3, 1, 1);
    expect([...layer.data]).toEqual([0, 0, 0, 0, 1, 2, 0, 3, 4]);
    layer.resize(2, 2, -1, -1);
    expect([...layer.data]).toEqual([1, 2, 3, 4]);
  });

  it("is not editable when hidden, locked or transparent", () => {
    const layer = new GridLayer({
      id: "a",
      name: "A",
      width: 1,
      height: 1,
      emptyValue: 0,
      bufferCtor: Uint32Array,
    });
    expect(layer.isEditable).toBe(true);
    layer.locked = true;
    expect(layer.isEditable).toBe(false);
    layer.locked = false;
    layer.visible = false;
    expect(layer.isEditable).toBe(false);
  });
});

describe("GridDocument", () => {
  it("activates the first layer and emits structural events", () => {
    const doc = makeDoc();
    const onLayers = vi.fn();
    doc.events.on("layers:changed", onLayers);
    const a = doc.addLayer("A");
    const b = doc.addLayer("B");
    expect(doc.activeLayerId).toBe(a.id);
    expect(onLayers).toHaveBeenCalledTimes(2);
    expect(doc.layers.map((l) => l.id)).toEqual([a.id, b.id]);
  });

  it("refuses to remove the last layer and reselects a neighbour", () => {
    const doc = makeDoc();
    const a = doc.addLayer("A");
    const b = doc.addLayer({ name: "B", activate: true });
    expect(doc.removeLayer(b.id)?.newActiveId).toBe(a.id);
    expect(doc.removeLayer(a.id)).toBeNull();
    expect(doc.layers).toHaveLength(1);
  });

  it("generates unique ids even when explicit ids collide with the counter", () => {
    const doc = makeDoc();
    doc.addLayer({ id: "layer_2" });
    const second = doc.addLayer();
    const third = doc.addLayer();
    expect(new Set(doc.layers.map((l) => l.id)).size).toBe(3);
    expect([second.id, third.id]).not.toContain("layer_2");
  });

  it("clear skips locked layers when clearing everything", () => {
    const doc = makeDoc(2, 1);
    const a = doc.addLayer("A");
    const b = doc.addLayer("B");
    a.set(0, 0, 1);
    b.set(0, 0, 2);
    b.locked = true;
    const result = doc.clear();
    expect(result.map(([id]) => id)).toEqual([a.id]);
    expect(b.get(0, 0)).toBe(2);
  });
});

describe("serialization", () => {
  it("round-trips RLE data", () => {
    const data = [0, 0, 0, 5, 5, -1, 0];
    const encoded = encodeRLE(data);
    expect(encoded).toEqual([3, 0, 2, 5, 1, -1, 1, 0]);
    expect([...decodeRLE(encoded, data.length, Int32Array)]).toEqual(data);
  });

  it("rejects RLE data of the wrong length", () => {
    expect(() => decodeRLE([2, 1], 3, Int32Array)).toThrow(/expected 3/);
  });

  it("round-trips a document", () => {
    const doc = makeDoc(3, 2);
    const a = doc.addLayer("Walls");
    const b = doc.addLayer({ name: "Pellets", activate: true, locked: true, opacity: 0.5 });
    a.set(1, 1, 7);
    b.set(0, 0, 2);
    const copy = deserializeDocument(
      JSON.parse(JSON.stringify(serializeDocument(doc))) as SerializedDocument,
      Int32Array
    );
    expect(copy.activeLayerId).toBe(b.id);
    expect(copy.getLayer(a.id)?.get(1, 1)).toBe(7);
    expect(copy.getLayer(b.id)).toMatchObject({ locked: true, opacity: 0.5, name: "Pellets" });
    expect(copy.getLayer(b.id)?.get(0, 0)).toBe(2);
  });
});
