import { describe, it, expect, vi } from "vite-plus/test";
import {
  GridDocument,
  HistoryManager,
  AddLayerCommand,
  DeleteLayerCommand,
  MoveLayerCommand,
  SetLayerPropertyCommand,
  ClearCommand,
  ResizeCommand,
  CompositeCommand,
  type ICommand,
} from "../src";

const makeDoc = () =>
  new GridDocument<Uint32Array>({ width: 3, height: 3, emptyValue: 0, bufferCtor: Uint32Array });

describe("HistoryManager", () => {
  it("undoes and redoes, notifying listeners", () => {
    const history = new HistoryManager();
    const log: string[] = [];
    const cmd: ICommand = {
      label: "x",
      execute: () => log.push("do"),
      undo: () => log.push("undo"),
    };
    const listener = vi.fn();
    history.onChange(listener);

    history.execute(cmd);
    expect(history.getState()).toMatchObject({ canUndo: true, canRedo: false, undoLabel: "x" });
    history.undo();
    history.redo();
    expect(log).toEqual(["do", "undo", "do"]);
    expect(listener).toHaveBeenCalledTimes(3);
  });

  it("drops the oldest steps beyond the limit and clears redo on record", () => {
    const history = new HistoryManager({ limit: 2 });
    const noop = (): ICommand => ({ execute() {}, undo() {} });
    history.record(noop());
    history.record(noop());
    history.record(noop());
    expect(history.undo()).toBe(true);
    expect(history.undo()).toBe(true);
    expect(history.undo()).toBe(false);
    history.record(noop());
    expect(history.canRedo).toBe(false);
  });

  it("composite commands undo in reverse order", () => {
    const log: number[] = [];
    const make = (n: number): ICommand => ({
      execute: () => log.push(n),
      undo: () => log.push(-n),
    });
    const composite = new CompositeCommand([make(1), make(2)]);
    composite.execute();
    composite.undo();
    expect(log).toEqual([1, 2, -2, -1]);
  });
});

describe("layer commands", () => {
  it("add/delete layer round trip restores order and active layer", () => {
    const doc = makeDoc();
    const history = new HistoryManager();
    const base = doc.addLayer("Base");
    const add = new AddLayerCommand(doc, { name: "Top" });
    history.execute(add);
    const top = add.createdLayer!;
    expect(doc.activeLayerId).toBe(top.id);

    history.undo();
    expect(doc.layers.map((l) => l.id)).toEqual([base.id]);
    expect(doc.activeLayerId).toBe(base.id);

    history.redo();
    expect(doc.layers.map((l) => l.id)).toEqual([base.id, top.id]);

    const del = new DeleteLayerCommand(doc, base.id);
    history.execute(del);
    expect(del.succeeded).toBe(true);
    expect(doc.layers.map((l) => l.id)).toEqual([top.id]);
    history.undo();
    expect(doc.layers.map((l) => l.id)).toEqual([base.id, top.id]);
  });

  it("refuses deleting the last layer", () => {
    const doc = makeDoc();
    const only = doc.addLayer();
    const del = new DeleteLayerCommand(doc, only.id);
    del.execute();
    expect(del.succeeded).toBe(false);
    expect(doc.layers).toHaveLength(1);
  });

  it("moves layers and sets properties reversibly", () => {
    const doc = makeDoc();
    const a = doc.addLayer("A");
    const b = doc.addLayer("B");
    const history = new HistoryManager();

    history.execute(new MoveLayerCommand(doc, 0, 1));
    expect(doc.layers.map((l) => l.id)).toEqual([b.id, a.id]);
    history.undo();
    expect(doc.layers.map((l) => l.id)).toEqual([a.id, b.id]);

    history.execute(new SetLayerPropertyCommand(doc, a.id, "visible", false));
    expect(a.visible).toBe(false);
    history.undo();
    expect(a.visible).toBe(true);
  });
});

describe("document commands", () => {
  it("clear is undoable", () => {
    const doc = makeDoc();
    const layer = doc.addLayer();
    layer.set(1, 1, 0xff0000ff);
    const clear = new ClearCommand(doc);
    clear.execute();
    expect(clear.isNoop).toBe(false);
    expect(layer.isEmpty()).toBe(true);
    clear.undo();
    expect(layer.get(1, 1)).toBe(0xff0000ff);
  });

  it("resize undo restores content cropped by shrinking", () => {
    const doc = makeDoc();
    const layer = doc.addLayer();
    layer.set(2, 2, 42);
    const resize = new ResizeCommand(doc, { width: 2, height: 2 });
    resize.execute();
    expect(doc.width).toBe(2);
    expect(layer.data).toHaveLength(4);
    resize.undo();
    expect(doc.width).toBe(3);
    expect(layer.get(2, 2)).toBe(42);
    resize.execute();
    expect(layer.data).toHaveLength(4);
  });
});
