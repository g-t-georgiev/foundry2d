import { describe, it, expect } from "vite-plus/test";
import { DrawCommand, HistoryManager } from "@foundry2d/core";
import { layerIdFor, type LevelProject } from "../src/model/LevelProject";
import { createProjectFromPreset } from "../src/model/presets";
import { DefinitionEditCommand } from "../src/model/commands";
import { UpdateEntityCommand } from "../src/model/entityCommands";

/** The Pac-Man preset with definition edits recorded into a history (as the app does). */
function setup() {
  const project = createProjectFromPreset("pacman");
  const history = new HistoryManager();
  const labels: string[] = [];
  project.definitionRecorder = (label, before, after) => {
    labels.push(label);
    history.record(new DefinitionEditCommand(project, label, before, after));
  };
  const level = project.levels[0];
  const layer = (uid: number) => level.doc.getLayer(layerIdFor(uid));
  return { project, history, labels, level, layer };
}

const paint = (
  project: LevelProject,
  history: HistoryManager,
  uid: number,
  x: number,
  v: number
) => {
  const doc = project.levels[0].doc;
  history.execute(
    new DrawCommand(doc, layerIdFor(uid), [
      { x, y: 0, oldValue: doc.getLayer(layerIdFor(uid))!.get(x, 0), newValue: v },
    ])
  );
};

describe("undo for definition edits", () => {
  it("restores a deleted layer with its cells, and earlier cell edits still undo", () => {
    const { project, history, labels, level, layer } = setup();
    paint(project, history, 1, 3, 1); // a wall
    project.removeLayerDef(1);
    expect(labels).toEqual(["Delete layer"]);
    expect(layer(1)).toBeUndefined();

    history.undo();
    expect(project.getLayerDef(1)?.identifier).toBe("collision");
    expect(layer(1)!.get(3, 0)).toBe(1);
    expect(level.doc.layers.map((l) => l.name)).toEqual(["collision", "collectibles", "entities"]);

    history.undo(); // the cell edit made before the deletion
    expect(layer(1)!.get(3, 0)).toBe(0);
    history.redo();
    history.redo();
    expect(layer(1)).toBeUndefined();
  });

  it("brings back cells cleared by removing a value", () => {
    const { project, history, layer } = setup();
    paint(project, history, 2, 5, 2); // a power pellet
    project.removeIntGridValue(2, 2);
    expect(layer(2)!.get(5, 0)).toBe(0);
    history.undo();
    expect(layer(2)!.get(5, 0)).toBe(2);
    expect(project.getLayerDef(2)!.intGridValues.map((v) => v.identifier)).toContain(
      "power_pellet"
    );
  });

  it("restores deleted entity types and their instances; earlier entity edits stay undoable", () => {
    const { project, history, level } = setup();
    const ghost = level.entities.find((e) => e.iid === "ghost-blinky")!;
    history.execute(
      new UpdateEntityCommand(project, level, ghost, { ...ghost, x: ghost.x + 8 }, "Move")
    );
    project.removeEntityDef(7); // Ghost
    expect(level.entities.some((e) => e.defUid === 7)).toBe(false);
    history.undo();
    expect(level.entities.filter((e) => e.defUid === 7)).toHaveLength(4);
    history.undo(); // the move
    expect(level.entities.find((e) => e.iid === "ghost-blinky")!.x).toBe(ghost.x);
  });

  it("records composite edits as one step and skips no-ops", () => {
    const { project, labels } = setup();
    project.duplicateLayerDef(1); // calls other wrapped methods internally
    project.renameLayerDef(1, "collision"); // same name: no change
    project.setGridSize(project.gridSize); // no change
    expect(labels).toEqual(["Duplicate layer"]);
  });

  it("undoes grid size and auto-layer source changes", () => {
    const project = createProjectFromPreset("platformer");
    const history = new HistoryManager();
    project.definitionRecorder = (label, before, after) =>
      history.record(new DefinitionEditCommand(project, label, before, after));
    const tiles = project.levels[0].doc.getLayer(layerIdFor(2))!;
    const painted = tiles.get(0, 18);
    project.setAutoSource(2, null);
    project.setGridSize(8);
    history.undo();
    expect(project.gridSize).toBe(16);
    history.undo();
    expect(project.isAutoLayer(project.getLayerDef(2))).toBe(true);
    expect(tiles.get(0, 18)).toBe(painted);
    expect(tiles.locked).toBe(true);
  });
});
