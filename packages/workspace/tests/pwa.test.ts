import { describe, it, expect } from "vite-plus/test";
import { foundryPwa, offlineWorker } from "../vite/pwa";

describe("installable app build plugin (items 34 and 38)", () => {
  const plugin = foundryPwa({
    name: "Game Studio 2D Test",
    shortName: "Test",
    description: "test",
    themeColor: "#000000",
    backgroundColor: "#111111",
    iconSvg: "<svg/>",
    fileTypes: { "application/vnd.gs2d.sprite+json": [".gs2dsprite"] },
  });
  const build = (files: string[]) => {
    const emitted = new Map<string, string>();
    plugin.generateBundle.call(
      { emitFile: (f) => emitted.set(f.fileName, f.source) },
      {},
      Object.fromEntries(files.map((f) => [f, {}]))
    );
    return emitted;
  };

  it("writes a manifest with file handlers, the icon and a service worker", () => {
    const out = build(["assets/index-abc.js", "assets/index-abc.js.map", "index.html"]);
    const manifest = JSON.parse(out.get("manifest.webmanifest")!) as {
      display: string;
      file_handlers: { accept: Record<string, string[]> }[];
    };
    expect(manifest.display).toBe("standalone");
    expect(manifest.file_handlers[0].accept).toEqual({
      "application/vnd.gs2d.sprite+json": [".gs2dsprite"],
    });
    expect(out.get("icon.svg")).toBe("<svg/>");
    const sw = out.get("sw.js")!;
    expect(sw).toContain('"./assets/index-abc.js"');
    expect(sw).not.toContain("index-abc.js.map");
  });

  it("serves its cached page offline only at its own address", () => {
    const sw = build(["index.html"]).get("sw.js")!;
    expect(sw).toContain("pathname === new URL(self.registration.scope).pathname");
    expect(sw).toContain("You're offline");
  });

  it("can write only the offline copy, for pages that don't install", () => {
    const emitted = new Map<string, string>();
    offlineWorker().generateBundle.call(
      { emitFile: (f) => emitted.set(f.fileName, f.source) },
      {},
      { "assets/a.js": {}, "assets/a.js.map": {}, "index.html": {} }
    );
    expect([...emitted.keys()]).toEqual(["sw.js"]);
    expect(emitted.get("sw.js")).toContain('"./assets/a.js"');
  });

  it("gives every build with other files a new worker version", () => {
    const version = (files: string[]) =>
      /const VERSION = "([^"]+)"/.exec(build(files).get("sw.js")!)![1];
    expect(version(["assets/a-1.js"])).toBe(version(["assets/a-1.js"]));
    expect(version(["assets/a-1.js"])).not.toBe(version(["assets/a-2.js"]));
  });

  it("adds the manifest link to the page", () => {
    expect(plugin.transformIndexHtml("<head></head>")).toContain(
      '<link rel="manifest" href="./manifest.webmanifest" />'
    );
  });
});
