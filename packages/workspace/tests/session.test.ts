import { describe, it, expect, vi } from "vite-plus/test";
import { MemoryStorage } from "@gs2d/core";
import { ProjectSession, type SessionState } from "../src/project/ProjectSession";

function setup(toStored = (json: unknown): Promise<unknown> => Promise.resolve({ wrapped: json })) {
  const storage = new MemoryStorage();
  const project = { name: "maze", cells: [1, 2, 3] };
  const states: SessionState[] = [];
  const session = new ProjectSession({
    app: "level",
    storage,
    titleSuffix: "Test",
    fileType: { description: "Test", mimeType: "application/json", extensions: [".test.json"] },
    serialize: () => structuredClone(project),
    // Pretend to move data out on store, and back in on load.
    toStored,
    fromStored: (json) => Promise.resolve((json as { wrapped: unknown }).wrapped),
    getName: () => project.name,
    thumbnail: () => "data:image/png;base64,AA==",
    onChange: (state) => states.push(state),
    recoveryDelay: 50,
  });
  return { storage, project, session, states };
}

describe("ProjectSession", () => {
  it("saves into the library once, then updates the same entry", async () => {
    const { storage, project, session } = setup();
    session.markDirty();
    expect(session.state.dirty).toBe(true);
    await session.save();
    const [first] = await storage.projects.list("level");
    expect(session.state).toMatchObject({ dirty: false, libraryId: first.id });
    expect(first.thumbnail).toContain("data:image/png");

    project.name = "maze v2";
    await session.save();
    const all = await storage.projects.list("level");
    expect(all).toHaveLength(1);
    expect(all[0].name).toBe("maze v2");
    const stored = await storage.projects.get(first.id);
    expect(stored?.data).toEqual({ wrapped: { name: "maze v2", cells: [1, 2, 3] } });
    expect(await session.openFromLibrary(first.id)).toEqual({
      json: { name: "maze v2", cells: [1, 2, 3] },
      name: "maze v2",
    });
  });

  it("reopening a file keeps saving into its library copy", async () => {
    const { storage, session } = setup();
    const file = (name: string) => {
      const state = { lastModified: 0 };
      const handle = {
        kind: "file" as const,
        name,
        state,
        getFile: () =>
          Promise.resolve(new File(["{}"], name, { lastModified: state.lastModified })),
        isSameEntry: (other: unknown) => Promise.resolve(other === handle),
        createWritable: () =>
          Promise.resolve({
            write: () => Promise.resolve(),
            close: () => {
              state.lastModified = Date.now();
              return Promise.resolve();
            },
          }),
      };
      return handle;
    };
    const ids = async () => (await storage.projects.list("level")).map((p) => p.id);

    // Opened from disk: the first save adds the copy, later ones update it.
    const maze = file("maze.test.json");
    await session.adoptFile("maze", maze);
    expect(session.state.libraryId).toBeNull();
    await session.save();
    const [copy] = await ids();
    await session.adoptFile("maze", maze);
    expect(session.state).toMatchObject({ libraryId: copy, fileName: maze.name });
    await session.save();
    expect(await ids()).toEqual([copy]);

    // Another file of the same name is its own work.
    await session.adoptFile("maze", file("maze.test.json"));
    expect(session.state.libraryId).toBeNull();

    // A copy that is newer than the file isn't overwritten with the file's work.
    const { lastModified } = maze.state;
    maze.state.lastModified = lastModified - 60_000;
    await session.adoptFile("maze", maze);
    expect(session.state.libraryId).toBeNull();
    maze.state.lastModified = lastModified;

    // Neither is one that was opened from the library and saved without the file.
    session.adoptLibrary(copy);
    await session.save();
    await session.adoptFile("maze", maze);
    expect(session.state.libraryId).toBeNull();
    await session.save();
    expect(await ids()).toHaveLength(2);
  });

  it("a slow snapshot never replaces a newer one or comes back after saving", async () => {
    let release = () => {};
    const slow = new Promise<void>((resolve) => (release = resolve));
    let calls = 0;
    const { project, session } = setup(async (json) => {
      if (calls++ === 0) await slow;
      return { wrapped: json };
    });
    const first = session.flushRecovery();
    project.name = "newer";
    await session.flushRecovery();
    release();
    await first;
    expect((await session.loadRecovery())?.json).toMatchObject({ name: "newer" });

    calls = 0;
    const late = session.flushRecovery();
    await session.clearRecovery();
    await late;
    expect(await session.loadRecovery()).toBeNull();
  });

  it("snapshots unsaved work and restores it with its identity", async () => {
    vi.useFakeTimers();
    try {
      const { storage, project, session } = setup();
      await session.save();
      const libraryId = session.state.libraryId;
      project.cells.push(4);
      session.markDirty();
      await vi.advanceTimersByTimeAsync(100);

      const next = new ProjectSession({
        app: "level",
        storage,
        titleSuffix: "Test",
        fileType: { description: "Test", mimeType: "application/json", extensions: [".json"] },
        serialize: () => ({}),
        fromStored: (json) => Promise.resolve((json as { wrapped: unknown }).wrapped),
        getName: () => "x",
      });
      const recovered = await next.loadRecovery();
      expect(recovered?.json).toEqual({ name: "maze", cells: [1, 2, 3, 4] });
      await next.adoptRecovered(recovered!.snapshot);
      expect(next.state).toMatchObject({ libraryId, dirty: true });

      // Saving clears the snapshot.
      await session.save();
      expect(await next.loadRecovery()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("resetIdentity starts a fresh, clean, unsaved project", async () => {
    const { session, states } = setup();
    await session.save();
    session.resetIdentity();
    expect(session.state).toMatchObject({ libraryId: null, fileName: null, dirty: false });
    expect(states.length).toBeGreaterThan(1);
  });

  it("forgets the library id when its entry is deleted", async () => {
    const { storage, session } = setup();
    await session.save();
    await session.deleteFromLibrary(session.state.libraryId!);
    expect(session.state.libraryId).toBeNull();
    expect(await storage.projects.list()).toHaveLength(0);
  });
});
