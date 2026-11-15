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

describe("GridDocument policy and replace", () => {
  it("reports what the UI may do with a layer", () => {
    const doc = makeDoc();
    expect(doc.getPolicy()).toMatchObject({ canDraw: false, reason: "NO_LAYER" });
    const a = doc.addLayer("A");
    expect(doc.getPolicy()).toMatchObject({
      canDraw: true,
      canDelete: false,
      canMoveUp: false,
      canMoveDown: false,
    });
    const b = doc.addLayer("B");
    expect(doc.getPolicy(a.id)).toMatchObject({
      canDelete: true,
      canMoveUp: true,
      canMoveDown: false,
    });
    expect(doc.getPolicy(b.id)).toMatchObject({ canMoveUp: false, canMoveDown: true });
    b.visible = false;
    expect(doc.getPolicy(b.id)).toMatchObject({ canDraw: false, reason: "HIDDEN" });
    a.opacity = 0;
    expect(doc.getPolicy(a.id).reason).toBe("TRANSPARENT");
  });

  it("replaceWith swaps contents in place and notifies listeners", () => {
    const doc = makeDoc(2, 2);
    doc.addLayer("Old");
    const source = makeDoc(3, 1);
    const kept = source.addLayer("New");
    kept.set(2, 0, 9);
    const events: string[] = [];
    doc.events.on("resized", () => events.push("resized"));
    doc.events.on("layers:changed", () => events.push("layers"));
    doc.events.on("layer:activated", () => events.push("active"));

    doc.replaceWith(source);
    expect([doc.width, doc.height]).toEqual([3, 1]);
    expect(doc.layers.map((l) => l.name)).toEqual(["New"]);
    expect(doc.activeLayerId).toBe(kept.id);
    expect(doc.getActiveLayer()?.get(2, 0)).toBe(9);
    expect(events).toEqual(["resized", "layers", "active"]);
    // New layers must not collide with the adopted ids.
    expect(doc.addLayer().id).not.toBe(kept.id);
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

describe("layers with their own cell size (scale)", () => {
  const make = () =>
    new GridDocument<Uint32Array>({ width: 6, height: 4, emptyValue: 0, bufferCtor: Uint32Array });

  it("sizes scaled layers to cover the document", () => {
    const doc = make();
    const coarse = doc.addLayer({ name: "coarse", scale: 4 });
    const fine = doc.addLayer({ name: "fine", scale: 0.5 });
    expect([coarse.width, coarse.height]).toEqual([2, 1]);
    expect([fine.width, fine.height]).toEqual([12, 8]);
    expect(doc.layerSize(1.5)).toEqual({ width: 4, height: 3 });
  });

  it("resizes scaled layers with offsets in their own cells", () => {
    const doc = make();
    const coarse = doc.addLayer({ name: "coarse", scale: 2 });
    coarse.set(0, 0, 7);
    doc.resize(10, 4, 4, 0);
    expect([coarse.width, coarse.height]).toEqual([5, 2]);
    expect(coarse.get(2, 0)).toBe(7);
  });

  it("resamples when the scale changes, keeping the picture in place", () => {
    const doc = make();
    const layer = doc.addLayer("a");
    layer.set(2, 1, 5);
    layer.set(3, 1, 5);
    expect(doc.setLayerScale(layer.id, 2)).toBe(true);
    expect([layer.width, layer.height, layer.scale]).toEqual([3, 2, 2]);
    expect(layer.get(1, 0)).toBe(5); // centre (3, 1) of coarse cell (1, 0)
    doc.setLayerScale(layer.id, 1);
    expect(layer.get(2, 0)).toBe(5);
    expect(layer.get(3, 1)).toBe(5);
  });
});

describe("ZIP reading", () => {
  it("reads back what createZip writes", async () => {
    const { createZip, readZip, isZip } = await import("../src");
    const text = new TextEncoder().encode("hello");
    const zip = createZip([
      { name: "a.txt", data: text },
      { name: "images/b.bin", data: new Uint8Array([1, 2, 3]) },
    ]);
    expect(isZip(zip)).toBe(true);
    expect(isZip(text)).toBe(false);
    const entries = await readZip(zip);
    expect(entries.map((e) => e.name)).toEqual(["a.txt", "images/b.bin"]);
    expect(new TextDecoder().decode(entries[0].data)).toBe("hello");
    expect([...entries[1].data]).toEqual([1, 2, 3]);
  });

  it("rejects data that isn't a ZIP", async () => {
    const { readZip } = await import("../src");
    await expect(readZip(new Uint8Array(40))).rejects.toThrow(/Not a ZIP/);
  });
});
