import { describe, it, expect } from "vite-plus/test";
import { HistoryManager } from "@foundry2d/core";
import type { ScenePointerEvent } from "@foundry2d/workspace";
import { layerIdFor, type LevelProject } from "../src/model/LevelProject";
import { createProjectFromPreset } from "../src/model/presets";
import { deserializeProject, serializeProject } from "../src/io/projectFile";
import { toGameFormat } from "../src/io/gameFormat";
import { entityRect, fieldValue, snapToCell, validateFieldValue } from "../src/model/entities";
import {
  AddEntityCommand,
  RemoveEntityCommand,
  ShiftEntitiesCommand,
  UpdateEntityCommand,
} from "../src/model/entityCommands";
import { EntityController } from "../src/entities/EntityController";
import type { EntityInstance, FieldDef } from "../src/model/types";

/** A blank project with an Entities layer, a "Door" entity with a few fields, and an enum. */
function setup() {
  const project = createProjectFromPreset("blank");
  project.setGridSize(8);
  const layer = project.addEntitiesLayer("entities");
  const colors = project.addEnum("lock");
  project.addEnumValue(colors.uid, "red");
  project.addEnumValue(colors.uid, "blue");
  const door = project.addEntityDef("Door");
  const lock = project.addField(door.uid, "Enum", "lock")!;
  const hp = project.addField(door.uid, "Int", "hp")!;
  project.updateField(door.uid, hp.uid, { min: 0, max: 10, defaultValue: 3 });
  const target = project.addField(door.uid, "Point", "target")!;
  const level = project.levels[0];
  const instance = (x: number, y: number, fields = {}): EntityInstance => ({
    iid: `door-${x}-${y}`,
    defUid: door.uid,
    layerUid: layer.uid,
    x,
    y,
    fields,
  });
  return { project, layer, colors, door, lock, hp, target, level, instance };
}

describe("entity model", () => {
  it("adds an Entities layer to every level and removes its instances with it", () => {
    const { project, layer, level, instance } = setup();
    expect(level.doc.getLayer(layerIdFor(layer.uid))).toBeDefined();
    project.insertEntity(level, instance(8, 8));
    project.removeLayerDef(layer.uid);
    expect(level.entities).toHaveLength(0);
  });

  it("validates and defaults field values", () => {
    const { project, door, lock, hp, target, instance } = setup();
    const enums = project.defs.enums;
    expect(validateFieldValue(hp, 42, enums)).toBe(10);
    expect(validateFieldValue(hp, 2.6, enums)).toBe(3);
    expect(validateFieldValue(hp, "x", enums)).toBeUndefined();
    expect(validateFieldValue(lock, "green", enums)).toBeUndefined();
    expect(validateFieldValue(target, { x: 1, y: 2 }, enums)).toEqual({ x: 1, y: 2 });
    const e = instance(0, 0, { [hp.uid]: "bad" });
    expect(fieldValue(e, hp, enums)).toBe(3);
    expect(fieldValue(e, lock, enums)).toBe("red");
    expect(door.fields.map((f: FieldDef) => f.identifier)).toEqual(["lock", "hp", "target"]);
  });

  it("carries enum renames into stored values and prunes removed values", () => {
    const { project, colors, lock, level, instance } = setup();
    project.insertEntity(level, instance(0, 0, { [lock.uid]: "blue" }));
    project.updateEnumValue(colors.uid, "blue", { id: "cyan" });
    expect(level.entities[0].fields[lock.uid]).toBe("cyan");
    project.removeEnumValue(colors.uid, "cyan");
    expect(level.entities[0].fields[lock.uid]).toBeUndefined();
  });

  it("places by pivot and snaps to cells", () => {
    const { project, door } = setup();
    project.updateEntityDef(door.uid, { width: 16, height: 8, pivotX: 0.5, pivotY: 1 });
    expect(snapToCell(door, 2, 3, 8)).toEqual({ x: 20, y: 32 });
    expect(entityRect(door, { x: 20, y: 32 })).toEqual({ x: 12, y: 24, width: 16, height: 8 });
  });

  it("gives duplicated levels new instance ids", () => {
    const { project, level, instance } = setup();
    project.insertEntity(level, instance(8, 8));
    const copy = project.cloneLevel(level.uid, 500, 0)!;
    expect(copy.entities).toHaveLength(1);
    expect(copy.entities[0].iid).not.toBe(level.entities[0].iid);
  });
});

describe("entity commands", () => {
  it("add, update, delete and shift undo and redo", () => {
    const { project, level, instance, target } = setup();
    const history = new HistoryManager();
    history.execute(new AddEntityCommand(project, level, instance(8, 8)));
    const before = level.entities[0];
    history.execute(
      new UpdateEntityCommand(project, level, before, { ...before, x: 24, fields: {} })
    );
    expect(level.entities[0].x).toBe(24);
    history.undo();
    expect(level.entities[0].x).toBe(8);

    level.entities[0].fields[target.uid] = { x: 1, y: 1 };
    history.execute(new ShiftEntitiesCommand(project, level, 2, 1));
    expect(level.entities[0]).toMatchObject({
      x: 8 + 2 * project.gridSize,
      y: 8 + project.gridSize,
    });
    expect(level.entities[0].fields[target.uid]).toEqual({ x: 3, y: 2 });
    history.undo();

    history.execute(new RemoveEntityCommand(project, level, before.iid));
    expect(level.entities).toHaveLength(0);
    history.undo();
    expect(level.entities.map((e) => e.iid)).toEqual([before.iid]);
    history.undo();
    expect(level.entities).toHaveLength(0);
    history.redo();
    expect(level.entities).toHaveLength(1);
  });
});

describe("entity files", () => {
  it("round-trips definitions, enums and instances", () => {
    const { project, level, instance, lock, target } = setup();
    project.insertEntity(
      level,
      instance(8, 16, { [lock.uid]: "blue", [target.uid]: { x: 4, y: 5 } })
    );
    const loaded = deserializeProject(JSON.parse(JSON.stringify(serializeProject(project))));
    expect(loaded.defs.entities).toEqual(project.defs.entities);
    expect(loaded.defs.enums).toEqual(project.defs.enums);
    expect(loaded.levels[0].entities).toEqual(level.entities);
    // New uids don't collide with loaded ones.
    expect(loaded.allocateUid()).toBeGreaterThan(
      Math.max(...project.defs.entities.map((d) => d.uid))
    );
  });

  it("drops instances whose definition is missing and invalid field values", () => {
    const { project, level, instance, hp } = setup();
    project.insertEntity(level, instance(8, 8, { [hp.uid]: "lots" }));
    const file = serializeProject(project);
    file.levels[0].entities!.push({ ...file.levels[0].entities![0], iid: "x", defUid: 999 });
    const loaded = deserializeProject(JSON.parse(JSON.stringify(file)));
    expect(loaded.levels[0].entities).toHaveLength(1);
    expect(loaded.levels[0].entities[0].fields).toEqual({});
  });

  it("exports entities by layer with named fields and no grid for entity layers", () => {
    const { project, level, instance, lock } = setup();
    project.insertEntity(level, instance(12, 4, { [lock.uid]: "blue" }));
    const game = toGameFormat(project, level);
    expect(game.layers.entities).toBeUndefined();
    expect(game.entities?.entities).toEqual([
      {
        id: "Door",
        iid: "door-12-4",
        x: 12,
        y: 4,
        cx: 12 >> 3,
        cy: 0,
        left: 12 - project.gridSize / 2,
        top: 4 - project.gridSize / 2,
        width: project.gridSize,
        height: project.gridSize,
        fields: { lock: "blue", hp: 3, target: null },
      },
    ]);
  });

  it("loads the Pac-Man preset with its spawn entities", () => {
    const project = createProjectFromPreset("pacman");
    const level = project.levels[0];
    const game = toGameFormat(project, level);
    expect(game.entities?.entities.map((e) => e.id)).toEqual([
      "PacMan",
      "Ghost",
      "Ghost",
      "Ghost",
      "Ghost",
      "Fruit",
    ]);
    expect(game.entities?.entities[1].fields).toEqual({
      kind: "blinky",
      scatterTarget: { x: 25, y: 0 },
    });
    // The IntGrid layers the game already reads are unchanged.
    expect(Object.keys(game.layers)).toEqual(["collision", "collectibles"]);
  });
});

describe("EntityController", () => {
  function controller(project: LevelProject) {
    const history = new HistoryManager();
    const level = project.levels[0];
    const messages: string[] = [];
    const ctl = new EntityController({
      getProject: () => project,
      getLevel: () => level,
      history,
      getZoom: () => 4,
      isPicking: () => false,
      requestRender: () => {},
      refreshCursor: () => {},
      notify: (m) => messages.push(m),
    });
    const pointer = (x: number, y: number, extra: Partial<ScenePointerEvent> = {}) =>
      ({ world: { x, y }, button: 0, shiftKey: false, ...extra }) as ScenePointerEvent;
    const click = (x: number, y: number, extra: Partial<ScenePointerEvent> = {}) => {
      ctl.onPointerDown(pointer(x, y, extra));
      ctl.onPointerUp(pointer(x, y, extra));
    };
    return { ctl, history, level, messages, pointer, click };
  }

  it("places on click, moves by drag in whole cells, and undoes each as one step", () => {
    const { project, layer } = setup();
    project.levels[0].doc.setActiveLayer(layerIdFor(layer.uid));
    const { ctl, history, level, pointer, click } = controller(project);
    expect(ctl.isActive).toBe(true);

    click(9, 9);
    expect(level.entities).toHaveLength(1);
    expect(level.entities[0]).toMatchObject({ x: 12, y: 12 });
    expect(ctl.selected?.iid).toBe(level.entities[0].iid);

    ctl.onPointerDown(pointer(12, 12));
    ctl.onPointerMove(pointer(30, 13));
    ctl.onPointerUp(pointer(30, 13));
    expect(level.entities[0]).toMatchObject({ x: 28, y: 12 });

    history.undo();
    expect(level.entities[0]).toMatchObject({ x: 12, y: 12 });
    history.undo();
    expect(level.entities).toHaveLength(0);
  });

  it("moves the last instance when the per-level limit is reached", () => {
    const { project, layer, door } = setup();
    project.updateEntityDef(door.uid, { maxPerLevel: 1 });
    project.levels[0].doc.setActiveLayer(layerIdFor(layer.uid));
    const { level, click } = controller(project);
    click(4, 4);
    click(40, 4);
    expect(level.entities).toHaveLength(1);
    expect(level.entities[0].x).toBe(44);
  });

  it("deletes with right-click, duplicates, nudges and picks points", () => {
    const { project, layer, target } = setup();
    project.levels[0].doc.setActiveLayer(layerIdFor(layer.uid));
    const { ctl, level, click } = controller(project);
    click(4, 4);
    ctl.duplicateSelected();
    expect(level.entities.map((e) => e.x)).toEqual([4, 12]);
    ctl.nudge(1, 0, true);
    expect(ctl.selected?.x).toBe(13);
    ctl.startPick(ctl.selected!.iid, target.uid);
    click(17, 25);
    expect(ctl.selected?.fields[target.uid]).toEqual({ x: 2, y: 3 });
    click(4, 4, { button: 2 });
    expect(level.entities).toHaveLength(1);
  });
});

describe("locked entity layers", () => {
  it("allow selecting but block placing, moving and deleting", () => {
    const { project, layer, instance } = setup();
    const level = project.levels[0];
    project.insertEntity(level, instance(4, 4));
    level.doc.setActiveLayer(layerIdFor(layer.uid));
    level.doc.getLayer(layerIdFor(layer.uid))!.locked = true;
    const messages: string[] = [];
    const ctl = new EntityController({
      getProject: () => project,
      getLevel: () => level,
      history: new HistoryManager(),
      getZoom: () => 4,
      isPicking: () => false,
      requestRender: () => {},
      refreshCursor: () => {},
      notify: (m) => messages.push(m),
    });
    const ev = (x: number, y: number) =>
      ({ world: { x, y }, button: 0, shiftKey: false }) as ScenePointerEvent;
    ctl.onPointerDown(ev(40, 40));
    ctl.onPointerUp(ev(40, 40));
    expect(level.entities).toHaveLength(1);
    ctl.onPointerDown(ev(4, 4));
    ctl.onPointerMove(ev(30, 4));
    ctl.onPointerUp(ev(30, 4));
    expect(ctl.selected?.x).toBe(4);
    expect(ctl.deleteSelected()).toBe(true);
    expect(level.entities).toHaveLength(1);
    expect(messages.at(-1)).toMatch(/locked/);
    expect(ctl.getCursor()).toBe("not-allowed");
  });
});

describe("legacy game exports", () => {
  it("keep the old spawns value names", async () => {
    const { fromGameFormat } = await import("../src/io/gameFormat");
    const cells = Array.from({ length: 4 }, (_, i) => (i === 1 ? 3 : 0));
    const project = fromGameFormat({
      metadata: { name: "old", columns: 2, rows: 2, tileSize: 8 },
      layers: { spawns: cells },
    });
    const def = project.defs.layers[0];
    expect(def.identifier).toBe("spawns");
    expect(def.intGridValues.map((v) => v.identifier)).toEqual([
      "pacman",
      "blinky",
      "inky",
      "pinky",
      "clyde",
    ]);
  });
});

describe("CSV export", () => {
  it("writes one CSV per layer: grids row by row, entities with field columns", async () => {
    const { toCsvFiles } = await import("../src/io/gameFormat");
    const project = createProjectFromPreset("pacman");
    const level = project.levels[0];
    level.doc.getLayer(layerIdFor(1))!.set(1, 0, 1);
    const files = toCsvFiles(project, level);
    expect(files.map((f) => f.name)).toEqual(["collision.csv", "collectibles.csv", "entities.csv"]);

    const collision = files[0].text.trim().split("\n");
    expect(collision).toHaveLength(36);
    expect(collision[0].split(",")).toHaveLength(28);
    expect(collision[0].startsWith("0,1,0")).toBe(true);

    const [header, ...rows] = files[2].text.trim().split("\n");
    expect(header).toBe("id,iid,x,y,cx,cy,left,top,width,height,kind,scatterTarget,points");
    expect(rows).toHaveLength(6);
    expect(rows[1]).toBe("Ghost,ghost-blinky,112,116,14,14,104,108,16,16,blinky,25;0,");
    expect(rows[0].endsWith(",,,")).toBe(true); // PacMan has none of the fields
    expect(rows[5].endsWith(",,,100")).toBe(true); // Fruit: points only
  });
});
