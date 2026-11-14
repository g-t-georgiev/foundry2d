import { describe, it, expect } from "vite-plus/test";
import { MemoryStorage } from "@foundry2d/core";
import { ProjectSession } from "../src/project/ProjectSession";
import { ProjectFiles, type StartScreenData } from "../src/project/ProjectFiles";

class FormatError extends Error {}

interface Doc {
  name: string;
  cells: number[];
}

/** A ProjectFiles over in-memory storage, with a fake start screen and prompts. */
function setup(options: { confirm?: boolean; storage?: MemoryStorage } = {}) {
  const storage = options.storage ?? new MemoryStorage();
  let open: Doc = { name: "maze", cells: [1] };
  const messages: string[] = [];
  const prompts: string[] = [];
  const screens: StartScreenData[] = [];
  const deleted: string[] = [];
  const session = new ProjectSession({
    app: "test",
    storage,
    titleSuffix: "Test",
    fileType: { description: "Test", mimeType: "application/json", extensions: [".test.json"] },
    serialize: () => structuredClone(open),
    getName: () => open.name,
    onChange: () => {},
    recoveryDelay: 10,
  });
  const files = new ProjectFiles<Doc>({
    session,
    startScreen: { show: (data) => screens.push(data) },
    noun: { one: "doc", title: "Docs" },
    parse: ({ json, name }) => {
      const doc = json as Partial<Doc>;
      if (!Array.isArray(doc.cells)) throw new FormatError("Not a doc.");
      return { name: doc.name ?? name, cells: doc.cells };
    },
    load: (doc) => {
      open = doc;
    },
    templates: () => [{ id: "small", label: "Small" }],
    createFromTemplate: (id) =>
      id === "small" ? { project: { name: "new", cells: [] }, message: "New small doc" } : null,
    isUserFacingError: (error) => error instanceof FormatError,
    notify: (message) => messages.push(message),
    confirm: (message) => {
      prompts.push(message);
      return options.confirm ?? true;
    },
    afterDelete: (id) => {
      deleted.push(id);
      return Promise.resolve();
    },
  });
  return {
    storage,
    session,
    files,
    messages,
    prompts,
    screens,
    deleted,
    current: () => open,
    edit: (cells: number[]) => {
      open = { ...open, cells };
      session.markDirty();
    },
  };
}

describe("ProjectFiles", () => {
  it("creates from a template, asking first only when there are unsaved changes", () => {
    const t = setup({ confirm: false });
    t.files.newFromTemplate("small");
    expect(t.current().name).toBe("new");
    expect(t.prompts).toHaveLength(0);
    expect(t.messages.at(-1)).toBe("New small doc");

    t.edit([9]);
    t.files.newFromTemplate("small");
    expect(t.prompts.at(-1)).toMatch(/Start a new doc\? Unsaved changes will be lost/);
    expect(t.current().cells).toEqual([9]); // declined: nothing replaced
  });

  it("saves to the library, lists it on the start screen and reopens it", async () => {
    const t = setup();
    t.edit([1, 2, 3]);
    await t.files.save();
    expect(t.messages.at(-1)).toBe("Saved in this browser");

    await t.files.showBrowser();
    const screen = t.screens.at(-1)!;
    expect(screen).toMatchObject({ title: "Docs", templates: [{ id: "small" }] });
    expect(screen.library.map((p) => p.name)).toEqual(["maze"]);
    expect(screen.currentId).toBe(screen.library[0].id);
    expect(screen.warning).toMatch(/Docs saved here are lost on reload/);

    t.files.newFromTemplate("small");
    await t.files.openLibrary(screen.library[0].id);
    expect(t.current()).toEqual({ name: "maze", cells: [1, 2, 3] });
    expect(t.messages.at(-1)).toBe("Opened maze");
  });

  it("reports unreadable projects with the format error's message", async () => {
    const t = setup();
    await t.storage.projects.put({
      id: "broken",
      app: "test",
      name: "broken",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      data: { nope: 1 },
    });
    await t.files.openLibrary("broken");
    expect(t.messages.at(-1)).toBe("Not a doc.");
    await t.files.openLibrary("missing");
    expect(t.messages.at(-1)).toBe("That doc is no longer in this browser.");
  });

  it("deletes from the library after confirming, then refreshes the start screen", async () => {
    const t = setup();
    await t.files.save();
    const [meta] = await t.session.listLibrary();
    await t.files.deleteLibrary(meta.id);
    expect(t.prompts.at(-1)).toMatch(/Delete "maze" from this browser\?/);
    expect(t.deleted).toEqual([meta.id]);
    expect(await t.session.listLibrary()).toHaveLength(0);
    expect(t.screens.at(-1)?.library).toEqual([]);
  });

  it("restores unsaved work at startup, or opens the start screen when there is saved work", async () => {
    const t = setup();
    t.edit([4, 5]);
    await t.session.flushRecovery();

    // A fresh app instance on the same storage, as after a reload.
    const restored = setup({ storage: t.storage });
    await restored.files.startup();
    expect(restored.current().cells).toEqual([4, 5]);
    expect(restored.messages.at(-1)).toBe("Restored unsaved work from the last session");

    const fresh = setup();
    await fresh.files.save();
    await fresh.session.clearRecovery();
    await fresh.files.startup();
    expect(fresh.screens).toHaveLength(1);
  });
});
