import type { Tour } from "./types";

/** The id of an app's first-run tour. */
export const INTRO_TOUR = "intro";

/**
 * Which tours to start now: the intro on the first run (the "what's new"
 * tours are then marked seen with it, since the intro covers them), or
 * else every "what's new" tour not seen yet, in order.
 */
export function toursToShow(tours: readonly Tour[], seen: ReadonlySet<string>): Tour[] {
  const intro = tours.find((t) => t.id === INTRO_TOUR);
  if (intro && !seen.has(INTRO_TOUR)) return [intro];
  return tours.filter((t) => t.id !== INTRO_TOUR && !seen.has(t.id));
}

/** Simple string storage, like `localStorage`. */
export interface TourStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Which of an app's tours were seen, kept per browser. */
export class TourProgress {
  private readonly key: string;

  constructor(
    app: string,
    private readonly storage: TourStorage | null = safeLocalStorage()
  ) {
    this.key = `foundry2d.tours.${app}`;
  }

  seen(): Set<string> {
    try {
      const raw: unknown = JSON.parse(this.storage?.getItem(this.key) ?? "[]");
      return new Set(Array.isArray(raw) ? raw.filter((v) => typeof v === "string") : []);
    } catch {
      return new Set();
    }
  }

  markSeen(ids: Iterable<string>): void {
    const all = this.seen();
    for (const id of ids) all.add(id);
    try {
      this.storage?.setItem(this.key, JSON.stringify([...all]));
    } catch {
      // Storage full or blocked: the tour shows again next time, which is harmless.
    }
  }
}

function safeLocalStorage(): TourStorage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
