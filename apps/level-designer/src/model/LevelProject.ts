import { EventEmitter, GridDocument, PixelUtils, type Rect } from "@foundry2d/core";
import type { CellColorizer } from "@foundry2d/render";
import type { IntGridValueDef, LayerDef, ProjectDefs, WorldLayout } from "./types";

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

  /** Level rectangle in world pixels. */
  worldRect(gridSize: number): Rect {
    return {
      x: this.worldX,
      y: this.worldY,
      width: this.width * gridSize,
      height: this.height * gridSize,
    };
  }
}

export type ProjectEventMap = {
  /** Layer definitions (identifiers, values, colors, order) changed. */
  "defs:changed": () => void;
  /** Levels were added, removed, reordered, renamed or moved. */
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
  /** How levels are arranged in the world view. */
  public worldLayout: WorldLayout = "free";
  /** World grid cell in pixels; levels snap to it in the "gridvania" layout. */
  public worldGrid = { width: 256, height: 256 };
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

  setWorldLayout(layout: WorldLayout): void {
    if (layout === this.worldLayout) return;
    this.worldLayout = layout;
    this.arrangeLevels();
    this.events.emit("settings:changed");
    this.events.emit("levels:changed");
  }

  setWorldGrid(width: number, height: number): void {
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    if (w === this.worldGrid.width && h === this.worldGrid.height) return;
    this.worldGrid = { width: w, height: h };
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
    const level = new Level(
      uid,
      this.uniqueLevelIdentifier(identifier),
      options.worldX ?? 0,
      options.worldY ?? 0,
      doc
    );
    this.levels.push(level);
    this.arrangeLevels();
    this.events.emit("levels:changed");
    return level;
  }

  getLevel(uid: number): Level | undefined {
    return this.levels.find((l) => l.uid === uid);
  }

  indexOfLevel(uid: number): number {
    return this.levels.findIndex((l) => l.uid === uid);
  }

  /** A level identifier not used by any other level. */
  uniqueLevelIdentifier(base: string, ignoreUid?: number): string {
    const taken = new Set(this.levels.filter((l) => l.uid !== ignoreUid).map((l) => l.identifier));
    if (!taken.has(base)) return base;
    const stem = base.replace(/_\d+$/, "");
    let n = 1;
    while (taken.has(`${stem}_${n}`)) n++;
    return `${stem}_${n}`;
  }

  /** Detaches a level (at least one must remain). Returns its old index, or -1. */
  removeLevel(uid: number): number {
    const index = this.indexOfLevel(uid);
    if (index === -1 || this.levels.length <= 1) return -1;
    this.levels.splice(index, 1);
    this.arrangeLevels();
    this.events.emit("levels:changed");
    return index;
  }

  /** Inserts a detached level (undo of remove, or a duplicate). */
  insertLevel(level: Level, index = this.levels.length): void {
    this.reserveUid(level.uid);
    this.levels.splice(Math.max(0, Math.min(index, this.levels.length)), 0, level);
    this.arrangeLevels();
    this.events.emit("levels:changed");
  }

  /** Builds (but does not insert) a copy of a level with a new uid and identifier. */
  cloneLevel(uid: number, worldX: number, worldY: number): Level | null {
    const source = this.getLevel(uid);
    if (!source) return null;
    const doc = new GridDocument<Int32Array>({
      width: source.width,
      height: source.height,
      emptyValue: EMPTY_CELL,
      bufferCtor: Int32Array,
    });
    for (const layer of source.doc.layers) {
      doc.addLayer({
        id: layer.id,
        name: layer.name,
        visible: layer.visible,
        opacity: layer.opacity,
        data: layer.data,
        activate: false,
      });
    }
    doc.setActiveLayer(source.doc.activeLayerId);
    const identifier = this.uniqueLevelIdentifier(`${source.identifier}_copy`);
    return new Level(this.allocateUid(), identifier, worldX, worldY, doc);
  }

  moveLevel(uid: number, worldX: number, worldY: number): void {
    const level = this.getLevel(uid);
    if (!level || (level.worldX === worldX && level.worldY === worldY)) return;
    level.worldX = worldX;
    level.worldY = worldY;
    this.events.emit("levels:changed");
  }

  /** Changes a level position in the list (matters for linear layouts). */
  reorderLevel(from: number, to: number): boolean {
    const count = this.levels.length;
    if (from === to || from < 0 || to < 0 || from >= count || to >= count) return false;
    const [level] = this.levels.splice(from, 1);
    this.levels.splice(to, 0, level);
    this.arrangeLevels();
    this.events.emit("levels:changed");
    return true;
  }

  renameLevel(uid: number, identifier: string): void {
    const level = this.getLevel(uid);
    const clean = identifier.trim();
    if (!level || !clean || clean === level.identifier) return;
    level.identifier = this.uniqueLevelIdentifier(clean, uid);
    this.events.emit("levels:changed");
  }

  /** Whether levels may be dragged in the current layout. */
  get canDragLevels(): boolean {
    return this.worldLayout === "free" || this.worldLayout === "gridvania";
  }

  /** Snaps a world position to the layout grid (world grid or level grid). */
  snapPosition(x: number, y: number): { x: number; y: number } {
    const step =
      this.worldLayout === "gridvania"
        ? this.worldGrid
        : { width: this.gridSize, height: this.gridSize };
    return {
      x: Math.round(x / step.width) * step.width,
      y: Math.round(y / step.height) * step.height,
    };
  }

  /**
   * In linear layouts positions are derived from list order: levels sit
   * side by side (or stacked) with a gap of two grid cells.
   */
  arrangeLevels(): void {
    if (this.worldLayout !== "linearH" && this.worldLayout !== "linearV") return;
    const gap = this.gridSize * 2;
    let offset = 0;
    for (const level of this.levels) {
      const rect = level.worldRect(this.gridSize);
      if (this.worldLayout === "linearH") {
        level.worldX = offset;
        level.worldY = 0;
        offset += rect.width + gap;
      } else {
        level.worldX = 0;
        level.worldY = offset;
        offset += rect.height + gap;
      }
    }
  }

  /** Union of all level rectangles in world pixels, or `null` when there are none. */
  getWorldBounds(): Rect | null {
    if (this.levels.length === 0) return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const level of this.levels) {
      const r = level.worldRect(this.gridSize);
      minX = Math.min(minX, r.x);
      minY = Math.min(minY, r.y);
      maxX = Math.max(maxX, r.x + r.width);
      maxY = Math.max(maxY, r.y + r.height);
    }
    return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
  }

  /** Topmost level containing a world point. */
  levelAt(worldX: number, worldY: number): Level | undefined {
    for (let i = this.levels.length - 1; i >= 0; i--) {
      const r = this.levels[i].worldRect(this.gridSize);
      if (worldX >= r.x && worldY >= r.y && worldX < r.x + r.width && worldY < r.y + r.height) {
        return this.levels[i];
      }
    }
    return undefined;
  }

  /** A free spot to the right of the existing levels, aligned to the layout. */
  nextFreePosition(): { x: number; y: number } {
    const bounds = this.getWorldBounds();
    if (!bounds) return { x: 0, y: 0 };
    return this.snapPosition(bounds.x + bounds.width + this.gridSize * 2, bounds.y);
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
