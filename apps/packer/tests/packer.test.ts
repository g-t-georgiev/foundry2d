import { describe, it, expect } from "vite-plus/test";
import { buildAtlas, createImage } from "@gs2d/atlas";
import { MemoryStorage, readZip } from "@gs2d/core";
import { frameName, sheetFiles, safeName } from "../src/export";
import { externalizeSprites, internalizeSprites } from "../src/io/assets";
import { findImage, isImagePath, spriteName } from "../src/io/images";
import { LiveFolder, type DirectoryLike } from "../src/io/liveFolder";
import { fromPackFile, PackFormatError, toPackFile } from "../src/io/packFile";
import { detectAnimations, frameTags, packOrder } from "../src/model/animations";
import { cleanName, PackProject, type SpriteImage } from "../src/model/PackProject";
import { Jobs, type Request } from "../src/pack/jobs";
import { Packer } from "../src/pack/Packer";
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
    // Sprites turn the way the format's engines expect.
    expect(atlasOptions(on).turn).toBe("cw");
    expect(atlasOptions({ ...on, dataFormat: "libgdx-atlas" })).toMatchObject({
      allowRotation: true,
      turn: "ccw",
    });
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

  it("opens packs from before Game Studio 2D", () => {
    const old = { ...toPackFile(new PackProject()), format: "foundry2d.pack" };
    expect(fromPackFile(old).images).toEqual([]);
    expect(toPackFile(new PackProject()).format).toBe("gs2d.pack");
  });

  it("rejects other files, newer versions and broken sprites", () => {
    const good = toPackFile(new PackProject());
    const bad: unknown[] = [
      null,
      { format: "gs2d.level", version: 1 },
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
      [...sheetFiles("My pack", one.sheets, DEFAULT_SETTINGS)].map((f) => [
        f.imageName,
        f.data[0]?.name,
      ])
    ).toEqual([["My_pack.png", "My_pack.json"]]);
    const many = buildAtlas(inputs, { algorithm: "maxrects", maxWidth: 64, maxHeight: 64 });
    const files = [...sheetFiles("p", many.sheets, DEFAULT_SETTINGS)];
    expect(files.map((f) => f.imageName)).toEqual(["p-0.png", "p-1.png"]);
    const metas = files.map(
      (f) => JSON.parse(f.data[0].text) as { meta: { image: string }; frames: object }
    );
    expect(metas.map((m) => m.meta.image)).toEqual(["p-0.png", "p-1.png"]);
    expect(metas.flatMap((m) => Object.keys(m.frames))).toHaveLength(5);
  });

  it("writes no data file for images only", () => {
    const atlas = buildAtlas(inputs, { algorithm: "grid" });
    expect(
      [...sheetFiles("p", atlas.sheets, { ...DEFAULT_SETTINGS, dataFormat: "none" })][0].data
    ).toEqual([]);
  });
});

describe("animations", () => {
  it("are names that differ in a trailing number, in number order", () => {
    const found = detectAnimations([
      "walk_10",
      "walk_2",
      "idle",
      "run/0",
      "run/1",
      "jump (1)",
      "jump (2)",
      "7",
      "8",
      "solo_1",
    ]);
    expect(found).toEqual([
      { name: "walk", frames: ["walk_2", "walk_10"] },
      { name: "run", frames: ["run/0", "run/1"] },
      { name: "jump", frames: ["jump (1)", "jump (2)"] },
      { name: "animation", frames: ["7", "8"] },
    ]);
  });

  it("are packed together and become ranges of the sheet that holds all their frames", () => {
    const names = ["a_1", "a_1 shadow", "a_2", "b_1", "b_2", "z"];
    const animations = detectAnimations(names);
    const order = packOrder(names, animations);
    expect(order).toEqual(["a_1", "a_2", "a_1 shadow", "b_1", "b_2", "z"]);
    expect(frameTags(order, animations).map((t) => [t.name, t.from, t.to])).toEqual([
      ["a", 0, 1],
      ["b", 3, 4],
    ]);
    // Frames on another sheet: left out instead of half an animation.
    expect(frameTags(["a_1", "b_1", "b_2"], animations).map((t) => t.name)).toEqual(["b"]);
  });
});

describe("pivots", () => {
  it("are set, cleared and undone, and survive re-imports, renames and files", () => {
    const p = new PackProject();
    p.addImages([image("a"), image("b")]);
    const ids = p.sprites.map((s) => s.id);
    p.setPivot(ids, { x: 0.33333, y: 50 });
    expect(p.sprites.map((s) => s.pivot)).toEqual([
      { x: 0.333, y: 10 },
      { x: 0.333, y: 10 },
    ]);
    p.setPivot([ids[0]], { x: 0.333, y: 10 }); // no change, no step
    p.addImages([image("a", "new")]);
    p.rename(ids[1], "c");
    const read = fromPackFile(JSON.parse(JSON.stringify(toPackFile(p))));
    expect(read.images.map((i) => i.pivot)).toEqual(p.sprites.map((s) => s.pivot));
    expect(p.sprites[0].pivot).toEqual({ x: 0.333, y: 10 });
    for (let i = 0; i < 3; i++) p.history.undo();
    expect(p.sprites.every((s) => s.pivot === undefined)).toBe(true);
    const odd = { ...toPackFile(p), sprites: [{ ...toPackFile(p).sprites[0], pivot: { x: "0" } }] };
    expect(fromPackFile(odd).images[0].pivot).toBeUndefined();
  });
});

describe("packing in a worker", () => {
  /** A worker that answers like the real one, or breaks at its `fails`-th message. */
  class FakeWorker {
    onmessage: ((ev: { data: unknown }) => void) | null = null;
    onerror: ((ev: { preventDefault(): void }) => void) | null = null;
    onmessageerror: (() => void) | null = null;
    terminated = false;
    readonly images: number[] = [];
    private readonly jobs = new Jobs();

    constructor(private fails = Infinity) {}

    postMessage({ id, request }: { id: number; request: Request }): void {
      this.images.push(request.type === "pack" ? request.images.length : -1);
      if (--this.fails === 0) {
        queueMicrotask(() => this.onerror?.({ preventDefault() {} }));
        return;
      }
      void (async () => {
        try {
          this.onmessage?.({ data: { id, result: await this.jobs.run(request) } });
        } catch (error) {
          this.onmessage?.({ data: { id, error: (error as Error).message } });
        }
      })();
    }

    terminate(): void {
      this.terminated = true;
    }
  }
  const sprites = [1, 2, 3].map((n) => {
    const img = createImage(n * 4, 8);
    img.data.fill(n * 50);
    return { name: `s${n}.png`, image: img };
  });
  const options = { algorithm: "maxrects" } as const;
  const start = (worker: FakeWorker) => new Packer(() => worker as unknown as Worker);

  it("sends each image once and passes errors on", async () => {
    const worker = new FakeWorker();
    const packer = start(worker);
    expect(await packer.pack(sprites.slice(0, 2), options)).toEqual(
      buildAtlas(sprites.slice(0, 2), options)
    );
    expect(await packer.pack(sprites, options)).toEqual(buildAtlas(sprites, options));
    await packer.pack(sprites.slice(2), options);
    // The first two were dropped, so they are sent again.
    expect(await packer.pack(sprites, options)).toEqual(buildAtlas(sprites, options));
    expect(worker.images).toEqual([2, 1, 0, 2]);
    await expect(packer.pack(sprites, { ...options, maxWidth: 4, maxHeight: 4 })).rejects.toThrow();
    expect(await packer.pack(sprites, options)).toEqual(buildAtlas(sprites, options));
    expect(packer.inWorker).toBe(true);
  });

  it("goes on without the worker when it dies or can't start", async () => {
    for (const fails of [1, 2]) {
      const worker = new FakeWorker(fails);
      const packer = start(worker);
      expect(await packer.pack(sprites, options)).toEqual(buildAtlas(sprites, options));
      expect(await packer.pack(sprites, options)).toEqual(buildAtlas(sprites, options));
      expect(worker.terminated).toBe(true);
      expect(packer.inWorker).toBe(false);
      expect(await packer.pack(sprites.slice(1), options)).toEqual(
        buildAtlas(sprites.slice(1), options)
      );
      expect(await packer.pack(sprites, options)).toEqual(buildAtlas(sprites, options));
    }
    const none = new Packer(() => {
      throw new Error("no workers");
    });
    expect(await none.pack(sprites, options)).toEqual(buildAtlas(sprites, options));
  });

  it("exports the sheets as files or one ZIP", async () => {
    const packer = start(new FakeWorker());
    const { sheets } = await packer.pack(sprites, options);
    const request = { name: "p", sheets, settings: DEFAULT_SETTINGS, animations: [] };
    const files = await packer.export({ ...request, output: "files" });
    expect(files.map((f) => [f.name, f.mime])).toEqual([
      ["p.png", "image/png"],
      ["p.json", "application/json"],
    ]);
    const [zip] = await packer.export({ ...request, output: "zip" });
    const entries = await readZip(zip.bytes);
    expect(entries.map((e) => e.name)).toEqual(["p.png", "p.json"]);
    expect(entries[0].data).toEqual(files[0].bytes);
  });
});

describe("export variants", () => {
  it("writes every scale with its own names, sizes and animations", () => {
    const atlas = buildAtlas(
      ["w_1", "w_2"].map((n, i) => {
        const img = createImage(10, 10);
        img.data.fill(100 + i);
        return { name: frameName(n), image: img, duration: 50, pivot: { x: 0, y: 1 } };
      }),
      { algorithm: "horizontal" }
    );
    const settings = parseSettings({ scales: [2, 1, 9], imageFormat: "webp" });
    expect(settings.scales).toEqual([1, 2]);
    const files = [...sheetFiles("p", atlas.sheets, settings, detectAnimations(["w_1", "w_2"]))];
    expect(files.map((f) => [f.imageName, f.image.width, f.data[0].name])).toEqual([
      ["p.webp", 20, "p.json"],
      ["p@2x.webp", 40, "p@2x.json"],
    ]);
    const data = JSON.parse(files[1].data[0].text) as {
      frames: Record<string, { frame: unknown; anchor: unknown; duration: number }>;
      animations: unknown;
      meta: { image: string; scale: string };
    };
    expect(data.meta).toMatchObject({ image: "p@2x.webp", scale: "2" });
    expect(data.frames["w_2.png"]).toMatchObject({
      frame: { x: 20, y: 0, w: 20, h: 20 },
      anchor: { x: 0, y: 1 },
      duration: 50,
    });
    expect(data.animations).toEqual({ w: ["w_1.png", "w_2.png"] });
    // A single scale needs no suffix.
    const only = [...sheetFiles("p", atlas.sheets, { ...settings, scales: [3] })];
    expect(only.map((f) => [f.imageName, f.image.width])).toEqual([["p.webp", 60]]);
    expect(parseSettings({ scales: [] }).scales).toEqual([1]);
  });
});

describe("sheet images for data files", () => {
  it("are the named one next to the data, else one with the same name", () => {
    const file = (path: string) =>
      [path.toLowerCase(), { path, file: new File([], path) }] as const;
    const images = new Map([file("art/Hero.png"), file("art/other.webp"), file("hero.png")]);
    expect(findImage(images, "art/data.json", { image: "hero.png" })?.path).toBe("art/Hero.png");
    expect(findImage(images, "art/other.json", { image: "" })?.path).toBe("art/other.webp");
    expect(findImage(images, "art/other.json", { image: "gone.png" })?.path).toBe("art/other.webp");
    expect(findImage(images, "art/none.json", { image: "gone.png" })).toBeUndefined();
  });
});

describe("browser storage", () => {
  it("keeps images in the asset store and brings them back", async () => {
    const storage = new MemoryStorage();
    const p = new PackProject();
    p.addImages([image("a"), image("b", "a"), image("c")]);
    const file = toPackFile(p);
    const stored = await externalizeSprites(file, storage.assets);
    expect(JSON.stringify(stored)).not.toContain("base64");
    expect(await internalizeSprites(stored, storage.assets)).toEqual(file);
    await storage.assets.prune([]);
    await expect(internalizeSprites(stored, storage.assets)).rejects.toThrow(PackFormatError);
  });
});

describe("live folders", () => {
  /** An in-memory folder: path → file. */
  function folder(name: string, files: Record<string, File>): DirectoryLike {
    const at = (prefix: string, label: string): DirectoryLike => ({
      kind: "directory",
      name: label,
      async *values() {
        await Promise.resolve(); // like a real folder, entries come later
        const seen = new Set<string>();
        for (const path of Object.keys(files)) {
          if (!path.startsWith(prefix)) continue;
          const [head, ...rest] = path.slice(prefix.length).split("/");
          if (rest.length === 0) {
            yield {
              kind: "file" as const,
              name: head,
              getFile: () => Promise.resolve(files[path]),
            };
          } else if (!seen.has(head)) {
            seen.add(head);
            yield at(`${prefix}${head}/`, head);
          }
        }
      },
    });
    return at("", name);
  }
  const file = (content: string, lastModified: number) =>
    new File([content], "x", { lastModified });

  it("reports new, changed and removed images and sprites once", async () => {
    const files: Record<string, File> = {
      "a.png": file("1", 1),
      "run/b.webp": file("1", 1),
      "hero.gs2dsprite": file("1", 1),
      "notes.txt": file("1", 1),
      "data.json": file("1", 1),
    };
    const live = new LiveFolder(folder("art", files));
    const scan = async () => {
      const { changed, removed } = await live.scan();
      return [changed.map((c) => c.path).sort(), removed];
    };
    expect(await scan()).toEqual([["art/a.png", "art/hero.gs2dsprite", "art/run/b.webp"], []]);
    expect(await scan()).toEqual([[], []]);
    files["a.png"] = file("22", 1);
    files["run/b.webp"] = file("1", 2);
    delete files["hero.gs2dsprite"];
    expect(await scan()).toEqual([["art/a.png", "art/run/b.webp"], ["art/hero.gs2dsprite"]]);
    expect(await scan()).toEqual([[], []]);
  });

  it("files that vanish or are being written don't end the scan", async () => {
    let trouble: string | null = null;
    const flaky = {
      kind: "file" as const,
      name: "a.png",
      getFile: () =>
        trouble
          ? Promise.reject(new DOMException("no", trouble))
          : Promise.resolve(new File(["1"], "a.png", { lastModified: 1 })),
    };
    const live = new LiveFolder({
      kind: "directory",
      name: "art",
      async *values() {
        yield await Promise.resolve(flaky);
      },
    });
    const scan = async () => {
      const { changed, removed } = await live.scan();
      return [changed.length, removed];
    };
    expect(await scan()).toEqual([1, []]);
    trouble = "NotReadableError";
    expect(await scan()).toEqual([0, []]);
    trouble = null;
    expect(await scan()).toEqual([0, []]);
    trouble = "NotFoundError";
    expect(await scan()).toEqual([0, ["art/a.png"]]);
  });

  it("updates and removals are one undo step", () => {
    const p = new PackProject();
    p.addImages([image("a"), image("b")]);
    expect(p.sync([image("a", "new"), image("c")], ["b", "unknown"])).toEqual({
      added: 1,
      updated: 1,
      removed: 1,
    });
    expect(names(p)).toEqual(["a", "c"]);
    p.history.undo();
    expect(names(p)).toEqual(["a", "b"]);
  });
});
