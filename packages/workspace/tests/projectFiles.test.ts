import { afterEach, describe, it, expect, vi } from "vite-plus/test";
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
  let shown = false;
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
    startScreen: {
      show: (data) => {
        screens.push(data);
        shown = true;
      },
      close: () => (shown = false),
    },
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
    startScreenShown: () => shown,
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

describe("files the installed app is launched with", () => {
  type Consumer = (params: { files: unknown[] }) => void;
  let consumer: Consumer = () => {};
  const stubQueue = () =>
    vi.stubGlobal("launchQueue", { setConsumer: (c: Consumer) => (consumer = c) });
  const launch = (name: string, content = JSON.stringify({ name: "launched", cells: [7] })) =>
    consumer({
      files: [{ kind: "file", name, getFile: () => Promise.resolve(new File([content], name)) }],
    });
  afterEach(() => vi.unstubAllGlobals());

  /** Storage with a saved project, so startup has something to offer. */
  async function saved() {
    const t = setup();
    await t.files.save();
    return t.storage;
  }

  it("open instead of the start screen", async () => {
    stubQueue();
    const t = setup({ storage: await saved() });
    t.files.bindLaunchQueue();
    launch("a.test.json");
    await t.files.startup();
    expect(t.current().name).toBe("launched");
    expect(t.session.state).toMatchObject({ fileName: "a.test.json", dirty: false });
    expect(t.screens).toHaveLength(0);
    expect(t.prompts).toHaveLength(0);
  });

  it("close the start screen when they come later, unless they can't be read", async () => {
    stubQueue();
    const t = setup({ storage: await saved() });
    t.files.bindLaunchQueue();
    await t.files.startup();
    expect(t.startScreenShown()).toBe(true);
    launch("bad.test.json", "{}");
    await vi.waitFor(() => expect(t.messages.at(-1)).toBe("Not a doc."));
    expect(t.startScreenShown()).toBe(true);
    launch("a.test.json");
    await vi.waitFor(() => expect(t.startScreenShown()).toBe(false));
    expect(t.current().name).toBe("launched");
  });

  it("ask before they replace restored unsaved work", async () => {
    const before = setup();
    before.edit([4, 5]);
    await before.session.flushRecovery();
    for (const confirm of [false, true]) {
      stubQueue();
      const t = setup({ storage: before.storage, confirm });
      t.files.bindLaunchQueue();
      launch("a.test.json");
      await t.files.startup();
      expect(t.prompts).toHaveLength(1);
      expect(t.current().cells).toEqual(confirm ? [7] : [4, 5]);
    }
  });
});

describe("ProjectFiles library extras", () => {
  it("duplicates a library entry under a free name", async () => {
    const t = setup();
    await t.files.save();
    const [original] = await t.session.listLibrary();
    await t.files.duplicateLibrary(original.id);
    await t.files.duplicateLibrary(original.id);
    const names = (await t.session.listLibrary()).map((p) => p.name).sort();
    expect(names).toEqual(["maze", "maze copy", "maze copy 2"]);
    // Copies of a file's entry don't belong to that file.
    const record = (await t.storage.projects.get(original.id))!;
    await t.storage.projects.put({ ...record, file: { kind: "file" } });
    await t.files.duplicateLibrary(original.id);
    const linked = (await t.session.listLibrary()).filter((p) => p.file);
    expect(linked.map((p) => p.id)).toEqual([original.id]);
    expect(t.screens.at(-1)?.library).toHaveLength(4);
  });

  it("saves a copy in the browser and keeps working on the copy", async () => {
    const t = setup();
    await t.files.save();
    const [original] = await t.session.listLibrary();
    let renamed = "";
    const files = new ProjectFiles<Doc>({
      ...(t.files as unknown as { options: ConstructorParameters<typeof ProjectFiles<Doc>>[0] })
        .options,
      setName: (name) => (renamed = name),
      promptName: (_message, initial) => `${initial}!`,
    });
    await files.saveCopyInBrowser("maze");
    expect(renamed).toBe("maze copy!");
    const library = await t.session.listLibrary();
    expect(library).toHaveLength(2);
    expect(t.session.state.libraryId).not.toBe(original.id);
    expect(t.session.state.dirty).toBe(false);
  });
});

describe("stripFileExtension", () => {
  it("strips branded, legacy and plain JSON extensions", async () => {
    const { stripFileExtension } = await import("../src/project/files");
    const type = {
      description: "",
      mimeType: "application/vnd.foundry2d.level+json",
      extensions: [".f2dlevel"],
      legacyExtensions: [".f2dlevel.json"],
    };
    expect(stripFileExtension("maze.f2dlevel", type)).toBe("maze");
    expect(stripFileExtension("maze.F2DLEVEL.json", type)).toBe("maze");
    expect(stripFileExtension("export.json", type)).toBe("export");
    expect(stripFileExtension("notes.txt", type)).toBe("notes.txt");
  });
});
