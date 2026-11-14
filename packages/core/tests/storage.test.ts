import { describe, it, expect, vi } from "vite-plus/test";
import {
  JsonRecovery,
  MemoryStorage,
  bytesToDataUrl,
  dataUrlToBytes,
  sha256Hex,
  type ProjectRecord,
} from "../src";

const record = (id: string, app: string, updatedAt: number): ProjectRecord => ({
  id,
  app,
  name: id,
  createdAt: 0,
  updatedAt,
  data: { cells: [1, 2, 3] },
});

describe("MemoryStorage", () => {
  it("lists projects per app, newest first, without payloads", async () => {
    const storage = new MemoryStorage();
    await storage.projects.put(record("a", "pixel", 1));
    await storage.projects.put(record("b", "pixel", 3));
    await storage.projects.put(record("c", "level", 2));
    const pixel = await storage.projects.list("pixel");
    expect(pixel.map((p) => p.id)).toEqual(["b", "a"]);
    expect(pixel[0]).not.toHaveProperty("data");
    expect((await storage.projects.list()).length).toBe(3);
  });

  it("returns copies so callers can't mutate stored projects", async () => {
    const storage = new MemoryStorage();
    await storage.projects.put(record("a", "pixel", 1));
    const loaded = (await storage.projects.get("a"))!;
    (loaded.data as { cells: number[] }).cells.push(99);
    expect(((await storage.projects.get("a"))!.data as { cells: number[] }).cells).toEqual([
      1, 2, 3,
    ]);
    await storage.projects.delete("a");
    expect(await storage.projects.get("a")).toBeNull();
  });

  it("deduplicates assets by content hash and prunes unreferenced ones", async () => {
    const storage = new MemoryStorage();
    const bytes = new TextEncoder().encode("tileset");
    const h1 = await storage.assets.put(bytes, "image/png");
    const h2 = await storage.assets.put(bytes.slice(), "image/png");
    const other = await storage.assets.put(new Uint8Array([1, 2]), "image/png");
    expect(h1).toBe(h2);
    expect(h1).toBe(await sha256Hex(bytes));
    expect(await storage.assets.prune([h1])).toBe(1);
    expect(await storage.assets.has(other)).toBe(false);
    expect((await storage.assets.get(h1))!.bytes).toEqual(bytes);
  });

  it("keeps recent files ordered by last open", async () => {
    const storage = new MemoryStorage();
    await storage.recentFiles.put({ id: "1", app: "level", name: "a", openedAt: 5, handle: null });
    await storage.recentFiles.put({ id: "2", app: "level", name: "b", openedAt: 9, handle: null });
    expect((await storage.recentFiles.list("level")).map((r) => r.name)).toEqual(["b", "a"]);
  });
});

describe("data URLs", () => {
  it("round-trips bytes", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255]);
    const url = bytesToDataUrl(bytes, "image/png");
    expect(url.startsWith("data:image/png;base64,")).toBe(true);
    expect(dataUrlToBytes(url)).toEqual({ type: "image/png", bytes });
  });
});

describe("JsonRecovery", () => {
  it("debounces writes into the given recovery store", async () => {
    vi.useFakeTimers();
    try {
      const storage = new MemoryStorage();
      let value = 1;
      const recovery = new JsonRecovery("k", () => ({ value }), {
        store: storage.recovery,
        delay: 100,
      });
      recovery.schedule();
      value = 2;
      recovery.schedule();
      await vi.advanceTimersByTimeAsync(150);
      expect(await recovery.load()).toEqual({ value: 2 });
      await recovery.clear();
      expect(await recovery.load()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
