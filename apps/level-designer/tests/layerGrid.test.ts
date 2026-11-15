import { describe, it, expect } from "vite-plus/test";
import { HistoryManager, ResizeCommand } from "@foundry2d/core";
import { createProjectFromPreset } from "../src/model/presets";
import { layerIdFor } from "../src/model/LevelProject";
import { DefinitionEditCommand } from "../src/model/commands";
import { deserializeProject, serializeProject } from "../src/io/projectFile";
import { toGameFormat } from "../src/io/gameFormat";
import { fromGameFormat, importGameLevel } from "../src/io/gameImport";

function setup() {
  const project = createProjectFromPreset("blank"); // 32×32 cells of 16 px
  const history = new HistoryManager();
  project.definitionRecorder = (label, before, after) =>
    history.record(new DefinitionEditCommand(project, label, before, after));
  const level = project.levels[0];
  const def = project.defs.layers[0];
  const layer = () => level.doc.getLayer(layerIdFor(def.uid))!;
  return { project, history, level, def, layer };
}

describe("per-layer grid sizes", () => {
  it("gives a layer its own grid, resampling its cells; undo restores them", () => {
    const { project, history, def, layer } = setup();
    layer().set(4, 4, 1);
    layer().set(5, 5, 1);
    project.setLayerGridSize(def.uid, 32);
    expect(def.gridSize).toBe(32);
    expect([layer().width, layer().height, layer().scale]).toEqual([16, 16, 2]);
    expect(layer().get(2, 2)).toBe(1);
    expect(project.layerRect(layer(), { x: 0, y: 0 })).toEqual({
      x: 0,
      y: 0,
      width: 512,
      height: 512,
    });

    history.undo();
    // Undo restores definitions as new objects.
    expect(project.getLayerDef(def.uid)?.gridSize).toBeUndefined();
    expect([layer().width, layer().scale]).toEqual([32, 1]);
    expect(layer().get(4, 4)).toBe(1);
    expect(layer().get(5, 5)).toBe(1);
    expect(layer().get(4, 5)).toBe(0);
    history.redo();
    expect(layer().scale).toBe(2);
  });

  it("covers the level when the grid does not divide it", () => {
    const { project, def, layer } = setup();
    project.setLayerGridSize(def.uid, 24); // 512 px / 24 px = 21.3
    expect([layer().width, layer().height]).toEqual([22, 22]);
  });

  it("keeps a layer's own grid in pixels when the project grid changes", () => {
    const { project, def, layer } = setup();
    project.setLayerGridSize(def.uid, 32);
    project.setGridSize(8);
    expect(def.gridSize).toBe(32);
    expect(layer().scale).toBe(4);
    expect(layer().width).toBe(8); // 32 cells of 8 px = 256 px
    project.setGridSize(32);
    expect(def.gridSize).toBeUndefined(); // same as the project grid now
    expect(layer().scale).toBe(1);
  });

  it("auto-layers follow their source's grid", () => {
    const project = createProjectFromPreset("platformer");
    const auto = project.defs.layers.find((d) => project.isAutoLayer(d))!;
    const source = project.autoSourceOf(auto)!;
    const level = project.levels[0];
    project.setLayerGridSize(source.uid, project.gridSize * 2);
    expect(auto.gridSize).toBe(project.gridSize * 2);
    const autoLayer = level.doc.getLayer(layerIdFor(auto.uid))!;
    const sourceLayer = level.doc.getLayer(layerIdFor(source.uid))!;
    expect([autoLayer.width, autoLayer.height]).toEqual([sourceLayer.width, sourceLayer.height]);
    // An auto-layer's own grid can't be changed.
    project.setLayerGridSize(auto.uid, 64);
    expect(auto.gridSize).toBe(project.gridSize * 2);
  });

  it("resizes coarse layers by their own cells, and undo restores them", () => {
    const { project, level, def, layer } = setup();
    project.setLayerGridSize(def.uid, 32);
    layer().set(0, 0, 1);
    const history = new HistoryManager();
    history.execute(new ResizeCommand(level.doc, { width: 36, height: 32 }, { x: 4, y: 0 }));
    expect(layer().width).toBe(18);
    expect(layer().get(2, 0)).toBe(1);
    history.undo();
    expect(layer().width).toBe(16);
    expect(layer().get(0, 0)).toBe(1);
  });

  it("saves, exports and imports the layer grid", () => {
    const { project, level, def, layer } = setup();
    project.setLayerGridSize(def.uid, 32);
    layer().set(3, 2, 1);

    const loaded = deserializeProject(serializeProject(project));
    const loadedLayer = loaded.levels[0].doc.getLayer(layerIdFor(def.uid))!;
    expect(loaded.getLayerDef(def.uid)?.gridSize).toBe(32);
    expect([loadedLayer.width, loadedLayer.scale, loadedLayer.get(3, 2)]).toEqual([16, 2, 1]);

    const file = toGameFormat(project, level);
    expect(file.layerGrids).toEqual({ [def.identifier]: { gridSize: 32, columns: 16, rows: 16 } });
    expect(file.layers[def.identifier]).toHaveLength(256);

    const opened = fromGameFormat(file);
    expect(opened.defs.layers[0].gridSize).toBe(32);
    expect(opened.levels[0].doc.layers[0].get(3, 2)).toBe(1);

    const { level: copy, warnings } = importGameLevel(project, file);
    expect(warnings).toEqual([]);
    expect(copy.doc.getLayer(layerIdFor(def.uid))!.get(3, 2)).toBe(1);

    // A project where the layer uses the project grid skips it, with a warning.
    const other = createProjectFromPreset("blank");
    expect(importGameLevel(other, file).warnings.join(" ")).toMatch(/another grid size/);
  });
});

describe("guide grid per layer (item 46)", () => {
  it("is stored on the definition, undoable and saved", () => {
    const { project, history, def } = setup();
    project.setLayerGuideGrid(def.uid, { width: 128, height: 96 });
    expect(def.guideGrid).toEqual({ width: 128, height: 96 });
    const loaded = deserializeProject(serializeProject(project));
    expect(loaded.getLayerDef(def.uid)?.guideGrid).toEqual({ width: 128, height: 96 });
    history.undo();
    expect(project.getLayerDef(def.uid)?.guideGrid).toBeUndefined();
    // Display only: the layer's cells don't change.
    expect(project.levels[0].doc.getLayer(layerIdFor(def.uid))!.scale).toBe(1);
  });
});
