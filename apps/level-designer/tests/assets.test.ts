import { describe, it, expect } from "vite-plus/test";
import { MemoryStorage } from "@foundry2d/core";
import { createProjectFromPreset } from "../src/model/presets";
import { deserializeProject, ProjectFormatError, serializeProject } from "../src/io/projectFile";
import { collectAssetRefs, externalizeAssets, internalizeAssets } from "../src/io/assets";

const PNG = "data:image/png;base64,iVBORw0KGgo=";

function projectWithTileset() {
  const project = createProjectFromPreset("blank");
  project.addTileset({
    identifier: "sheet",
    tileSize: 16,
    spacing: 0,
    padding: 0,
    image: { dataUrl: PNG, width: 16, height: 16 },
  });
  return project;
}

describe("tileset assets", () => {
  it("moves images to the asset store and back without loss", async () => {
    const storage = new MemoryStorage();
    const file = serializeProject(projectWithTileset());
    const stored = await externalizeAssets(file, storage.assets);

    const refs = collectAssetRefs(stored);
    expect(refs).toHaveLength(1);
    expect(JSON.stringify(stored)).not.toContain("base64");
    // The original file object is untouched.
    expect(file.defs.tilesets[0].image.dataUrl).toBe(PNG);

    const restored = await internalizeAssets(stored, storage.assets);
    expect(restored).toEqual(file);
    expect(deserializeProject(restored).defs.tilesets[0].image.dataUrl).toBe(PNG);
  });

  it("stores identical images once", async () => {
    const storage = new MemoryStorage();
    const a = await externalizeAssets(serializeProject(projectWithTileset()), storage.assets);
    const b = await externalizeAssets(serializeProject(projectWithTileset()), storage.assets);
    expect(collectAssetRefs(a)).toEqual(collectAssetRefs(b));
    expect(await storage.assets.prune(collectAssetRefs(a))).toBe(0);
  });

  it("reports a missing asset clearly", async () => {
    const storage = new MemoryStorage();
    const stored = await externalizeAssets(serializeProject(projectWithTileset()), storage.assets);
    await storage.assets.prune([]);
    await expect(internalizeAssets(stored, storage.assets)).rejects.toThrow(ProjectFormatError);
  });
});
