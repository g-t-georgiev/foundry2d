import { describe, it, expect, vi } from "vite-plus/test";
import { MemoryStorage } from "@foundry2d/core";
import { ProjectSession, type SessionState } from "../src/project/ProjectSession";

function setup() {
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
    toStored: (json) => Promise.resolve({ wrapped: json }),
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
