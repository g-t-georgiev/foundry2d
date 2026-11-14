import { describe, it, expect } from "vite-plus/test";
import { createProjectFromPreset } from "../src/model/presets";
import { fieldValue, validateFieldValue, withEntry } from "../src/model/entities";
import { deserializeProject, serializeProject } from "../src/io/projectFile";
import { toCsvFiles, toGameFormat } from "../src/io/gameFormat";
import type { EntityInstance } from "../src/model/types";

function setup() {
  const project = createProjectFromPreset("blank");
  const layer = project.addEntitiesLayer("things");
  const level = project.levels[0];
  const door = project.addEntityDef("Door");
  const lever = project.addEntityDef("Lever");
  const opens = project.addField(lever.uid, "EntityRef", "opens")!;
  const waypoints = project.addField(lever.uid, "Point", "waypoints")!;
  project.updateField(lever.uid, waypoints.uid, { isArray: true });
  const place = (defUid: number, iid: string, x: number): EntityInstance => {
    const instance: EntityInstance = { iid, defUid, layerUid: layer.uid, x, y: 8, fields: {} };
    project.insertEntity(level, instance);
    return instance;
  };
  const doorA = place(door.uid, "door-a", 8);
  const leverA = place(lever.uid, "lever-a", 40);
  return { project, level, door, lever, opens, waypoints, doorA, leverA };
}

describe("EntityRef and array fields", () => {
  it("validates references and lists entry by entry", () => {
    const { project, opens, waypoints } = setup();
    const enums = project.defs.enums;
    expect(validateFieldValue(opens, { entityIid: "x", levelUid: 1 }, enums)).toEqual({
      entityIid: "x",
      levelUid: 1,
    });
    expect(validateFieldValue(opens, { entityIid: "", levelUid: 1 }, enums)).toBeUndefined();
    expect(validateFieldValue(waypoints, { x: 1, y: 2 }, enums)).toBeUndefined();
    expect(
      validateFieldValue(waypoints, [{ x: 1, y: 2 }, "bad", null, { x: 3, y: 4 }], enums)
    ).toEqual([
      { x: 1, y: 2 },
      { x: 3, y: 4 },
    ]);
    expect(waypoints.defaultValue).toEqual([]);
  });

  it("sets, appends and removes list entries", () => {
    const { waypoints } = setup();
    let value = withEntry(waypoints, [], 0, { x: 1, y: 1 });
    value = withEntry(waypoints, value, 1, { x: 2, y: 2 });
    value = withEntry(waypoints, value, 0, { x: 5, y: 5 });
    expect(value).toEqual([
      { x: 5, y: 5 },
      { x: 2, y: 2 },
    ]);
    expect(withEntry(waypoints, value, 0, null)).toEqual([{ x: 2, y: 2 }]);
  });

  it("switching to a single value keeps the first entry, and back to a list wraps it", () => {
    const { project, lever, leverA, waypoints } = setup();
    leverA.fields[waypoints.uid] = [
      { x: 1, y: 1 },
      { x: 2, y: 2 },
    ];
    project.updateField(lever.uid, waypoints.uid, { isArray: false });
    expect(leverA.fields[waypoints.uid]).toEqual({ x: 1, y: 1 });
    expect(waypoints.defaultValue).toBeNull();
    project.updateField(lever.uid, waypoints.uid, { isArray: true });
    expect(leverA.fields[waypoints.uid]).toEqual([{ x: 1, y: 1 }]);
  });

  it("restricting the target type drops references to other types", () => {
    const { project, level, lever, door, leverA, doorA, opens } = setup();
    const leverB: EntityInstance = { ...leverA, iid: "lever-b", fields: {} };
    project.insertEntity(level, leverB);
    leverA.fields[opens.uid] = { entityIid: doorA.iid, levelUid: level.uid };
    leverB.fields[opens.uid] = { entityIid: leverA.iid, levelUid: level.uid };
    project.updateField(lever.uid, opens.uid, { refDefUid: door.uid });
    expect(leverA.fields[opens.uid]).toEqual({ entityIid: "door-a", levelUid: level.uid });
    expect(leverB.fields[opens.uid]).toBeUndefined();
    project.removeEntityDef(door.uid);
    expect(opens.refDefUid).toBeNull();
    // The door is gone; the reference stays (shown as missing, exported as null).
    expect(project.findEntity(leverA.fields[opens.uid] as never)).toBeNull();
  });

  it("a duplicated level points at its own copies", () => {
    const { project, level, leverA, doorA, opens } = setup();
    leverA.fields[opens.uid] = { entityIid: doorA.iid, levelUid: level.uid };
    const copy = project.cloneLevel(level.uid, 1000, 0)!;
    project.insertLevel(copy);
    const lever = copy.entities.find((e) => e.defUid === leverA.defUid)!;
    const ref = lever.fields[opens.uid] as { entityIid: string; levelUid: number };
    expect(ref.levelUid).toBe(copy.uid);
    expect(project.findEntity(ref)?.level).toBe(copy);
    expect(ref.entityIid).not.toBe(doorA.iid);
  });

  it("shifts listed points on edge resizes", () => {
    const { project, level, leverA, waypoints } = setup();
    leverA.fields[waypoints.uid] = [{ x: 1, y: 2 }];
    project.shiftEntities(level, 2, 1);
    expect(leverA.fields[waypoints.uid]).toEqual([{ x: 3, y: 3 }]);
  });

  it("round-trips and exports references as iid plus level", () => {
    const { project, level, leverA, doorA, opens, waypoints, lever } = setup();
    leverA.fields[opens.uid] = { entityIid: doorA.iid, levelUid: level.uid };
    leverA.fields[waypoints.uid] = [
      { x: 1, y: 2 },
      { x: 3, y: 4 },
    ];
    const copy = deserializeProject(serializeProject(project));
    const loaded = copy.levels[0].entities.find((e) => e.iid === "lever-a")!;
    const loadedDef = copy.getEntityDef(lever.uid)!;
    expect(loadedDef.fields.find((f) => f.uid === waypoints.uid)?.isArray).toBe(true);
    expect(fieldValue(loaded, loadedDef.fields[0], copy.defs.enums)).toEqual(
      leverA.fields[opens.uid]
    );

    const game = toGameFormat(project, level);
    const exported = game.entities!.things.find((e) => e.iid === "lever-a")!;
    expect(exported.fields.opens).toEqual({ iid: "door-a", level: level.identifier });
    expect(exported.fields.waypoints).toEqual([
      { x: 1, y: 2 },
      { x: 3, y: 4 },
    ]);
    const csv = toCsvFiles(project, level).find((f) => f.name === "things.csv")!;
    expect(csv.text).toContain("door-a,1;2|3;4");
  });
});
