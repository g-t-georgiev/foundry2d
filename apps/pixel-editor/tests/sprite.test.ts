import { describe, it, expect } from "vite-plus/test";
import { HistoryManager } from "@foundry2d/core";
import { Sprite } from "../src/model/Sprite";
import {
  AddFrameCommand,
  MoveFrameCommand,
  RemoveFrameCommand,
  SetFrameDurationCommand,
  addLayerToAllFrames,
  deleteLayerFromAllFrames,
  resizeAllFrames,
  setLayerPropertyInAllFrames,
} from "../src/model/commands";
import { fromProjectFile, toProjectFile, ProjectFormatError } from "../src/io/project";

const RED = 0xff0000ff;
const layerIds = (s: Sprite) => s.frames.map((f) => f.doc.layers.map((l) => l.id).join(","));

describe("Sprite frames", () => {
  it("adds blank and duplicated frames with the same layers, undoably", () => {
    const sprite = Sprite.create(4, 4);
    const history = new HistoryManager();
    sprite.doc.layers[0].set(1, 1, RED);

    history.execute(new AddFrameCommand(sprite, sprite.createFrame(null), 1));
    expect(sprite.frames).toHaveLength(2);
    expect(sprite.currentIndex).toBe(1);
    expect(sprite.doc.layers[0].get(1, 1)).toBe(0);

    history.execute(new AddFrameCommand(sprite, sprite.createFrame(0), 2));
    expect(sprite.frames[2].doc.layers[0].get(1, 1)).toBe(RED);
    expect(new Set(layerIds(sprite)).size).toBe(1);

    history.undo();
    history.undo();
    expect(sprite.frames).toHaveLength(1);
    expect(sprite.currentIndex).toBe(0);
  });

  it("moves, retimes and deletes frames (keeping at least one)", () => {
    const sprite = Sprite.create(2, 2);
    const history = new HistoryManager();
    history.execute(new AddFrameCommand(sprite, sprite.createFrame(null), 1));
    const second = sprite.frames[1];

    history.execute(new MoveFrameCommand(sprite, 1, 0));
    expect(sprite.frames[0]).toBe(second);
    expect(sprite.current).toBe(second);

    history.execute(new SetFrameDurationCommand(sprite, second, 250));
    expect(sprite.frameDuration(0)).toBe(250);
    expect(sprite.frameDuration(1)).toBe(Math.round(1000 / sprite.fps));
    history.undo();
    expect(second.duration).toBeNull();

    const remove = new RemoveFrameCommand(sprite, 0);
    remove.execute();
    expect(remove.succeeded).toBe(true);
    const last = new RemoveFrameCommand(sprite, 0);
    last.execute();
    expect(last.succeeded).toBe(false);
    remove.undo();
    expect(sprite.frames).toHaveLength(2);
  });

  it("applies layer edits and resizes to every frame", () => {
    const sprite = Sprite.create(4, 4);
    const history = new HistoryManager();
    history.execute(new AddFrameCommand(sprite, sprite.createFrame(null), 1));

    history.execute(addLayerToAllFrames(sprite, sprite.doc.layers[0].id));
    expect(sprite.frames.every((f) => f.doc.layers.length === 2)).toBe(true);
    expect(new Set(layerIds(sprite)).size).toBe(1);

    const top = sprite.doc.layers[1].id;
    history.execute(setLayerPropertyInAllFrames(sprite, top, "visible", false));
    expect(sprite.frames.every((f) => f.doc.getLayer(top)?.visible === false)).toBe(true);

    history.execute(deleteLayerFromAllFrames(sprite, top)!);
    expect(sprite.frames.every((f) => f.doc.layers.length === 1)).toBe(true);

    history.execute(resizeAllFrames(sprite, 8, 2));
    expect(sprite.frames.every((f) => f.doc.width === 8 && f.doc.height === 2)).toBe(true);

    for (let i = 0; i < 4; i++) history.undo();
    expect(sprite.frames.every((f) => f.doc.width === 4 && f.doc.layers.length === 1)).toBe(true);
  });

  it("keeps the active layer when switching frames", () => {
    const sprite = Sprite.create(2, 2);
    const history = new HistoryManager();
    history.execute(addLayerToAllFrames(sprite, sprite.doc.layers[0].id));
    history.execute(new AddFrameCommand(sprite, sprite.createFrame(null), 1));
    sprite.doc.setActiveLayer(sprite.doc.layers[0].id);
    sprite.selectFrame(0);
    expect(sprite.doc.activeLayerId).toBe(sprite.doc.layers[0].id);
  });
});

describe("pixel project file", () => {
  it("round-trips frames, durations and fps", () => {
    const sprite = Sprite.create(3, 2);
    sprite.setFps(12);
    sprite.insertFrame(sprite.createFrame(null), 1);
    sprite.frames[1].doc.layers[0].set(2, 1, RED);
    sprite.setFrameDuration(1, 300);

    const { sprite: copy, name } = fromProjectFile(
      JSON.parse(JSON.stringify(toProjectFile(sprite, "walk")))
    );
    expect(name).toBe("walk");
    expect(copy.fps).toBe(12);
    expect(copy.frames.map((f) => f.duration)).toEqual([null, 300]);
    expect(copy.frames[1].doc.layers[0].get(2, 1)).toBe(RED);
  });

  it("opens version 1 files as a single frame", () => {
    const sprite = Sprite.create(2, 2);
    const v2 = toProjectFile(sprite, "old");
    const v1 = { format: v2.format, version: 1, name: "old", document: v2.frames[0].document };
    expect(fromProjectFile(v1).sprite.frames).toHaveLength(1);
  });

  it("rejects frames with different layers", () => {
    const sprite = Sprite.create(2, 2);
    sprite.insertFrame(sprite.createFrame(null), 1);
    const file = toProjectFile(sprite, "bad");
    file.frames[1].document.layers[0].id = "other";
    expect(() => fromProjectFile(file)).toThrow(ProjectFormatError);
  });
});
