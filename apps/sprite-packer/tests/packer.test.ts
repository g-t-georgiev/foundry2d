import { describe, it, expect } from "vite-plus/test";
import { buildAtlas, createImage } from "@foundry2d/atlas";
import { sheetFiles, safeName } from "../src/export";
import { isImagePath, spriteName } from "../src/io/images";
import { fromPackFile, PackFormatError, toPackFile } from "../src/io/packFile";
import { cleanName, PackProject, type SpriteImage } from "../src/model/PackProject";
import {
  atlasOptions,
  DEFAULT_SETTINGS,
  MAX_SHEET_SIDE,
  parseSettings,
  rotationBlocked,
} from "../src/model/settings";

const image = (name: string, content = name): SpriteImage => ({
  name,
  dataUrl: `data:image/png;base64,${btoa(content)}`,
  width: 4,
  height: 4,
});
const names = (project: PackProject) => project.sprites.map((s) => s.name);

describe("settings", () => {
  it("keeps valid values, clamps numbers and ignores the rest", () => {
    const s = parseSettings({
      algorithm: "grid",
      padding: -5,
      maxWidth: 1e9,
      extrude: 2.6,
      trim: "yes",
      heuristic: "nope",
      dataFormat: "godot-tres",
      border: NaN,
    });
    expect(s).toEqual({
      ...DEFAULT_SETTINGS,
      algorithm: "grid",
      padding: 0,
      maxWidth: MAX_SHEET_SIDE,
      extrude: 3,
      dataFormat: "godot-tres",
    });
    expect(parseSettings(null)).toEqual(DEFAULT_SETTINGS);
  });

  it("only rotates when the layout and the data format allow it, keeping the choice", () => {
    const on = { ...DEFAULT_SETTINGS, allowRotation: true };
    expect(rotationBlocked(on)).toBeNull();
    expect(atlasOptions(on).allowRotation).toBe(true);
    for (const patch of [{ algorithm: "grid" }, { dataFormat: "css" }] as const) {
      const blocked = { ...on, ...patch };
      expect(rotationBlocked(blocked)).not.toBeNull();
      expect(atlasOptions(blocked).allowRotation).toBe(false);
      expect(blocked.allowRotation).toBe(true);
    }
    expect(rotationBlocked({ ...on, dataFormat: "none" })).toBeNull();
  });
});

describe("pack project", () => {
  it("sorts by name with numbers in order and keeps names unique", () => {
    const p = new PackProject();
    expect(p.addImages([image("walk_10"), image("walk_2"), image("idle")])).toEqual({
      added: 3,
      updated: 0,
    });
    expect(names(p)).toEqual(["idle", "walk_2", "walk_10"]);
  });

  it("re-adding a name updates its image and keeps its id; unchanged images do nothing", () => {
    const p = new PackProject();
    p.addImages([image("a"), image("b")]);
    const id = p.sprites[0].id;
    expect(p.addImages([image("a", "new"), image("b")])).toEqual({ added: 0, updated: 1 });
    expect(p.sprites[0]).toMatchObject({ id, dataUrl: image("a", "new").dataUrl });
    p.history.undo();
    expect(p.sprites[0]).toMatchObject({ id, dataUrl: image("a").dataUrl });
    p.history.redo();
    p.addImages([image("b")]);
    expect(p.history.getState().undoLabel).toBe("Add sprites");
    p.history.undo();
    p.history.undo();
    expect(p.sprites).toHaveLength(0); // the no-op added no step
  });

  it("renames, refuses taken names, removes and undoes", () => {
    const p = new PackProject();
    p.addImages([image("a"), image("b")]);
    const [a, b] = p.sprites;
    expect(p.rename(a.id, "b")).toBe(false);
    expect(p.rename(a.id, " z / a ")).toBe(true);
    expect(names(p)).toEqual(["b", "z/a"]);
    expect(p.remove([b.id, "unknown"])).toBe(1);
    expect(p.remove(["unknown"])).toBe(0);
    p.history.undo();
    p.history.undo();
    expect(names(p)).toEqual(["a", "b"]);
  });

  it("settings are one undo step each, and equal ones add none", () => {
    const p = new PackProject();
    p.setSettings({ padding: 2 });
    expect(p.history.canUndo).toBe(false);
    p.setSettings({ padding: 5 });
    p.setSettings({ padding: NaN });
    expect(p.settings.padding).toBe(5);
    p.history.undo();
    expect(p.settings.padding).toBe(2);
    expect(p.history.canUndo).toBe(false);
  });
});

describe("names", () => {
  it("come from paths without the image extension", () => {
    expect(spriteName("player/walk_0.PNG")).toBe("player/walk_0");
    expect(spriteName("v1.2/icon.webp")).toBe("v1.2/icon");
    expect(isImagePath("notes.txt")).toBe(false);
    expect(isImagePath("png")).toBe(false);
    expect(cleanName("a\\b//../ c ")).toBe("a/b/c");
    expect(cleanName(" / ")).toBe("sprite");
    expect(safeName("My pack: 2")).toBe("My_pack_2");
  });
});

describe("work file", () => {
  it("round-trips name, settings and sprites", () => {
    const p = new PackProject();
    p.setName("hero");
    p.addImages([image("a"), image("dir/b")]);
    p.setSettings({ algorithm: "shelf", powerOfTwo: true });
    const read = fromPackFile(JSON.parse(JSON.stringify(toPackFile(p))));
    const copy = new PackProject();
    copy.load(read.name, read.images, read.settings);
    expect(toPackFile(copy)).toEqual(toPackFile(p));
    expect(copy.history.canUndo).toBe(false);
  });

  it("rejects other files, newer versions and broken sprites", () => {
    const good = toPackFile(new PackProject());
    const bad: unknown[] = [
      null,
      { format: "foundry2d.level", version: 1 },
      { ...good, version: 99 },
      { ...good, sprites: "none" },
      {
        ...good,
        sprites: [{ name: "x", width: 1, height: 1, image: "https://example.com/x.png" }],
      },
      { ...good, sprites: [{ name: "x", width: 0, height: 1, image: image("x").dataUrl }] },
    ];
    for (const json of bad) expect(() => fromPackFile(json)).toThrow(PackFormatError);
  });
});

describe("export files", () => {
  const inputs = Array.from({ length: 5 }, (_, i) => {
    const img = createImage(30, 30);
    img.data.fill(40 * i + 20);
    return { name: `s${i}.png`, image: img };
  });

  it("one sheet takes the pack's name, several are numbered and reference their own image", () => {
    const one = buildAtlas(inputs, { algorithm: "maxrects" });
    expect(
      sheetFiles("My pack", one.sheets, "json-hash").map((f) => [f.imageName, f.data?.name])
    ).toEqual([["My_pack.png", "My_pack.json"]]);
    const many = buildAtlas(inputs, { algorithm: "maxrects", maxWidth: 64, maxHeight: 64 });
    const files = sheetFiles("p", many.sheets, "json-hash");
    expect(files.map((f) => f.imageName)).toEqual(["p-0.png", "p-1.png"]);
    const metas = files.map(
      (f) => JSON.parse(f.data!.text) as { meta: { image: string }; frames: object }
    );
    expect(metas.map((m) => m.meta.image)).toEqual(["p-0.png", "p-1.png"]);
    expect(metas.flatMap((m) => Object.keys(m.frames))).toHaveLength(5);
  });

  it("writes no data file for images only", () => {
    const atlas = buildAtlas(inputs, { algorithm: "grid" });
    expect(sheetFiles("p", atlas.sheets, "none")[0].data).toBeNull();
  });
});
