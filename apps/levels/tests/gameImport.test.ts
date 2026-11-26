import { describe, it, expect } from "vite-plus/test";
import { createProjectFromPreset } from "../src/model/presets";
import { layerIdFor } from "../src/model/LevelProject";
import { toGameFormat } from "../src/io/gameFormat";
import { fromGameFormat, importGameLevel, inferFieldType } from "../src/io/gameImport";

const cells = (project: ReturnType<typeof createProjectFromPreset>, levelIndex: number) =>
  Object.fromEntries(
    project.defs.layers
      .filter((d) => d.type !== "Entities")
      .map((d) => [
        d.identifier,
        Array.from(project.levels[levelIndex].doc.getLayer(layerIdFor(d.uid))!.data),
      ])
  );

describe("game JSON import", () => {
  it("imports an export into the same project as a new level", () => {
    const project = createProjectFromPreset("platformer");
    const source = project.levels[0];
    const file = toGameFormat(project, source);
    const { level, warnings } = importGameLevel(project, file, "copy");
    expect(warnings).toEqual([]);
    expect(project.levels).toContain(level);
    // Grid layers and auto-layers (regenerated from their sources) match.
    expect(cells(project, project.levels.indexOf(level))).toEqual(cells(project, 0));
  });

  it("brings entities back with their fields, references inside the file remapped", () => {
    const project = createProjectFromPreset("pacman");
    const source = project.levels[0];
    const ghost = project.defs.entities.find((d) => d.identifier === "Ghost")!;
    const chases = project.addField(ghost.uid, "EntityRef", "chases")!;
    const blinky = source.entities.find((e) => e.iid === "ghost-blinky")!;
    blinky.fields[chases.uid] = { entityIid: "pacman-spawn", levelUid: source.uid };

    const { level, warnings } = importGameLevel(project, toGameFormat(project, source));
    expect(warnings).toEqual([]);
    expect(level.entities).toHaveLength(source.entities.length);
    const copy = level.entities.find((e) => e.defUid === ghost.uid && e.x === blinky.x)!;
    expect(copy.iid).not.toBe(blinky.iid); // iids stay unique in the project
    expect(copy.fields[String(chases.uid)]).toMatchObject({ levelUid: level.uid });
    const target = project.findEntity(copy.fields[String(chases.uid)] as never)!;
    expect(target.level).toBe(level);
    expect(project.getEntityDef(target.instance.defUid)?.identifier).toBe("PacMan");
  });

  it("reports what it cannot match", () => {
    const project = createProjectFromPreset("blank");
    const file = toGameFormat(
      createProjectFromPreset("pacman"),
      createProjectFromPreset("pacman").levels[0]
    );
    const { level, warnings } = importGameLevel(project, file, "pac");
    expect(level.entities).toHaveLength(0);
    expect(warnings.join(" ")).toMatch(/No layer named "collision"/);
    expect(warnings.join(" ")).toMatch(/could not be placed|No entity type/);
  });

  it("opens an export on its own with entity types and fields inferred", () => {
    const pacman = createProjectFromPreset("pacman");
    const music = pacman.addLevelField("String", "music")!;
    pacman.levels[0].fields[music.uid] = "theme.ogg";
    const project = fromGameFormat(toGameFormat(pacman, pacman.levels[0]));
    expect(project.defs.entities.map((d) => d.identifier).sort()).toEqual([
      "Fruit",
      "Ghost",
      "PacMan",
    ]);
    const ghost = project.defs.entities.find((d) => d.identifier === "Ghost")!;
    const original = pacman.defs.entities.find((d) => d.identifier === "Ghost")!;
    expect(ghost.color).toBe(original.color);
    expect(ghost.fields.find((f) => f.identifier === "scatterTarget")?.type).toBe("Point");
    expect(project.levels[0].entities).toHaveLength(pacman.levels[0].entities.length);
    expect(project.defs.levelFields.map((f) => f.identifier)).toEqual(["music"]);
    expect(Object.values(project.levels[0].fields)).toEqual(["theme.ogg"]);
  });

  it("infers field types from exported values", () => {
    expect(inferFieldType([1, 2])).toEqual({ type: "Int", isArray: false });
    expect(inferFieldType([1, 2.5])).toEqual({ type: "Float", isArray: false });
    expect(inferFieldType(["#ff0000", null])).toEqual({ type: "Color", isArray: false });
    expect(inferFieldType([[{ x: 1, y: 2 }], []])).toEqual({ type: "Point", isArray: true });
    expect(inferFieldType([{ iid: "a", level: "l" }])).toEqual({
      type: "EntityRef",
      isArray: false,
    });
    expect(inferFieldType([null])).toBeNull();
  });
});
