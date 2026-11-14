import { describe, it, expect } from "vite-plus/test";
import type { LevelProject } from "../src/model/LevelProject";
import { layerIdFor } from "../src/model/LevelProject";
import { createProjectFromPreset, presets } from "../src/model/presets";

const createPacmanProject = () => createProjectFromPreset("pacman");
import { deserializeProject, ProjectFormatError, serializeProject } from "../src/io/projectFile";
import { formatLayerAsArray, fromGameFormat, toGameFormat } from "../src/io/gameFormat";

const names = (project: LevelProject) => project.levels[0].doc.layers.map((l) => l.name);

describe("presets", () => {
  it("discovers every preset file and builds independent projects", () => {
    expect(presets.map((p) => p.id)).toEqual(["pacman", "blank"]);
    expect(presets[0].label).toBe("Pac-Man (arcade)");
    const a = createPacmanProject();
    const b = createPacmanProject();
    a.levels[0].doc.layers[0].set(0, 0, 1);
    expect(b.levels[0].doc.layers[0].get(0, 0)).toBe(0);
    expect(createProjectFromPreset("blank").defs.layers.map((d) => d.identifier)).toEqual([
      "intgrid",
    ]);
  });
});

describe("LevelProject definitions", () => {
  it("seeds the Pac-Man project with three IntGrid layers and an entities layer on a 28x36 level", () => {
    const project = createPacmanProject();
    expect(project.gridSize).toBe(8);
    expect(project.defs.layers.map((d) => d.identifier)).toEqual([
      "collision",
      "collectibles",
      "spawns",
      "entities",
    ]);
    expect(names(project)).toEqual(["collision", "collectibles", "spawns", "entities"]);
    const level = project.levels[0];
    expect([level.width, level.height]).toEqual([28, 36]);
  });

  it("keeps every level in sync when defs are added, moved, renamed and removed", () => {
    const project = createPacmanProject();
    project.createLevel("level_1", 4, 4);
    const def = project.addIntGridLayer("collision"); // duplicate name gets a suffix
    expect(def.identifier).toBe("collision_2");
    for (const level of project.levels) {
      expect(level.doc.layers.map((l) => l.name)).toEqual([
        "collision",
        "collectibles",
        "spawns",
        "entities",
        "collision_2",
      ]);
    }
    project.moveLayerDef(def.uid, "down");
    project.renameLayerDef(def.uid, "hazards");
    for (const level of project.levels) {
      expect(level.doc.layers.map((l) => l.name)).toEqual([
        "collision",
        "collectibles",
        "spawns",
        "hazards",
        "entities",
      ]);
    }
    project.removeLayerDef(def.uid);
    expect(project.levels[1].doc.layers).toHaveLength(4);
  });

  it("clears cells when a value is removed and colors per layer", () => {
    const project = createPacmanProject();
    const level = project.levels[0];
    const [collision, collectibles] = project.defs.layers;
    level.doc.getLayer(layerIdFor(collision.uid))!.set(0, 0, 1);
    level.doc.getLayer(layerIdFor(collectibles.uid))!.set(0, 0, 1);

    // Same value, different color per layer.
    const wall = project.colorizerFor(layerIdFor(collision.uid))!(1);
    const pellet = project.colorizerFor(layerIdFor(collectibles.uid))!(1);
    expect(wall).not.toBe(pellet);
    expect(project.colorizerFor(layerIdFor(collision.uid))!(0)).toBe(0);

    const before = project.paletteVersion;
    project.removeIntGridValue(collision.uid, 1);
    expect(level.doc.getLayer(layerIdFor(collision.uid))!.get(0, 0)).toBe(0);
    expect(level.doc.getLayer(layerIdFor(collectibles.uid))!.get(0, 0)).toBe(1);
    expect(project.paletteVersion).toBeGreaterThan(before);
  });
});

describe("project file", () => {
  it("round-trips through JSON", () => {
    const project = createPacmanProject();
    const level = project.levels[0];
    const spawns = project.defs.layers[2];
    level.doc.getLayer(layerIdFor(spawns.uid))!.set(13, 26, 1);
    level.doc.setLayerProperty(layerIdFor(spawns.uid), "opacity", 0.5);
    level.doc.setActiveLayer(layerIdFor(spawns.uid));

    const copy = deserializeProject(JSON.parse(JSON.stringify(serializeProject(project))));
    const copied = copy.levels[0];
    expect(copy.defs.layers).toEqual(project.defs.layers);
    expect(copied.uid).toBe(level.uid);
    expect(copied.doc.getLayer(layerIdFor(spawns.uid))!.get(13, 26)).toBe(1);
    expect(copied.doc.getLayer(layerIdFor(spawns.uid))!.opacity).toBe(0.5);
    expect(copied.doc.activeLayerId).toBe(layerIdFor(spawns.uid));
    // New uids must not collide with loaded ones.
    expect(copy.allocateUid()).toBeGreaterThan(
      Math.max(...copy.defs.layers.map((d) => d.uid), copied.uid)
    );
  });

  it("rejects malformed files with a readable error", () => {
    expect(() => deserializeProject({ format: "other" })).toThrow(ProjectFormatError);
    const file = serializeProject(createPacmanProject());
    file.levels[0].layers[0].data = [5, 1];
    expect(() => deserializeProject(file)).toThrow(/corrupt/);
  });
});

describe("game format", () => {
  it("exports flat arrays keyed by identifier, matching the old editor", () => {
    const project = createPacmanProject();
    project.levels[0].doc.getLayer(layerIdFor(project.defs.layers[0].uid))!.set(1, 0, 1);
    const game = toGameFormat(project, project.levels[0]);
    expect(game.metadata).toEqual({ name: "pacman", columns: 28, rows: 36, tileSize: 8 });
    expect(Object.keys(game.layers)).toEqual(["collision", "collectibles", "spawns"]);
    expect(game.layers.collision).toHaveLength(28 * 36);
    expect(game.layers.collision[1]).toBe(1);
  });

  it("imports game files, reusing seed defs and generating unknown ones", () => {
    const file = {
      metadata: { name: "maze", columns: 2, rows: 2, tileSize: 16 },
      layers: { collision: [1, 0, 0, 4], decor: [0, 7, 7, 3] },
    };
    const project = fromGameFormat(file);
    expect(project.gridSize).toBe(16);
    const [collision, decor] = project.defs.layers;
    expect(collision.intGridValues.map((v) => v.identifier)).toContain("ghost_house_door");
    expect(decor.intGridValues.map((v) => v.value)).toEqual([3, 7]);
    expect(toGameFormat(project, project.levels[0]).layers).toEqual(file.layers);
  });

  it("rejects layers with the wrong cell count", () => {
    expect(() =>
      fromGameFormat({
        metadata: { name: "x", columns: 2, rows: 2, tileSize: 8 },
        layers: { a: [1] },
      })
    ).toThrow(/4 cells/);
  });

  it("formats a layer as a row-per-line array", () => {
    expect(formatLayerAsArray([1, 2, 3, 4], 2, 2)).toBe("[\n  1, 2,\n  3, 4\n]");
  });
});
