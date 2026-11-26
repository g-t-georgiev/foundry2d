import { describe, it, expect } from "vite-plus/test";
import { layerIdFor } from "../src/model/LevelProject";
import { createProjectFromPreset } from "../src/model/presets";
import {
  ANY_VALUE,
  createRule,
  generateAutoTiles,
  resizePattern,
  type AutoRule,
  type AutoStack,
} from "../src/model/autoRules";
import { decodeTile } from "../src/model/tiles";
import { deserializeProject, serializeProject } from "../src/io/projectFile";
import { toGameFormat } from "../src/io/gameFormat";

const PNG = "data:image/png;base64,iVBORw0KGgo=";

/** Parses rows like "##.." into values (# = 1, ~ = 2, . = 0). */
const grid = (...rows: string[]) => ({
  width: rows[0].length,
  height: rows.length,
  data: rows.flatMap((r) => r.split("").map((c) => (c === "#" ? 1 : c === "~" ? 2 : 0))),
});

/** Tile ids (or "." for empty), with "<" / "^" marking flipped tiles, row by row. */
const show = (cells: Int32Array, width: number) => {
  const rows: string[] = [];
  for (let i = 0; i < cells.length; i += width) {
    rows.push(
      Array.from(cells.slice(i, i + width), (v) => {
        const t = decodeTile(v);
        return t ? `${t.tileId}${t.flipX ? "<" : ""}${t.flipY ? "^" : ""}` : ".";
      }).join(" ")
    );
  }
  return rows;
};

const rule = (uid: number, patch: Partial<AutoRule>): AutoRule => ({
  ...createRule(uid, null),
  ...patch,
});

describe("auto-rule engine", () => {
  it("places the first matching rule's tile: grass on top, dirt below", () => {
    const g = grid("....", ".##.", "####");
    const rules = [
      // Top surface: ground with empty above.
      rule(1, { pattern: [0, -ANY_VALUE, 0, 0, 1, 0, 0, 0, 0], tileIds: [0] }),
      // Everything else that is ground.
      rule(2, { pattern: [0, 0, 0, 0, 1, 0, 0, 0, 0], tileIds: [1] }),
    ];
    expect(show(generateAutoTiles(g.data, g.width, g.height, rules), g.width)).toEqual([
      ". . . .",
      ". 0 0 .",
      "0 1 1 0",
    ]);
  });

  it("treats cells past the edge as the nearest edge cell", () => {
    const g = grid("##");
    // "Empty above" never matches on the top row, because the row continues upwards.
    const rules = [rule(1, { pattern: [0, -ANY_VALUE, 0, 0, 1, 0, 0, 0, 0], tileIds: [0] })];
    expect(show(generateAutoTiles(g.data, 2, 1, rules), 2)).toEqual([". ."]);
  });

  it("tries mirrored patterns and flips the tile to match", () => {
    const g = grid(".##.");
    // Left end of a run: empty on the left. With flipX it also covers right ends.
    const rules = [
      rule(1, { pattern: [0, 0, 0, -ANY_VALUE, 1, 0, 0, 0, 0], tileIds: [5], flipX: true }),
    ];
    expect(show(generateAutoTiles(g.data, 4, 1, rules), 4)).toEqual([". 5 5< ."]);
  });

  it("supports not-equal conditions, chance and stable random variants", () => {
    const g = grid("#~#~");
    const notWater = [rule(1, { pattern: [0, 0, 0, 0, -2, 0, 0, 0, 0], tileIds: [3] })];
    expect(show(generateAutoTiles(g.data, 4, 1, notWater), 4)).toEqual(["3 . 3 ."]);

    const wide = Array.from({ length: 400 }, () => 1);
    const variants = [rule(1, { pattern: [0, 0, 0, 0, 1, 0, 0, 0, 0], tileIds: [1, 2] })];
    const a = generateAutoTiles(wide, 20, 20, variants, 7);
    expect(generateAutoTiles(wide, 20, 20, variants, 7)).toEqual(a);
    const ids = new Set([...a].map((v) => decodeTile(v)!.tileId));
    expect(ids).toEqual(new Set([1, 2]));
    expect(generateAutoTiles(wide, 20, 20, variants, 8)).not.toEqual(a);

    const half = [rule(1, { pattern: [0, 0, 0, 0, 1, 0, 0, 0, 0], tileIds: [1], chance: 0.5 })];
    const filled = [...generateAutoTiles(wide, 20, 20, half)].filter((v) => v !== 0).length;
    expect(filled).toBeGreaterThan(150);
    expect(filled).toBeLessThan(250);
  });

  it("skips inactive rules and rules without tiles", () => {
    const g = grid("#");
    const rules = [
      rule(1, { pattern: [0, 0, 0, 0, 1, 0, 0, 0, 0], tileIds: [9], active: false }),
      rule(2, { pattern: [0, 0, 0, 0, 1, 0, 0, 0, 0], tileIds: [] }),
      rule(3, { size: 1, pattern: [1], tileIds: [4] }),
    ];
    expect(show(generateAutoTiles(g.data, 1, 1, rules), 1)).toEqual(["4"]);
  });

  it("resizes patterns around the centre", () => {
    const p3 = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    const p5 = resizePattern(p3, 3, 5);
    expect(p5[12]).toBe(5);
    expect(p5[6]).toBe(1);
    expect(p5[0]).toBe(0);
    expect(resizePattern(p5, 5, 3)).toEqual(p3);
    expect(resizePattern(p3, 3, 1)).toEqual([5]);
  });
});

describe("auto-layers in a project", () => {
  function setup() {
    const project = createProjectFromPreset("blank");
    const ground = project.addIntGridLayer("ground", [
      { value: 1, identifier: "dirt", color: "#884422" },
    ]);
    const tileset = project.addTileset({
      identifier: "sheet",
      tileSize: 8,
      spacing: 0,
      padding: 0,
      image: { dataUrl: PNG, width: 32, height: 8 },
    });
    const tiles = project.addTilesLayer("ground_tiles", tileset.uid);
    const level = project.levels[0];
    const source = level.doc.getLayer(layerIdFor(ground.uid))!;
    const target = level.doc.getLayer(layerIdFor(tiles.uid))!;
    return { project, ground, tiles, level, source, target };
  }

  it("generates from the source, regenerates on edits, and locks the layer", async () => {
    const { project, ground, tiles, source, target } = setup();
    target.set(0, 0, 99);
    project.setAutoSource(tiles.uid, ground.uid);
    expect(target.locked).toBe(true);
    expect(target.get(0, 0)).toBe(0); // painted tiles replaced

    const r = project.addAutoRule(tiles.uid)!;
    expect(r.pattern[4]).toBe(1); // "cells holding dirt" by default
    project.updateAutoRule(tiles.uid, r.uid, { tileIds: [2] });

    source.set(3, 2, 1);
    project.levels[0].doc.notifyCellsChanged(source.id);
    await Promise.resolve(); // regeneration is coalesced in a microtask
    expect(decodeTile(target.get(3, 2))?.tileId).toBe(2);

    project.setAutoSource(tiles.uid, null);
    expect(target.locked).toBe(false);
    expect(decodeTile(target.get(3, 2))?.tileId).toBe(2); // tiles are kept
  });

  it("orders, duplicates and resizes rules", () => {
    const { project, ground, tiles } = setup();
    project.setAutoSource(tiles.uid, ground.uid);
    const a = project.addAutoRule(tiles.uid)!;
    const b = project.addAutoRule(tiles.uid)!;
    project.moveAutoRule(tiles.uid, b.uid, "up");
    const copy = project.duplicateAutoRule(tiles.uid, b.uid)!;
    expect(project.getLayerDef(tiles.uid)!.autoRules!.map((r) => r.uid)).toEqual([
      b.uid,
      copy.uid,
      a.uid,
    ]);
    project.updateAutoRule(tiles.uid, a.uid, { size: 5 });
    expect(project.getAutoRule(tiles.uid, a.uid)!.pattern).toHaveLength(25);
    expect(project.getAutoRule(tiles.uid, a.uid)!.pattern[12]).toBe(1);
  });

  it("becomes a manual layer when its source layer is deleted", () => {
    const { project, ground, tiles, target } = setup();
    project.setAutoSource(tiles.uid, ground.uid);
    project.removeLayerDef(ground.uid);
    expect(project.isAutoLayer(project.getLayerDef(tiles.uid))).toBe(false);
    expect(target.locked).toBe(false);
  });

  it("round-trips rules through the project file and exports the source", () => {
    const { project, ground, tiles, source } = setup();
    project.setAutoSource(tiles.uid, ground.uid);
    const r = project.addAutoRule(tiles.uid)!;
    project.updateAutoRule(tiles.uid, r.uid, { tileIds: [1, 3], flipX: true, chance: 0.75 });
    source.set(1, 1, 1);
    project.regenerateAutoLayers();

    const loaded = deserializeProject(JSON.parse(JSON.stringify(serializeProject(project))));
    const def = loaded.getLayerDef(tiles.uid)!;
    expect(def.autoRules).toEqual(project.getLayerDef(tiles.uid)!.autoRules);
    expect(loaded.isAutoLayer(def)).toBe(true);
    expect(loaded.levels[0].doc.getLayer(layerIdFor(tiles.uid))!.locked).toBe(true);
    expect(Array.from(loaded.levels[0].doc.getLayer(layerIdFor(tiles.uid))!.data)).toEqual(
      Array.from(project.levels[0].doc.getLayer(layerIdFor(tiles.uid))!.data)
    );
    expect(toGameFormat(loaded, loaded.levels[0]).tileLayers?.ground_tiles.autoSource).toBe(
      "ground"
    );
  });
});

describe("platformer preset", () => {
  it("generates grass, corners, walls, fill and planks from the terrain layer", () => {
    const project = createProjectFromPreset("platformer");
    const level = project.levels[0];
    const tiles = level.doc.getLayer(layerIdFor(2))!;
    expect(tiles.locked).toBe(true);
    const at = (x: number, y: number) => {
      const t = decodeTile(tiles.get(x, y));
      return t ? `${t.tileId}${t.flipX ? "<" : ""}` : ".";
    };
    expect(at(0, 18)).toBe("0"); // surface (the level edge continues the ground)
    expect(at(23, 18)).toBe("3<"); // top-right corner before the pit (mirrored)
    expect(at(27, 18)).toBe("3"); // top-left corner after the pit
    expect(at(23, 19)).toBe("4<"); // pit wall
    expect(["1", "2"]).toContain(at(5, 20)); // fill with variants
    expect(at(33, 11)).toBe("5"); // island underside
    expect(at(20, 13)).toBe("6"); // plank
    expect(at(20, 5)).toBe("."); // sky
  });
});

describe("layer locks", () => {
  it("keeps hand locks through auto-layer changes and saves them", () => {
    const project = createProjectFromPreset("platformer");
    const level = project.levels[0];
    const entities = level.doc.getLayer(layerIdFor(20))!;
    entities.locked = true;
    project.setAutoSource(2, null);
    expect(entities.locked).toBe(true);
    expect(level.doc.getLayer(layerIdFor(2))!.locked).toBe(false);
    project.setAutoSource(2, 1);
    const loaded = deserializeProject(JSON.parse(JSON.stringify(serializeProject(project))));
    expect(loaded.levels[0].doc.getLayer(layerIdFor(20))!.locked).toBe(true);
    expect(loaded.levels[0].doc.getLayer(layerIdFor(2))!.locked).toBe(true);
    expect(loaded.levels[0].doc.getLayer(layerIdFor(1))!.locked).toBe(false);
  });
});

describe("incremental auto-layer regeneration", () => {
  it("matches a full regeneration after random edits", async () => {
    const { generateAutoTiles: full } = await import("../src/model/autoRules");
    const { DrawCommand, HistoryManager } = await import("@gs2d/core");
    const project = createProjectFromPreset("platformer");
    const level = project.levels[0];
    const source = level.doc.getLayer(layerIdFor(1))!;
    const tiles = level.doc.getLayer(layerIdFor(2))!;
    const def = project.getLayerDef(2)!;
    const history = new HistoryManager();
    let seed = 7;
    const rand = (n: number) => {
      seed = (seed * 1103515245 + 12345) >>> 0;
      return seed % n;
    };
    for (let i = 0; i < 40; i++) {
      // A small "stroke": a few cells near each other, as one undoable edit.
      const cx = rand(level.width);
      const cy = rand(level.height);
      const changes = Array.from({ length: 1 + rand(4) }, (_, k) => {
        const x = Math.min(level.width - 1, cx + k);
        const y = cy;
        return { x, y, oldValue: source.get(x, y), newValue: rand(3) };
      }).filter((c, k, all) => all.findIndex((d) => d.x === c.x) === k);
      history.execute(new DrawCommand(level.doc, source.id, changes));
      if (i % 5 === 4) history.undo(); // undo goes through the same path
      project.flushAutoLayers();
      const expected = full(source.data, level.width, level.height, def.autoRules!, def.autoSeed);
      expect(Array.from(tiles.data)).toEqual(Array.from(expected));
    }
  });

  it("updates a big level quickly after a single-cell edit", async () => {
    const { DrawCommand } = await import("@gs2d/core");
    const project = createProjectFromPreset("platformer");
    const old = project.levels[0];
    const level = project.createLevel("big", 256, 256);
    project.removeLevel(old.uid);
    const source = level.doc.getLayer(layerIdFor(1))!;
    source.data.fill(1);
    project.regenerateAutoLayers();
    const started = performance.now();
    for (let i = 0; i < 100; i++) {
      new DrawCommand(level.doc, source.id, [
        { x: i, y: 100, oldValue: source.get(i, 100), newValue: 0 },
      ]).execute();
      project.flushAutoLayers();
    }
    const perEdit = (performance.now() - started) / 100;
    // A full 256×256 pass takes far longer; a local update is well under a millisecond or two.
    expect(perEdit).toBeLessThan(5);
  });
});

describe("auto-rule gaps (item 30)", () => {
  const ground = [0, 0, 0, 0, 1, 0, 0, 0, 0];
  const topEdge = [0, -ANY_VALUE, 0, 0, 1, 0, 0, 0, 0];

  it("stacks tiles from rules that don't stop, first rule on top", () => {
    const g = grid("#");
    const stack: AutoStack = new Map();
    const rules = [
      rule(1, { pattern: ground, tileIds: [5], breakOnMatch: false }),
      rule(2, { pattern: ground, tileIds: [6] }),
      rule(3, { pattern: ground, tileIds: [7] }), // never reached: rule 2 stops
    ];
    const cells = generateAutoTiles(g.data, 1, 1, rules, 0, stack);
    expect(show(cells, 1)).toEqual(["5"]);
    expect(stack.get(0)!.map((p) => decodeTile(p.tile)?.tileId)).toEqual([5, 6]);
  });

  it("records offsets, and plain cells stay out of the stack", () => {
    const g = grid("##");
    const stack: AutoStack = new Map();
    const rules = [rule(1, { pattern: ground, tileIds: [1], offsetX: 0, offsetY: -4 })];
    generateAutoTiles(g.data, 2, 1, rules, 0, stack);
    expect([...stack.keys()]).toEqual([0, 1]);
    expect(stack.get(0)![0]).toMatchObject({ dx: 0, dy: -4 });
    const plain: AutoStack = new Map();
    generateAutoTiles(g.data, 2, 1, [rule(1, { pattern: ground, tileIds: [1] })], 0, plain);
    expect(plain.size).toBe(0);
  });

  it("handles cells past the edge per rule", () => {
    const g = grid("#");
    const at = (outOfBounds: AutoRule["outOfBounds"]) =>
      show(
        generateAutoTiles(g.data, 1, 1, [rule(1, { pattern: topEdge, tileIds: [3], outOfBounds })]),
        1
      )[0];
    expect(at("edge")).toBe("."); // above reads as the cell itself: ground
    expect(at(0)).toBe("3"); // above reads as empty
    expect(at("fail")).toBe("."); // the rule can't look past the edge
  });

  it("switches rule groups together and evaluates groups in order", () => {
    const project = createProjectFromPreset("platformer");
    const def = project.defs.layers.find((d) => project.isAutoLayer(d))!;
    const level = project.levels[0];
    const layer = () => level.doc.getLayer(layerIdFor(def.uid))!;
    const before = Array.from(layer().data);
    const group = project.addAutoGroup(def.uid, "Decor")!;
    const decor = project.addAutoRule(def.uid)!;
    project.updateAutoRule(def.uid, decor.uid, {
      groupUid: group.uid,
      pattern: [0, 0, 0, 0, ANY_VALUE, 0, 0, 0, 0],
      tileIds: [0],
    });
    // Grouped rules come after the ungrouped ones, so the old rules still win.
    expect(project.orderedAutoRules(def).at(-1)?.uid).toBe(decor.uid);
    expect(Array.from(layer().data)).toEqual(before);

    project.updateAutoGroup(def.uid, group.uid, { active: false });
    expect(project.orderedAutoRules(def).at(-1)?.active).toBe(false);
    project.removeAutoGroup(def.uid, group.uid);
    expect(project.getAutoRule(def.uid, decor.uid)?.groupUid).toBeNull();
  });

  it("keeps stacks per level, saves the options and exports stacked cells", () => {
    const project = createProjectFromPreset("platformer");
    const def = project.defs.layers.find((d) => project.isAutoLayer(d))!;
    const first = def.autoRules![0];
    const last = def.autoRules!.at(-1)!;
    const group = project.addAutoGroup(def.uid, "Base")!;
    project.updateAutoRule(def.uid, first.uid, {
      breakOnMatch: false,
      offsetY: 2,
      outOfBounds: "fail",
    });
    project.updateAutoRule(def.uid, last.uid, { groupUid: group.uid });
    const level = project.levels[0];
    const stack = level.autoStacks.get(layerIdFor(def.uid))!;
    expect(stack.size).toBeGreaterThan(0);

    const copy = deserializeProject(serializeProject(project));
    const loaded = copy.getLayerDef(def.uid)!;
    expect(loaded.autoGroups).toEqual([{ uid: group.uid, name: "Base", active: true }]);
    expect(loaded.autoRules![0]).toMatchObject({
      breakOnMatch: false,
      offsetY: 2,
      outOfBounds: "fail",
    });
    expect(loaded.autoRules!.at(-1)?.groupUid).toBe(group.uid);
    expect(copy.levels[0].autoStacks.get(layerIdFor(def.uid))!.size).toBe(stack.size);

    const file = toGameFormat(project, level);
    expect(file.tileStacks?.[def.identifier]).toHaveLength(stack.size);
  });
});
