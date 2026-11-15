import { describe, it, expect } from "vite-plus/test";
import { isZip, readZip } from "@foundry2d/core";
import { createProjectFromPreset } from "../src/model/presets";
import { deserializeProject, serializeProject } from "../src/io/projectFile";
import { decodeWorkFile, encodePackaged, encodeWorkFile } from "../src/io/packagedFile";

describe("packaged work files (item 6)", () => {
  it("writes project.json plus the tileset images as files", async () => {
    const project = createProjectFromPreset("platformer");
    project.setPackaged(true);
    const json = serializeProject(project);
    const zip = encodePackaged(json);
    expect(isZip(zip)).toBe(true);
    const entries = await readZip(zip);
    const names = entries.map((e) => e.name);
    expect(names[0]).toBe("project.json");
    expect(names.some((n) => /^images\/.+\.png$/.test(n))).toBe(true);
    const inner = JSON.parse(new TextDecoder().decode(entries[0].data)) as {
      packaged: boolean;
      defs: { tilesets: { image: { dataUrl: string } }[] };
    };
    expect(inner.packaged).toBe(true);
    expect(inner.defs.tilesets[0].image.dataUrl).toMatch(/^images\//);
  });

  it("round-trips through a file, keeping the images and the packaged setting", async () => {
    const project = createProjectFromPreset("platformer");
    project.setPackaged(true);
    const json = serializeProject(project);
    const content = encodeWorkFile(json);
    expect(content).toBeInstanceOf(Blob);
    const file = new File([content], "level.f2dlevel");
    const read = await decodeWorkFile(file);
    const copy = deserializeProject(read);
    expect(copy.packaged).toBe(true);
    expect(copy.defs.tilesets[0].image.dataUrl).toBe(project.defs.tilesets[0].image.dataUrl);
  });

  it("plain projects stay JSON text, and JSON files still open", async () => {
    const project = createProjectFromPreset("blank");
    const content = encodeWorkFile(serializeProject(project));
    expect(typeof content).toBe("string");
    const read = await decodeWorkFile(new File([content], "level.f2dlevel"));
    expect(deserializeProject(read).packaged).toBe(false);
  });
});
