import { describe, expect, it } from "vite-plus/test";
import { TourProgress, toursToShow } from "../src/guided-tour/progress";
import type { Tour } from "../src/guided-tour/types";

const tour = (id: string): Tour => ({ id, title: id, steps: [{ title: id, text: "" }] });
const tours = [tour("intro"), tour("whats-new-1"), tour("whats-new-2")];
const ids = (list: Tour[]) => list.map((t) => t.id);

class MemoryStorage {
  readonly data = new Map<string, string>();
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
}

describe("tours", () => {
  it("show the intro first, then only the news not seen yet", () => {
    expect(ids(toursToShow(tours, new Set()))).toEqual(["intro"]);
    expect(ids(toursToShow(tours, new Set(["intro"])))).toEqual(["whats-new-1", "whats-new-2"]);
    expect(ids(toursToShow(tours, new Set(["intro", "whats-new-1"])))).toEqual(["whats-new-2"]);
    expect(toursToShow(tours, new Set(ids(tours)))).toEqual([]);
  });

  it("remember what was seen per app, and survive broken or missing storage", () => {
    const storage = new MemoryStorage();
    const pixel = new TourProgress("pixel", storage);
    pixel.markSeen(["intro"]);
    pixel.markSeen(["whats-new-1", "intro"]);
    expect([...new TourProgress("pixel", storage).seen()]).toEqual(["intro", "whats-new-1"]);
    expect(new TourProgress("level", storage).seen().size).toBe(0);
    storage.setItem("foundry2d.tours.level", "{broken");
    expect(new TourProgress("level", storage).seen().size).toBe(0);
    const none = new TourProgress("pack", null);
    none.markSeen(["intro"]);
    expect(none.seen().size).toBe(0);
  });
});
