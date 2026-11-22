import { EventEmitter, HistoryManager } from "@foundry2d/core";
import { DEFAULT_SETTINGS, parseSettings, type PackSettings } from "./settings";

export interface SpriteImage {
  /** Frame name: the file's path without extension, e.g. "player/walk_0". */
  name: string;
  /** The original file as a data URL, so saving never recompresses it. */
  dataUrl: string;
  width: number;
  height: number;
}

/** A point inside the untrimmed sprite, as fractions from the top-left (may lie outside). */
export interface Pivot {
  readonly x: number;
  readonly y: number;
}

export interface PackSprite extends SpriteImage {
  readonly id: string;
  /** Unset: the engine's default. */
  readonly pivot?: Pivot;
}

/** What undo restores. Sprites are never mutated, so snapshots share them. */
interface State {
  sprites: readonly PackSprite[];
  settings: Readonly<PackSettings>;
}

export const DEFAULT_NAME = "untitled";

let counter = 0;
const newId = () => `s${++counter}`;

/** A usable frame name: forward slashes, no empty or dot parts, never empty. */
export function cleanName(name: string): string {
  const parts = name
    .replace(/\\/g, "/")
    .split("/")
    .map((p) => p.trim())
    .filter((p) => p !== "" && p !== "." && p !== "..");
  return parts.join("/") || "sprite";
}

/** Order people expect: walk_2 before walk_10. */
const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
const sorted = (sprites: PackSprite[]) =>
  sprites.sort((a, b) => collator.compare(a.name, b.name) || (a.name < b.name ? -1 : 1));

/**
 * The open pack: sprites (sorted by name, names unique) and settings. Every
 * edit is one undo step; `changed` fires after edits, undo and loading.
 */
export class PackProject {
  readonly events = new EventEmitter<{ changed: () => void; renamed: () => void }>();
  readonly history = new HistoryManager();
  private state: State = { sprites: [], settings: DEFAULT_SETTINGS };
  private _name = DEFAULT_NAME;

  get name(): string {
    return this._name;
  }

  get sprites(): readonly PackSprite[] {
    return this.state.sprites;
  }

  get settings(): Readonly<PackSettings> {
    return this.state.settings;
  }

  setName(name: string): void {
    const next = name.trim() || DEFAULT_NAME;
    if (next === this._name) return;
    this._name = next;
    this.events.emit("renamed");
  }

  sprite(id: string): PackSprite | undefined {
    return this.state.sprites.find((s) => s.id === id);
  }

  /**
   * Adds images. One whose name is already used replaces that sprite's image
   * (re-importing updated files), keeping its id.
   */
  addImages(images: readonly SpriteImage[]): { added: number; updated: number } {
    const { added, updated } = this.sync(images, []);
    return { added, updated };
  }

  /** Adds or updates `images` and removes the sprites called `removed`, as one undo step. */
  sync(
    images: readonly SpriteImage[],
    removed: readonly string[]
  ): { added: number; updated: number; removed: number } {
    const byKey = new Map(this.state.sprites.map((s) => [s.name, s]));
    let added = 0;
    let updated = 0;
    for (const image of images) {
      const name = cleanName(image.name);
      const existing = byKey.get(name);
      if (existing?.dataUrl === image.dataUrl) continue;
      if (existing) updated++;
      else added++;
      const pivot = existing?.pivot ? { pivot: existing.pivot } : {};
      byKey.set(name, { ...image, name, id: existing?.id ?? newId(), ...pivot });
    }
    let gone = 0;
    for (const name of removed) if (byKey.delete(cleanName(name))) gone++;
    if (added || updated || gone) {
      this.commit(gone ? "Update sprites" : "Add sprites", {
        sprites: sorted([...byKey.values()]),
      });
    }
    return { added, updated, removed: gone };
  }

  remove(ids: Iterable<string>): number {
    const drop = new Set(ids);
    const sprites = this.state.sprites.filter((s) => !drop.has(s.id));
    const removed = this.state.sprites.length - sprites.length;
    if (removed) this.commit("Remove sprites", { sprites });
    return removed;
  }

  /** Renames a sprite. Returns false when the name is taken. */
  rename(id: string, name: string): boolean {
    const sprite = this.sprite(id);
    const next = cleanName(name);
    if (!sprite || next === sprite.name) return true;
    if (this.state.sprites.some((s) => s.name === next)) return false;
    this.commit("Rename sprite", {
      sprites: sorted(this.state.sprites.map((s) => (s.id === id ? { ...s, name: next } : s))),
    });
    return true;
  }

  /** Sets (or with `null` clears) the pivot of some sprites. */
  setPivot(ids: Iterable<string>, pivot: Pivot | null): void {
    const targets = new Set(ids);
    const round = (n: number) => Math.round(Math.min(10, Math.max(-10, n)) * 1000) / 1000;
    const next = pivot && { x: round(pivot.x), y: round(pivot.y) };
    let changed = false;
    const sprites = this.state.sprites.map((s) => {
      if (!targets.has(s.id) || JSON.stringify(s.pivot ?? null) === JSON.stringify(next)) return s;
      changed = true;
      const { pivot: _old, ...rest } = s;
      return next ? { ...rest, pivot: next } : rest;
    });
    if (changed) this.commit("Set pivot", { sprites });
  }

  setSettings(patch: Partial<PackSettings>): void {
    const settings = parseSettings({ ...this.state.settings, ...patch }, this.state.settings);
    if (JSON.stringify(settings) === JSON.stringify(this.state.settings)) return;
    this.commit("Change settings", { settings });
  }

  /** Opens another pack in place (clears undo). */
  load(
    name: string,
    images: readonly (SpriteImage & { pivot?: Pivot })[],
    settings: PackSettings
  ): void {
    this._name = name.trim() || DEFAULT_NAME;
    const byKey = new Map<string, PackSprite>();
    for (const image of images) {
      const key = cleanName(image.name);
      byKey.set(key, { ...image, name: key, id: newId() });
    }
    this.state = { sprites: sorted([...byKey.values()]), settings };
    this.history.clear();
    this.events.emit("renamed");
    this.events.emit("changed");
  }

  private commit(label: string, patch: Partial<State>): void {
    const before = this.state;
    const after = { ...before, ...patch };
    const apply = (state: State) => {
      this.state = state;
      this.events.emit("changed");
    };
    this.history.execute({
      label,
      execute: () => apply(after),
      undo: () => apply(before),
    });
  }
}
