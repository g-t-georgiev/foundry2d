import { EventEmitter, GridDocument, PixelUtils } from "@foundry2d/core";
import type { CellColorizer } from "@foundry2d/render";
import type { IntGridValueDef, LayerDef, ProjectDefs } from "./types";

/** IntGrid cells use 0 for "empty", like LDtk. */
export const EMPTY_CELL = 0;

export type LevelDocument = GridDocument<Int32Array>;

export class Level {
  constructor(
    public readonly uid: number,
    public identifier: string,
    public worldX: number,
    public worldY: number,
    public readonly doc: LevelDocument
  ) {}

  get width(): number {
    return this.doc.width;
  }

  get height(): number {
    return this.doc.height;
  }
}

export type ProjectEventMap = {
  /** Layer definitions (identifiers, values, colors, order) changed. */
  "defs:changed": () => void;
  /** Levels were added, removed or renamed. */
  "levels:changed": () => void;
  /** Project-wide settings (name, grid size) changed. */
  "settings:changed": () => void;
};

const DEFAULT_COLORS = [
  "#4c9ffe",
  "#e5484d",
  "#30a46c",
  "#f5d90a",
  "#8e4ec6",
  "#f76b15",
  "#12a594",
  "#d6409f",
];

/** Builds the document layer id for a layer definition. */
export const layerIdFor = (defUid: number): string => `def_${defUid}`;

/** Inverse of `layerIdFor`; `null` for layers not backed by a definition. */
export const defUidOf = (layerId: string): number | null => {
  const match = /^def_(\d+)$/.exec(layerId);
  return match ? Number(match[1]) : null;
};

/**
 * Runtime model of a level project: shared layer definitions plus levels,
 * each owning a `GridDocument<Int32Array>` whose layers mirror the defs.
 *
 * Definition edits are applied to every level so the invariant
 * "every level has exactly one layer per def, in def order" always holds.
 */
export class LevelProject {
  public readonly events = new EventEmitter<ProjectEventMap>();
  public readonly defs: ProjectDefs = { layers: [] };
  public readonly levels: Level[] = [];
  /** Bumped whenever colors change so cached layer bitmaps are refreshed. */
  public paletteVersion = 0;
  private nextUid = 1;
  private colorizers = new Map<number, CellColorizer>();

  constructor(
    public name: string,
    public gridSize: number
  ) {}

  // ------------------------------------------------------------------ uids

  allocateUid(): number {
    return this.nextUid++;
  }

  /** Makes sure future uids don't collide with `uid` (used when loading). */
  reserveUid(uid: number): void {
    this.nextUid = Math.max(this.nextUid, uid + 1);
  }

  get uidCounter(): number {
    return this.nextUid;
  }

  // ------------------------------------------------------------------ settings

  setGridSize(size: number): void {
    const next = Math.max(1, Math.round(size));
    if (next === this.gridSize) return;
    this.gridSize = next;
    this.events.emit("settings:changed");
  }

  setName(name: string): void {
    if (!name || name === this.name) return;
    this.name = name;
    this.events.emit("settings:changed");
  }

  // ------------------------------------------------------------------ levels

  createLevel(
    identifier: string,
    width: number,
    height: number,
    options: { worldX?: number; worldY?: number; uid?: number } = {}
  ): Level {
    const doc = new GridDocument<Int32Array>({
      width,
      height,
      emptyValue: EMPTY_CELL,
      bufferCtor: Int32Array,
    });
    for (const def of this.defs.layers) {
      doc.addLayer({ id: layerIdFor(def.uid), name: def.identifier, activate: false });
    }
    doc.setActiveLayer(doc.layers.at(-1)?.id ?? null);
    const uid = options.uid ?? this.allocateUid();
    this.reserveUid(uid);
    const level = new Level(uid, identifier, options.worldX ?? 0, options.worldY ?? 0, doc);
    this.levels.push(level);
    this.events.emit("levels:changed");
    return level;
  }

  getLevel(uid: number): Level | undefined {
    return this.levels.find((l) => l.uid === uid);
  }

  // ------------------------------------------------------------------ layer defs

  getLayerDef(uid: number): LayerDef | undefined {
    return this.defs.layers.find((d) => d.uid === uid);
  }

  /** Definition behind a document layer id. */
  getLayerDefForLayer(layerId: string): LayerDef | undefined {
    const uid = defUidOf(layerId);
    return uid === null ? undefined : this.getLayerDef(uid);
  }

  /** Adds an IntGrid layer definition on top of the stack, in every level. */
  addIntGridLayer(identifier: string, values: Omit<IntGridValueDef, never>[] = []): LayerDef {
    const def: LayerDef = {
      uid: this.allocateUid(),
      identifier: this.uniqueIdentifier(identifier),
      type: "IntGrid",
      intGridValues: values.map((v) => ({ ...v })),
    };
    this.defs.layers.push(def);
    for (const level of this.levels) {
      level.doc.addLayer({ id: layerIdFor(def.uid), name: def.identifier, activate: false });
    }
    this.defsChanged();
    return def;
  }

  /** Removes a definition and its data from every level. */
  removeLayerDef(uid: number): boolean {
    const index = this.defs.layers.findIndex((d) => d.uid === uid);
    if (index === -1 || this.defs.layers.length <= 1) return false;
    this.defs.layers.splice(index, 1);
    for (const level of this.levels) level.doc.removeLayer(layerIdFor(uid));
    this.defsChanged();
    return true;
  }

  /** Moves a definition one step up (drawn above) or down in every level. */
  moveLayerDef(uid: number, direction: "up" | "down"): boolean {
    const from = this.defs.layers.findIndex((d) => d.uid === uid);
    const to = direction === "up" ? from + 1 : from - 1;
    if (from === -1 || to < 0 || to >= this.defs.layers.length) return false;
    const [def] = this.defs.layers.splice(from, 1);
    this.defs.layers.splice(to, 0, def);
    for (const level of this.levels) level.doc.moveLayer(from, to);
    this.defsChanged();
    return true;
  }

  renameLayerDef(uid: number, identifier: string): void {
    const def = this.getLayerDef(uid);
    const clean = identifier.trim();
    if (!def || !clean || clean === def.identifier) return;
    def.identifier = this.uniqueIdentifier(clean, uid);
    for (const level of this.levels) {
      level.doc.setLayerProperty(layerIdFor(uid), "name", def.identifier);
    }
    this.defsChanged();
  }

  /** Adds the next free value to an IntGrid def. */
  addIntGridValue(uid: number): IntGridValueDef | null {
    const def = this.getLayerDef(uid);
    if (!def) return null;
    const value = Math.max(0, ...def.intGridValues.map((v) => v.value)) + 1;
    const entry: IntGridValueDef = {
      value,
      identifier: `value_${value}`,
      color: DEFAULT_COLORS[(value - 1) % DEFAULT_COLORS.length],
    };
    def.intGridValues.push(entry);
    this.defsChanged();
    return entry;
  }

  updateIntGridValue(
    uid: number,
    value: number,
    patch: Partial<Omit<IntGridValueDef, "value">>
  ): void {
    const entry = this.getLayerDef(uid)?.intGridValues.find((v) => v.value === value);
    if (!entry) return;
    Object.assign(entry, patch);
    this.defsChanged();
  }

  /**
   * Removes a value from a def. Cells holding it are cleared in every level
   * (this is not undoable, like other definition edits).
   */
  removeIntGridValue(uid: number, value: number): void {
    const def = this.getLayerDef(uid);
    if (!def) return;
    def.intGridValues = def.intGridValues.filter((v) => v.value !== value);
    const layerId = layerIdFor(uid);
    for (const level of this.levels) {
      const layer = level.doc.getLayer(layerId);
      if (!layer) continue;
      let changed = false;
      for (let i = 0; i < layer.data.length; i++) {
        if (layer.data[i] === value) {
          layer.data[i] = EMPTY_CELL;
          changed = true;
        }
      }
      if (changed) {
        layer.version++;
        level.doc.notifyCellsChanged(layerId);
      }
    }
    this.defsChanged();
  }

  // ------------------------------------------------------------------ rendering

  /** Value → packed color for a document layer, cached per definition. */
  colorizerFor(layerId: string): CellColorizer | undefined {
    const uid = defUidOf(layerId);
    if (uid === null) return undefined;
    let colorizer = this.colorizers.get(uid);
    if (!colorizer) {
      const def = this.getLayerDef(uid);
      if (!def) return undefined;
      const table = new Map(
        def.intGridValues.map((v) => [v.value, PixelUtils.hexToUint32(v.color)])
      );
      // Unknown values (e.g. imported data without a def entry) show as magenta.
      const unknown = PixelUtils.hexToUint32("#ff00ff");
      colorizer = (value) => (value === EMPTY_CELL ? 0 : (table.get(value) ?? unknown));
      this.colorizers.set(uid, colorizer);
    }
    return colorizer;
  }

  // ------------------------------------------------------------------ internals

  private uniqueIdentifier(base: string, ignoreUid?: number): string {
    const taken = new Set(
      this.defs.layers.filter((d) => d.uid !== ignoreUid).map((d) => d.identifier)
    );
    if (!taken.has(base)) return base;
    let n = 2;
    while (taken.has(`${base}_${n}`)) n++;
    return `${base}_${n}`;
  }

  private defsChanged(): void {
    this.colorizers.clear();
    this.paletteVersion++;
    this.events.emit("defs:changed");
  }
}
