import {
  EventEmitter,
  GridDocument,
  PixelUtils,
  type Rect,
  type Unsubscribe,
} from "@foundry2d/core";
import { createRule, generateAutoTiles, resizePattern, type AutoRule } from "./autoRules";
import type { CellColorizer } from "@foundry2d/render";
import type {
  EntityDef,
  EntityInstance,
  EnumDef,
  FieldDef,
  FieldType,
  IntGridValueDef,
  LayerDef,
  ProjectDefs,
  TilesetDef,
  WorldLayout,
} from "./types";
import { cloneInstance, initialDefault, newIid, validateFieldValue } from "./entities";

/** IntGrid cells use 0 for "empty", like LDtk. */
export const EMPTY_CELL = 0;

export type LevelDocument = GridDocument<Int32Array>;

export class Level {
  /** Placed entities on every Entities layer, in draw order. */
  public entities: EntityInstance[] = [];

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
  /** A tileset image finished decoding and can now be drawn. */
  "tilesets:loaded": () => void;
  /** Levels were added, removed, reordered, renamed or moved. */
  "levels:changed": () => void;
  /** Project-wide settings (name, grid size) changed. */
  "settings:changed": () => void;
  /** Entity instances of a level were added, removed, moved or edited. */
  "entities:changed": (levelUid: number) => void;
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
  public readonly defs: ProjectDefs = { layers: [], tilesets: [], entities: [], enums: [] };
  public readonly levels: Level[] = [];
  /** Bumped whenever colors change so cached layer bitmaps are refreshed. */
  public paletteVersion = 0;
  /** How levels are arranged in the world view. */
  public worldLayout: WorldLayout = "free";
  /** World grid cell in pixels; levels snap to it in the "gridvania" layout. */
  public worldGrid = { width: 256, height: 256 };
  private nextUid = 1;
  /** Source-layer watchers per level uid (auto-layer regeneration). */
  private watchers = new Map<number, Unsubscribe>();
  private pendingRegen = new Set<Level>();
  private regenQueued = false;
  private colorizers = new Map<number, CellColorizer>();
  private tilesetImages = new Map<
    number,
    { src: string; image: HTMLImageElement; ready: boolean }
  >();

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
    this.watchLevel(level);
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
    const [removed] = this.levels.splice(index, 1);
    this.watchers.get(removed.uid)?.();
    this.watchers.delete(removed.uid);
    this.arrangeLevels();
    this.events.emit("levels:changed");
    return index;
  }

  /** Inserts a detached level (undo of remove, or a duplicate). */
  insertLevel(level: Level, index = this.levels.length): void {
    this.reserveUid(level.uid);
    this.levels.splice(Math.max(0, Math.min(index, this.levels.length)), 0, level);
    this.watchLevel(level);
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
    const copy = new Level(this.allocateUid(), identifier, worldX, worldY, doc);
    copy.entities = source.entities.map((e) => cloneInstance(e, newIid()));
    return copy;
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

  /** Adds a Tiles layer definition on top of the stack, in every level. */
  addTilesLayer(identifier: string, tilesetUid: number | null = null): LayerDef {
    const def: LayerDef = {
      uid: this.allocateUid(),
      identifier: this.uniqueIdentifier(identifier),
      type: "Tiles",
      intGridValues: [],
      tilesetUid,
    };
    this.defs.layers.push(def);
    for (const level of this.levels) {
      level.doc.addLayer({ id: layerIdFor(def.uid), name: def.identifier, activate: false });
    }
    this.defsChanged();
    return def;
  }

  /** Adds an Entities layer definition on top of the stack, in every level. */
  addEntitiesLayer(identifier: string): LayerDef {
    const def: LayerDef = {
      uid: this.allocateUid(),
      identifier: this.uniqueIdentifier(identifier),
      type: "Entities",
      intGridValues: [],
    };
    this.defs.layers.push(def);
    for (const level of this.levels) {
      level.doc.addLayer({ id: layerIdFor(def.uid), name: def.identifier, activate: false });
    }
    this.defsChanged();
    return def;
  }

  setLayerTileset(uid: number, tilesetUid: number | null): void {
    const def = this.getLayerDef(uid);
    if (!def || def.type !== "Tiles" || def.tilesetUid === tilesetUid) return;
    def.tilesetUid = tilesetUid;
    this.defsChanged();
  }

  // ------------------------------------------------------------------ auto-layers

  /** The IntGrid source of an auto-layer, or `undefined` for hand-painted layers. */
  autoSourceOf(def: LayerDef | undefined): LayerDef | undefined {
    if (def?.type !== "Tiles" || def.autoSourceUid === null || def.autoSourceUid === undefined) {
      return undefined;
    }
    const source = this.getLayerDef(def.autoSourceUid);
    return source?.type === "IntGrid" ? source : undefined;
  }

  isAutoLayer(def: LayerDef | undefined): boolean {
    return this.autoSourceOf(def) !== undefined;
  }

  /**
   * Turns a Tiles layer into an auto-layer fed by an IntGrid layer (or back
   * into a hand-painted layer with `null`, keeping the current tiles).
   * Switching to auto replaces painted tiles in every level.
   */
  setAutoSource(defUid: number, sourceUid: number | null): void {
    const def = this.getLayerDef(defUid);
    if (def?.type !== "Tiles") return;
    if (sourceUid !== null && this.getLayerDef(sourceUid)?.type !== "IntGrid") return;
    if ((def.autoSourceUid ?? null) === sourceUid) return;
    this.setAutoSourceInternal(def, sourceUid);
    this.regenerateAutoLayers(defUid);
    this.defsChanged();
  }

  getAutoRule(defUid: number, ruleUid: number): AutoRule | undefined {
    return this.getLayerDef(defUid)?.autoRules?.find((r) => r.uid === ruleUid);
  }

  /** Adds a rule (by default "every cell holding the source's first value") at the end. */
  addAutoRule(defUid: number, value: number | null = null): AutoRule | null {
    const def = this.getLayerDef(defUid);
    if (def?.type !== "Tiles") return null;
    const first = this.autoSourceOf(def)?.intGridValues[0]?.value ?? null;
    const rule = createRule(this.allocateUid(), value ?? first);
    def.autoRules = [...(def.autoRules ?? []), rule];
    this.autoRulesChanged(def);
    return rule;
  }

  updateAutoRule(defUid: number, ruleUid: number, patch: Partial<Omit<AutoRule, "uid">>): void {
    const def = this.getLayerDef(defUid);
    const rule = this.getAutoRule(defUid, ruleUid);
    if (!def || !rule) return;
    if (patch.size !== undefined && patch.size !== rule.size && !patch.pattern) {
      rule.pattern = resizePattern(rule.pattern, rule.size, patch.size);
    }
    Object.assign(rule, structuredClone(patch));
    rule.chance = Math.min(1, Math.max(0, rule.chance));
    this.autoRulesChanged(def);
  }

  removeAutoRule(defUid: number, ruleUid: number): void {
    const def = this.getLayerDef(defUid);
    if (!def?.autoRules) return;
    def.autoRules = def.autoRules.filter((r) => r.uid !== ruleUid);
    this.autoRulesChanged(def);
  }

  /** Copies a rule right below the original; returns the copy. */
  duplicateAutoRule(defUid: number, ruleUid: number): AutoRule | null {
    const def = this.getLayerDef(defUid);
    const index = def?.autoRules?.findIndex((r) => r.uid === ruleUid) ?? -1;
    if (!def?.autoRules || index === -1) return null;
    const copy = { ...structuredClone(def.autoRules[index]), uid: this.allocateUid() };
    def.autoRules.splice(index + 1, 0, copy);
    this.autoRulesChanged(def);
    return copy;
  }

  /** Moves a rule up (earlier, higher priority) or down. */
  moveAutoRule(defUid: number, ruleUid: number, direction: "up" | "down"): void {
    const rules = this.getLayerDef(defUid)?.autoRules;
    const from = rules?.findIndex((r) => r.uid === ruleUid) ?? -1;
    const to = direction === "up" ? from - 1 : from + 1;
    if (!rules || from === -1 || to < 0 || to >= rules.length) return;
    const [rule] = rules.splice(from, 1);
    rules.splice(to, 0, rule);
    this.autoRulesChanged(this.getLayerDef(defUid)!);
  }

  /** New random choices for tile variants and chances. */
  reshuffleAutoLayer(defUid: number): void {
    const def = this.getLayerDef(defUid);
    if (!def) return;
    def.autoSeed = ((def.autoSeed ?? 0) + 0x9e3779b9) >>> 0;
    this.autoRulesChanged(def);
  }

  /**
   * Recomputes auto-layer tiles from their sources. Without arguments every
   * auto-layer in every level is rebuilt. Unchanged layers are left alone.
   */
  regenerateAutoLayers(defUid?: number, level?: Level): void {
    const defs = this.defs.layers.filter(
      (d) => (defUid === undefined || d.uid === defUid) && this.isAutoLayer(d)
    );
    for (const target of level ? [level] : this.levels) {
      for (const def of defs) {
        const source = target.doc.getLayer(layerIdFor(def.autoSourceUid!));
        const layer = target.doc.getLayer(layerIdFor(def.uid));
        if (!source || !layer) continue;
        const tiles = generateAutoTiles(
          source.data,
          target.width,
          target.height,
          def.autoRules ?? [],
          def.autoSeed ?? 0
        );
        if (sameCells(tiles, layer.data)) continue;
        layer.data.set(tiles);
        layer.version++;
        target.doc.notifyCellsChanged(layer.id);
      }
    }
  }

  /** Runs regenerations queued by source edits now (tests, exports). */
  flushAutoLayers(): void {
    this.regenQueued = false;
    const levels = [...this.pendingRegen];
    this.pendingRegen.clear();
    for (const level of levels) {
      if (this.getLevel(level.uid) === level) this.regenerateAutoLayers(undefined, level);
    }
  }

  /** Regenerates a level's auto-layers when one of their sources changes (coalesced). */
  private watchLevel(level: Level): void {
    this.watchers.get(level.uid)?.();
    const queue = () => {
      this.pendingRegen.add(level);
      if (this.regenQueued) return;
      this.regenQueued = true;
      queueMicrotask(() => this.flushAutoLayers());
    };
    const offCells = level.doc.events.on("cells:changed", ({ layerId }) => {
      const uid = defUidOf(layerId);
      if (uid !== null && this.defs.layers.some((d) => d.autoSourceUid === uid)) queue();
    });
    const offResize = level.doc.events.on("resized", queue);
    this.watchers.set(level.uid, () => {
      offCells();
      offResize();
    });
    this.applyAutoLocks(level);
  }

  /** Auto-layers are locked so the grid tools leave them alone (hand locks are kept). */
  private applyAutoLocks(level: Level): void {
    for (const def of this.defs.layers) {
      const layer = level.doc.getLayer(layerIdFor(def.uid));
      if (layer && this.isAutoLayer(def)) layer.locked = true;
    }
  }

  private setAutoSourceInternal(def: LayerDef, sourceUid: number | null): void {
    const wasAuto = this.isAutoLayer(def);
    def.autoSourceUid = sourceUid;
    def.autoRules ??= [];
    for (const level of this.levels) {
      // A layer that stops being generated becomes paintable again.
      const layer = level.doc.getLayer(layerIdFor(def.uid));
      if (layer && wasAuto && !this.isAutoLayer(def)) layer.locked = false;
      this.applyAutoLocks(level);
    }
  }

  private autoRulesChanged(def: LayerDef): void {
    this.regenerateAutoLayers(def.uid);
    this.defsChanged();
  }

  // ------------------------------------------------------------------ tilesets

  getTileset(uid: number | null | undefined): TilesetDef | undefined {
    return uid === null || uid === undefined
      ? undefined
      : this.defs.tilesets.find((t) => t.uid === uid);
  }

  /** Tileset used by a document layer, if it is a Tiles layer with one assigned. */
  tilesetForLayer(layerId: string): TilesetDef | undefined {
    const def = this.getLayerDefForLayer(layerId);
    return def?.type === "Tiles" ? this.getTileset(def.tilesetUid) : undefined;
  }

  addTileset(tileset: Omit<TilesetDef, "uid">): TilesetDef {
    const taken = new Set(this.defs.tilesets.map((t) => t.identifier));
    let identifier = tileset.identifier || "tileset";
    for (let n = 2; taken.has(identifier); n++) identifier = `${tileset.identifier}_${n}`;
    const def: TilesetDef = { ...tileset, identifier, uid: this.allocateUid() };
    this.defs.tilesets.push(def);
    this.defsChanged();
    return def;
  }

  updateTileset(uid: number, patch: Partial<Omit<TilesetDef, "uid">>): void {
    const tileset = this.getTileset(uid);
    if (!tileset) return;
    Object.assign(tileset, patch);
    if (patch.tileSize !== undefined) tileset.tileSize = Math.max(1, Math.round(tileset.tileSize));
    if (patch.spacing !== undefined) tileset.spacing = Math.max(0, Math.round(tileset.spacing));
    if (patch.padding !== undefined) tileset.padding = Math.max(0, Math.round(tileset.padding));
    this.defsChanged();
  }

  /** Removes a tileset; layers using it keep their data but lose the binding. */
  removeTileset(uid: number): void {
    const index = this.defs.tilesets.findIndex((t) => t.uid === uid);
    if (index === -1) return;
    this.defs.tilesets.splice(index, 1);
    for (const def of this.defs.layers) {
      if (def.tilesetUid === uid) def.tilesetUid = null;
    }
    for (const entity of this.defs.entities) {
      if (entity.tile?.tilesetUid === uid) {
        entity.tile = null;
        if (entity.shape === "tile") entity.shape = "rectangle";
      }
    }
    this.tilesetImages.delete(uid);
    this.defsChanged();
  }

  /**
   * Decoded image for a tileset, or `undefined` while it is still loading.
   * Emits "tilesets:loaded" once it is ready so views can redraw.
   */
  getTilesetImage(tileset: TilesetDef): HTMLImageElement | undefined {
    const cached = this.tilesetImages.get(tileset.uid);
    if (cached && cached.src === tileset.image.dataUrl)
      return cached.ready ? cached.image : undefined;
    if (typeof Image === "undefined") return undefined;
    const image = new Image();
    const entry = { src: tileset.image.dataUrl, image, ready: false };
    this.tilesetImages.set(tileset.uid, entry);
    image.onload = () => {
      entry.ready = true;
      this.events.emit("tilesets:loaded");
    };
    image.src = tileset.image.dataUrl;
    return undefined;
  }

  /** Removes a definition and its data from every level. */
  removeLayerDef(uid: number): boolean {
    const index = this.defs.layers.findIndex((d) => d.uid === uid);
    if (index === -1 || this.defs.layers.length <= 1) return false;
    for (const def of this.defs.layers) {
      // Auto-layers fed by the removed layer keep their tiles and become manual.
      if (def.autoSourceUid === uid) this.setAutoSourceInternal(def, null);
    }
    const [removed] = this.defs.layers.splice(index, 1);
    for (const level of this.levels) {
      level.doc.removeLayer(layerIdFor(uid));
      if (removed.type === "Entities") {
        this.dropEntities(level, (e) => e.layerUid === uid);
      }
    }
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

  // ------------------------------------------------------------------ entity defs

  getEntityDef(uid: number): EntityDef | undefined {
    return this.defs.entities.find((d) => d.uid === uid);
  }

  getEnum(uid: number | null | undefined): EnumDef | undefined {
    return uid === null || uid === undefined
      ? undefined
      : this.defs.enums.find((e) => e.uid === uid);
  }

  addEntityDef(identifier = "Entity", patch: Partial<Omit<EntityDef, "uid">> = {}): EntityDef {
    const def: EntityDef = {
      identifier: "",
      color: DEFAULT_COLORS[this.defs.entities.length % DEFAULT_COLORS.length],
      width: this.gridSize,
      height: this.gridSize,
      pivotX: 0.5,
      pivotY: 0.5,
      shape: "rectangle",
      tile: null,
      maxPerLevel: 0,
      fields: [],
      ...structuredClone(patch),
      uid: this.allocateUid(),
    };
    def.identifier = this.uniqueName(
      this.defs.entities.map((d) => d.identifier),
      identifier
    );
    for (const field of def.fields) this.reserveUid(field.uid);
    this.defs.entities.push(def);
    this.defsChanged();
    return def;
  }

  updateEntityDef(uid: number, patch: Partial<Omit<EntityDef, "uid" | "fields">>): void {
    const def = this.getEntityDef(uid);
    if (!def) return;
    const { identifier, ...rest } = patch;
    Object.assign(def, rest);
    if (identifier !== undefined && identifier.trim()) {
      def.identifier = this.uniqueName(
        this.defs.entities.filter((d) => d.uid !== uid).map((d) => d.identifier),
        identifier.trim()
      );
    }
    def.width = Math.max(1, Math.round(def.width));
    def.height = Math.max(1, Math.round(def.height));
    def.pivotX = Math.min(1, Math.max(0, def.pivotX));
    def.pivotY = Math.min(1, Math.max(0, def.pivotY));
    def.maxPerLevel = Math.max(0, Math.round(def.maxPerLevel));
    this.defsChanged();
  }

  /** Removes an entity definition and all its instances (not undoable). */
  removeEntityDef(uid: number): void {
    const index = this.defs.entities.findIndex((d) => d.uid === uid);
    if (index === -1) return;
    this.defs.entities.splice(index, 1);
    for (const level of this.levels) this.dropEntities(level, (e) => e.defUid === uid);
    this.defsChanged();
  }

  /** Number of instances of a definition (in one level, or in the project). */
  countEntities(defUid: number, level?: Level): number {
    const levels = level ? [level] : this.levels;
    return levels.reduce((n, l) => n + l.entities.filter((e) => e.defUid === defUid).length, 0);
  }

  addField(entityUid: number, type: FieldType, identifier = type.toLowerCase()): FieldDef | null {
    const def = this.getEntityDef(entityUid);
    if (!def) return null;
    const enumDef = type === "Enum" ? this.defs.enums[0] : undefined;
    const field: FieldDef = {
      uid: this.allocateUid(),
      identifier: this.uniqueName(
        def.fields.map((f) => f.identifier),
        identifier
      ),
      type,
      defaultValue: initialDefault(type, enumDef),
      ...(type === "Enum" ? { enumUid: enumDef?.uid ?? null } : {}),
      ...(type === "Int" || type === "Float" ? { min: null, max: null } : {}),
    };
    def.fields.push(field);
    this.defsChanged();
    return field;
  }

  /**
   * Updates a field definition. Stored values that are no longer valid (an
   * enum change, a new min/max) are dropped or clamped.
   */
  updateField(
    entityUid: number,
    fieldUid: number,
    patch: Partial<Omit<FieldDef, "uid" | "type">>
  ): void {
    const def = this.getEntityDef(entityUid);
    const field = def?.fields.find((f) => f.uid === fieldUid);
    if (!field || !def) return;
    const { identifier, ...rest } = patch;
    Object.assign(field, rest);
    if (identifier !== undefined && identifier.trim()) {
      field.identifier = this.uniqueName(
        def.fields.filter((f) => f.uid !== fieldUid).map((f) => f.identifier),
        identifier.trim()
      );
    }
    if ("enumUid" in patch && !("defaultValue" in patch)) {
      field.defaultValue = initialDefault("Enum", this.getEnum(field.enumUid));
    }
    const valid = validateFieldValue(field, field.defaultValue, this.defs.enums);
    field.defaultValue = valid === undefined ? initialDefault(field.type) : valid;
    this.pruneFieldValues(entityUid, field);
    this.defsChanged();
  }

  removeField(entityUid: number, fieldUid: number): void {
    const def = this.getEntityDef(entityUid);
    if (!def) return;
    def.fields = def.fields.filter((f) => f.uid !== fieldUid);
    for (const level of this.levels) {
      for (const e of level.entities) {
        if (e.defUid === entityUid) delete e.fields[String(fieldUid)];
      }
    }
    this.defsChanged();
  }

  // ------------------------------------------------------------------ enums

  addEnum(identifier = "Enum"): EnumDef {
    const def: EnumDef = {
      uid: this.allocateUid(),
      identifier: this.uniqueName(
        this.defs.enums.map((e) => e.identifier),
        identifier
      ),
      values: [],
    };
    this.defs.enums.push(def);
    this.defsChanged();
    return def;
  }

  renameEnum(uid: number, identifier: string): void {
    const def = this.getEnum(uid);
    if (!def || !identifier.trim()) return;
    def.identifier = this.uniqueName(
      this.defs.enums.filter((e) => e.uid !== uid).map((e) => e.identifier),
      identifier.trim()
    );
    this.defsChanged();
  }

  /** Removes an enum; fields using it become unbound and lose their values. */
  removeEnum(uid: number): void {
    const index = this.defs.enums.findIndex((e) => e.uid === uid);
    if (index === -1) return;
    this.defs.enums.splice(index, 1);
    for (const def of this.defs.entities) {
      for (const field of def.fields) {
        if (field.type === "Enum" && field.enumUid === uid) {
          field.enumUid = null;
          field.defaultValue = null;
          this.pruneFieldValues(def.uid, field);
        }
      }
    }
    this.defsChanged();
  }

  addEnumValue(uid: number, id?: string): void {
    const def = this.getEnum(uid);
    if (!def) return;
    def.values.push({
      id: this.uniqueName(
        def.values.map((v) => v.id),
        id ?? `value_${def.values.length + 1}`
      ),
      color: DEFAULT_COLORS[def.values.length % DEFAULT_COLORS.length],
    });
    this.defsChanged();
  }

  /** Renames or recolours an enum value; a rename carries over to stored values. */
  updateEnumValue(uid: number, id: string, patch: { id?: string; color?: string }): void {
    const def = this.getEnum(uid);
    const entry = def?.values.find((v) => v.id === id);
    if (!def || !entry) return;
    if (patch.color) entry.color = patch.color;
    const nextId = patch.id?.trim();
    if (nextId && nextId !== id) {
      entry.id = this.uniqueName(
        def.values.filter((v) => v !== entry).map((v) => v.id),
        nextId
      );
      this.forEachEnumField(uid, (field, entity) => {
        if (field.defaultValue === id) field.defaultValue = entry.id;
        for (const level of this.levels) {
          for (const e of level.entities) {
            if (e.defUid === entity.uid && e.fields[String(field.uid)] === id) {
              e.fields[String(field.uid)] = entry.id;
            }
          }
        }
      });
    }
    this.defsChanged();
  }

  /** Removes an enum value; instances using it fall back to the field default. */
  removeEnumValue(uid: number, id: string): void {
    const def = this.getEnum(uid);
    if (!def) return;
    def.values = def.values.filter((v) => v.id !== id);
    this.forEachEnumField(uid, (field, entity) => {
      if (field.defaultValue === id) field.defaultValue = def.values[0]?.id ?? null;
      this.pruneFieldValues(entity.uid, field);
    });
    this.defsChanged();
  }

  // ------------------------------------------------------------------ entity instances
  // Low-level mutations; the entity commands wrap them as undo steps.

  insertEntity(level: Level, instance: EntityInstance, index = level.entities.length): void {
    level.entities.splice(Math.max(0, Math.min(index, level.entities.length)), 0, instance);
    this.events.emit("entities:changed", level.uid);
  }

  /** Removes an instance; returns its old index, or -1. */
  removeEntity(level: Level, iid: string): number {
    const index = level.entities.findIndex((e) => e.iid === iid);
    if (index === -1) return -1;
    level.entities.splice(index, 1);
    this.events.emit("entities:changed", level.uid);
    return index;
  }

  /** Replaces an instance's state (position and fields) with a copy of `next`. */
  replaceEntity(level: Level, next: EntityInstance): void {
    const index = level.entities.findIndex((e) => e.iid === next.iid);
    if (index === -1) return;
    level.entities[index] = cloneInstance(next);
    this.events.emit("entities:changed", level.uid);
  }

  /** Moves every instance of a level by whole cells (used by edge resizes). */
  shiftEntities(level: Level, cellsX: number, cellsY: number): void {
    if (cellsX === 0 && cellsY === 0) return;
    for (const e of level.entities) {
      e.x += cellsX * this.gridSize;
      e.y += cellsY * this.gridSize;
      for (const field of this.getEntityDef(e.defUid)?.fields ?? []) {
        const value = e.fields[String(field.uid)];
        if (field.type === "Point" && value && typeof value === "object") {
          e.fields[String(field.uid)] = { x: value.x + cellsX, y: value.y + cellsY };
        }
      }
    }
    this.events.emit("entities:changed", level.uid);
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

  private uniqueName(taken: readonly string[], base: string): string {
    const set = new Set(taken);
    if (!set.has(base)) return base;
    let n = 2;
    while (set.has(`${base}_${n}`)) n++;
    return `${base}_${n}`;
  }

  private dropEntities(level: Level, predicate: (e: EntityInstance) => boolean): void {
    const before = level.entities.length;
    level.entities = level.entities.filter((e) => !predicate(e));
    if (level.entities.length !== before) this.events.emit("entities:changed", level.uid);
  }

  /** Drops stored values of `field` that are no longer valid. */
  private pruneFieldValues(entityUid: number, field: FieldDef): void {
    const key = String(field.uid);
    for (const level of this.levels) {
      for (const e of level.entities) {
        if (e.defUid !== entityUid || !(key in e.fields)) continue;
        const valid = validateFieldValue(field, e.fields[key], this.defs.enums);
        if (valid === undefined) delete e.fields[key];
        else e.fields[key] = valid;
      }
    }
  }

  private forEachEnumField(enumUid: number, fn: (field: FieldDef, entity: EntityDef) => void) {
    for (const entity of this.defs.entities) {
      for (const field of entity.fields) {
        if (field.type === "Enum" && field.enumUid === enumUid) fn(field, entity);
      }
    }
  }

  private defsChanged(): void {
    this.colorizers.clear();
    this.paletteVersion++;
    this.events.emit("defs:changed");
  }
}

function sameCells(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
