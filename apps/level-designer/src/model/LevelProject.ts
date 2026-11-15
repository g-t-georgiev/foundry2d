import {
  EventEmitter,
  GridDocument,
  unionRects,
  PixelUtils,
  type Position,
  type Rect,
  type Unsubscribe,
} from "@foundry2d/core";
import {
  autoRuleReach,
  createRule,
  generateAutoTilesInto,
  orderedRules,
  resizePattern,
  type AutoRule,
  type AutoRuleGroup,
  type AutoStack,
} from "./autoRules";
import type { CellColorizer } from "@foundry2d/render";
import type {
  EntityDef,
  EntityInstance,
  EnumDef,
  FieldDef,
  FieldType,
  FieldValue,
  EntityRef,
  IntGridValueDef,
  LayerDef,
  ProjectDefs,
  TilesetDef,
  WorldLayout,
} from "./types";
import {
  cloneInstance,
  defaultFor,
  initialDefault,
  isEntityRef,
  isPoint,
  mapScalars,
  newIid,
  validateFieldValue,
  valueList,
} from "./entities";

/** IntGrid cells use 0 for "empty", like LDtk. */
export const EMPTY_CELL = 0;

export type LevelDocument = GridDocument<Int32Array>;

/** Who a field belongs to: an entity type (its uid) or levels. */
type FieldOwner = number | "level";

/** One layer of a level in a definition snapshot. */
interface LayerSnapshot {
  name: string;
  visible: boolean;
  opacity: number;
  locked: boolean;
  /** Cell size in level cells, and the size in cells it gives (see `layerScale`). */
  scale: number;
  width: number;
  height: number;
  /** Never mutated after capture, so snapshots can share it. */
  data: Int32Array;
}

interface LevelDefinitionSnapshot {
  order: string[];
  layers: Map<string, LayerSnapshot>;
  activeLayerId: string | null;
  entities: EntityInstance[];
  fields: Record<string, FieldValue>;
}

/** Everything a definition edit can change (see `LevelProject.snapshotDefinitions`). */
export interface DefinitionSnapshot {
  defs: ProjectDefs;
  gridSize: number;
  defaultLevelBg: string;
  levels: Map<number, LevelDefinitionSnapshot>;
}

export class Level {
  /** Placed entities on every Entities layer, in draw order. */
  public entities: EntityInstance[] = [];
  /**
   * Auto-layer cells with stacked or offset tiles, by document layer id.
   * Derived from the rules on every regeneration; never saved.
   */
  public readonly autoStacks = new Map<string, AutoStack>();
  /** Background colour (`#rrggbb`); `null` uses the project default. */
  public bgColor: string | null = null;
  /** Values of the project's level fields, by field uid (missing = default). */
  public fields: Record<string, FieldValue> = {};

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
  /** Definitions were put back by undo or redo (dialogs showing them should refresh). */
  "defs:restored": () => void;
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
  public readonly defs: ProjectDefs = {
    layers: [],
    tilesets: [],
    entities: [],
    enums: [],
    levelFields: [],
  };
  /** Background of levels without their own colour (world view, thumbnails, game export). */
  public defaultLevelBg = "#18181c";
  public readonly levels: Level[] = [];
  /** Bumped whenever colors change so cached layer bitmaps are refreshed. */
  public paletteVersion = 0;
  /** How levels are arranged in the world view. */
  public worldLayout: WorldLayout = "free";
  /** Save work files packaged: a ZIP with the tileset images as files (see io/packagedFile). */
  public packaged = false;
  /** World grid cell in pixels; levels snap to it in the "gridvania" layout. */
  public worldGrid = { width: 256, height: 256 };
  private nextUid = 1;
  /** Source-layer watchers per level uid (auto-layer regeneration). */
  private watchers = new Map<number, Unsubscribe>();
  /** Levels waiting for auto-layer updates, with the area to redo (`null` = all). */
  private pendingRegen = new Map<Level, Rect | null>();
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
    for (const def of this.defs.layers) {
      if (def.gridSize === next) delete def.gridSize;
    }
    this.syncLayerScales(false);
    this.definitionVersion++;
    this.events.emit("settings:changed");
  }

  /**
   * World rectangle of a level layer whose top-left corner is at `origin`.
   * Layers with their own grid can be a little bigger than the level (their
   * last cells stick out when the sizes don't divide); callers clip.
   */
  layerRect(layer: { width: number; height: number; scale: number }, origin: Position): Rect {
    const cell = this.gridSize * layer.scale;
    return { x: origin.x, y: origin.y, width: layer.width * cell, height: layer.height * cell };
  }

  /** Cell size in pixels of a layer (its own grid, else the project's). */
  layerGridSize(def: LayerDef | undefined): number {
    return def?.gridSize ?? this.gridSize;
  }

  /** Cell size of a layer in level cells (1 unless the layer has its own grid). */
  layerScale(def: LayerDef | undefined): number {
    return this.layerGridSize(def) / this.gridSize;
  }

  /**
   * Gives a layer its own grid (`null`: the project grid). Existing cells are
   * resampled to the new size; the layer's auto-layers follow it.
   */
  setLayerGridSize(uid: number, size: number | null): void {
    const def = this.getLayerDef(uid);
    if (!def || this.isAutoLayer(def)) return;
    const next = size === null ? this.gridSize : Math.max(1, Math.round(size));
    if (next === this.layerGridSize(def)) return;
    const targets = [def, ...this.defs.layers.filter((d) => d.autoSourceUid === uid)];
    for (const target of targets) {
      if (next === this.gridSize) delete target.gridSize;
      else target.gridSize = next;
    }
    this.syncLayerScales(true);
    for (const target of targets) if (target !== def) this.regenerateAutoLayers(target.uid);
    this.defsChanged();
  }

  /** Sets a layer's guide grid in pixels (`null` removes it). Display only. */
  setLayerGuideGrid(uid: number, size: { width: number; height: number } | null): void {
    const def = this.getLayerDef(uid);
    if (!def) return;
    const next =
      size && size.width >= 1 && size.height >= 1
        ? { width: Math.round(size.width), height: Math.round(size.height) }
        : undefined;
    if (JSON.stringify(next) === JSON.stringify(def.guideGrid)) return;
    if (next) def.guideGrid = next;
    else delete def.guideGrid;
    this.defsChanged();
  }

  /** Brings every level layer to its definition's scale. */
  private syncLayerScales(resample: boolean): void {
    for (const level of this.levels) {
      for (const def of this.defs.layers) {
        level.doc.setLayerScale(layerIdFor(def.uid), this.layerScale(def), resample);
      }
    }
  }

  /** Switches between plain JSON and packaged (ZIP) work files. */
  setPackaged(packaged: boolean): void {
    if (packaged === this.packaged) return;
    this.packaged = packaged;
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
      doc.addLayer({
        id: layerIdFor(def.uid),
        name: def.identifier,
        scale: this.layerScale(def),
        activate: false,
      });
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
        scale: layer.scale,
        data: layer.data,
        activate: false,
      });
    }
    doc.setActiveLayer(source.doc.activeLayerId);
    const identifier = this.uniqueLevelIdentifier(`${source.identifier}_copy`);
    const copy = new Level(this.allocateUid(), identifier, worldX, worldY, doc);
    const iids = new Map<string, string>();
    copy.entities = source.entities.map((e) => {
      const clone = cloneInstance(e, newIid());
      iids.set(e.iid, clone.iid);
      return clone;
    });
    copy.bgColor = source.bgColor;
    copy.fields = structuredClone(source.fields);
    // References between entities of the source level point inside the copy.
    const remap = (fields: Record<string, FieldValue>) => {
      for (const key of Object.keys(fields)) {
        fields[key] = mapScalars(fields[key], (v) =>
          isEntityRef(v) && v.levelUid === source.uid && iids.has(v.entityIid)
            ? { entityIid: iids.get(v.entityIid)!, levelUid: copy.uid }
            : v
        );
      }
    };
    for (const e of copy.entities) remap(e.fields);
    remap(copy.fields);
    this.regenerateAutoLayers(undefined, copy); // rebuilds the derived tile stacks
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
      level.doc.addLayer({
        id: layerIdFor(def.uid),
        name: def.identifier,
        scale: this.layerScale(def),
        activate: false,
      });
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
      level.doc.addLayer({
        id: layerIdFor(def.uid),
        name: def.identifier,
        scale: this.layerScale(def),
        activate: false,
      });
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
      level.doc.addLayer({
        id: layerIdFor(def.uid),
        name: def.identifier,
        scale: this.layerScale(def),
        activate: false,
      });
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
    const def = this.getLayerDef(defUid);
    const rules = def?.autoRules;
    const from = rules?.findIndex((r) => r.uid === ruleUid) ?? -1;
    if (!def || !rules || from === -1) return;
    // Rules are listed by group, so the neighbour is the next rule of the same group.
    const group = this.groupOf(def, rules[from]);
    const step = direction === "up" ? -1 : 1;
    let to = from + step;
    while (to >= 0 && to < rules.length && this.groupOf(def, rules[to]) !== group) to += step;
    if (to < 0 || to >= rules.length) return;
    [rules[from], rules[to]] = [rules[to], rules[from]];
    this.autoRulesChanged(def);
  }

  /** The group a rule is listed in (`null`: ungrouped or an unknown group). */
  private groupOf(def: LayerDef, rule: AutoRule): number | null {
    const uid = rule.groupUid ?? null;
    return uid !== null && def.autoGroups?.some((g) => g.uid === uid) ? uid : null;
  }

  /** Adds a rule group at the end; new rules can then be put in it. */
  addAutoGroup(defUid: number, name = "Group"): AutoRuleGroup | null {
    const def = this.getLayerDef(defUid);
    if (def?.type !== "Tiles") return null;
    const groups = (def.autoGroups ??= []);
    const group: AutoRuleGroup = {
      uid: this.allocateUid(),
      name: this.uniqueName(
        groups.map((g) => g.name),
        name
      ),
      active: true,
    };
    groups.push(group);
    this.autoRulesChanged(def);
    return group;
  }

  updateAutoGroup(
    defUid: number,
    groupUid: number,
    patch: Partial<Omit<AutoRuleGroup, "uid">>
  ): void {
    const def = this.getLayerDef(defUid);
    const group = def?.autoGroups?.find((g) => g.uid === groupUid);
    if (!def || !group) return;
    Object.assign(group, patch);
    group.name = group.name.trim() || "Group";
    this.autoRulesChanged(def);
  }

  /** Removes a group; its rules stay, ungrouped. */
  removeAutoGroup(defUid: number, groupUid: number): void {
    const def = this.getLayerDef(defUid);
    if (!def?.autoGroups?.some((g) => g.uid === groupUid)) return;
    def.autoGroups = def.autoGroups.filter((g) => g.uid !== groupUid);
    for (const rule of def.autoRules ?? []) if (rule.groupUid === groupUid) rule.groupUid = null;
    this.autoRulesChanged(def);
  }

  /** Moves a group up (earlier, higher priority) or down. */
  moveAutoGroup(defUid: number, groupUid: number, direction: "up" | "down"): void {
    const def = this.getLayerDef(defUid);
    const groups = def?.autoGroups;
    const from = groups?.findIndex((g) => g.uid === groupUid) ?? -1;
    const to = direction === "up" ? from - 1 : from + 1;
    if (!def || !groups || from === -1 || to < 0 || to >= groups.length) return;
    const [group] = groups.splice(from, 1);
    groups.splice(to, 0, group);
    this.autoRulesChanged(def);
  }

  /** Rules in evaluation order (ungrouped first, then by group), groups applied. */
  orderedAutoRules(def: LayerDef): AutoRule[] {
    return orderedRules(def.autoRules ?? [], def.autoGroups);
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
  regenerateAutoLayers(defUid?: number, level?: Level, area?: Rect): void {
    const defs = this.defs.layers.filter(
      (d) => (defUid === undefined || d.uid === defUid) && this.isAutoLayer(d)
    );
    for (const target of level ? [level] : this.levels) {
      for (const def of defs) {
        const source = target.doc.getLayer(layerIdFor(def.autoSourceUid!));
        const layer = target.doc.getLayer(layerIdFor(def.uid));
        if (!source || !layer) continue;
        const rules = orderedRules(def.autoRules ?? [], def.autoGroups);
        let stack = target.autoStacks.get(layer.id);
        if (!stack) {
          stack = new Map();
          target.autoStacks.set(layer.id, stack);
        }
        // A full rebuild drops entries of cells that no longer exist (resizes).
        if (!area) stack.clear();
        // A cell's tile depends on neighbours up to the rules' reach.
        const reach = autoRuleReach(rules);
        const region = area && {
          x: area.x - reach,
          y: area.y - reach,
          width: area.width + reach * 2,
          height: area.height + reach * 2,
        };
        // Auto-layers share their source's grid, so its size in cells.
        const changed = generateAutoTilesInto(
          layer.data,
          source.data,
          source.width,
          source.height,
          rules,
          def.autoSeed ?? 0,
          region,
          stack
        );
        if (!changed) continue;
        layer.version++;
        target.doc.notifyCellsChanged(layer.id, region);
      }
    }
  }

  /** Runs regenerations queued by source edits now (tests, exports). */
  flushAutoLayers(): void {
    this.regenQueued = false;
    const pending = [...this.pendingRegen];
    this.pendingRegen.clear();
    for (const [level, area] of pending) {
      if (this.getLevel(level.uid) === level) {
        this.regenerateAutoLayers(undefined, level, area ?? undefined);
      }
    }
  }

  /** Regenerates a level's auto-layers when one of their sources changes (coalesced). */
  private watchLevel(level: Level): void {
    this.watchers.get(level.uid)?.();
    // Edits in one burst are merged into one area; an edit without an area
    // (or a resize) means the whole level.
    const queue = (rect?: Rect) => {
      const known = this.pendingRegen.has(level);
      const previous = this.pendingRegen.get(level);
      const merged =
        !rect || (known && previous === null) ? null : unionRects(previous ?? undefined, rect)!;
      this.pendingRegen.set(level, merged);
      if (this.regenQueued) return;
      this.regenQueued = true;
      queueMicrotask(() => this.flushAutoLayers());
    };
    const offCells = level.doc.events.on("cells:changed", ({ layerId, rect }) => {
      const uid = defUidOf(layerId);
      if (uid !== null && this.defs.layers.some((d) => d.autoSourceUid === uid)) queue(rect);
    });
    const offResize = level.doc.events.on("resized", () => queue());
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
    const source = this.autoSourceOf(def);
    if (source && this.layerGridSize(source) !== this.layerGridSize(def)) {
      if (source.gridSize === undefined) delete def.gridSize;
      else def.gridSize = source.gridSize;
      this.syncLayerScales(false);
    }
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

  /**
   * Copies a layer definition and its data in every level (cells, entity
   * instances with new ids, auto-layer rules), placed directly above the
   * original. Returns the copy.
   */
  duplicateLayerDef(uid: number): LayerDef | null {
    const source = this.getLayerDef(uid);
    if (!source) return null;
    const copy: LayerDef = {
      ...structuredClone(source),
      uid: this.allocateUid(),
      identifier: this.uniqueIdentifier(`${source.identifier}_copy`),
    };
    for (const rule of copy.autoRules ?? []) rule.uid = this.allocateUid();
    this.defs.layers.splice(this.defs.layers.indexOf(source) + 1, 0, copy);
    for (const level of this.levels) {
      const original = level.doc.getLayer(layerIdFor(uid));
      const index = level.doc.layers.findIndex((l) => l.id === layerIdFor(uid));
      level.doc.addLayer({
        id: layerIdFor(copy.uid),
        name: copy.identifier,
        visible: original?.visible ?? true,
        opacity: original?.opacity ?? 1,
        locked: this.isAutoLayer(copy) || (original?.locked ?? false),
        scale: this.layerScale(copy),
        data: original?.data,
        activate: false,
      });
      // addLayer appends on top; move the copy right above the original.
      const from = level.doc.layers.length - 1;
      if (index !== -1 && from !== index + 1) level.doc.moveLayer(from, index + 1);
      if (source.type === "Entities") {
        const copies = level.entities
          .filter((e) => e.layerUid === uid)
          .map((e) => ({ ...cloneInstance(e, newIid()), layerUid: copy.uid }));
        if (copies.length) {
          level.entities.push(...copies);
          this.events.emit("entities:changed", level.uid);
        }
      }
    }
    this.defsChanged();
    return copy;
  }

  /** Moves a definition to sit directly above `anchorUid` (used when adding layers). */
  placeLayerDefAbove(uid: number, anchorUid: number): void {
    const target = this.defs.layers.findIndex((d) => d.uid === anchorUid) + 1;
    if (target <= 0) return;
    let index = this.defs.layers.findIndex((d) => d.uid === uid);
    while (index > target && this.moveLayerDef(uid, "down")) index--;
    while (index !== -1 && index < target - 1 && this.moveLayerDef(uid, "up")) index++;
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
    for (const fields of [this.defs.levelFields, ...this.defs.entities.map((d) => d.fields)]) {
      for (const field of fields) if (field.refDefUid === uid) field.refDefUid = null;
    }
    this.defsChanged();
  }

  /** Number of instances of a definition (in one level, or in the project). */
  countEntities(defUid: number, level?: Level): number {
    const levels = level ? [level] : this.levels;
    return levels.reduce((n, l) => n + l.entities.filter((e) => e.defUid === defUid).length, 0);
  }

  addField(entityUid: number, type: FieldType, identifier = type.toLowerCase()): FieldDef | null {
    return this.addFieldTo(entityUid, type, identifier);
  }

  updateField(
    entityUid: number,
    fieldUid: number,
    patch: Partial<Omit<FieldDef, "uid" | "type">>
  ): void {
    this.updateFieldOf(entityUid, fieldUid, patch);
  }

  removeField(entityUid: number, fieldUid: number): void {
    this.removeFieldOf(entityUid, fieldUid);
  }

  // ------------------------------------------------------------------ levels: fields and background

  addLevelField(type: FieldType, identifier = type.toLowerCase()): FieldDef | null {
    return this.addFieldTo("level", type, identifier);
  }

  updateLevelField(fieldUid: number, patch: Partial<Omit<FieldDef, "uid" | "type">>): void {
    this.updateFieldOf("level", fieldUid, patch);
  }

  removeLevelField(fieldUid: number): void {
    this.removeFieldOf("level", fieldUid);
  }

  setDefaultLevelBg(color: string): void {
    if (!/^#[0-9a-f]{6}$/i.test(color) || color === this.defaultLevelBg) return;
    this.defaultLevelBg = color.toLowerCase();
    this.defsChanged();
    this.events.emit("levels:changed");
  }

  /** The colour a level is drawn on: its own, or the project default. */
  levelBackground(level: Level): string {
    return level.bgColor ?? this.defaultLevelBg;
  }

  /** Sets a level's background and/or field values (see `SetLevelPropertiesCommand`). */
  setLevelProperties(
    level: Level,
    props: { bgColor?: string | null; fields?: Record<string, FieldValue> }
  ): void {
    if (props.bgColor !== undefined) level.bgColor = props.bgColor;
    if (props.fields !== undefined) level.fields = structuredClone(props.fields);
    this.events.emit("levels:changed");
  }

  // ------------------------------------------------------------------ fields (shared)

  /** Field definitions of an entity type, or of levels. */
  private fieldsOf(owner: FieldOwner): FieldDef[] | undefined {
    return owner === "level" ? this.defs.levelFields : this.getEntityDef(owner)?.fields;
  }

  /** Everything that stores values for an owner's fields. */
  private holdersOf(owner: FieldOwner): { fields: Record<string, FieldValue> }[] {
    return owner === "level"
      ? this.levels
      : this.levels.flatMap((l) => l.entities.filter((e) => e.defUid === owner));
  }

  private addFieldTo(owner: FieldOwner, type: FieldType, identifier: string): FieldDef | null {
    const fields = this.fieldsOf(owner);
    if (!fields) return null;
    const enumDef = type === "Enum" ? this.defs.enums[0] : undefined;
    const field: FieldDef = {
      uid: this.allocateUid(),
      identifier: this.uniqueName(
        fields.map((f) => f.identifier),
        identifier
      ),
      type,
      defaultValue: initialDefault(type, enumDef),
      ...(type === "Enum" ? { enumUid: enumDef?.uid ?? null } : {}),
      ...(type === "Int" || type === "Float" ? { min: null, max: null } : {}),
      ...(type === "EntityRef" ? { refDefUid: null } : {}),
    };
    fields.push(field);
    this.defsChanged();
    return field;
  }

  /**
   * Updates a field definition. Stored values that are no longer valid (an
   * enum change, a new min/max) are dropped or clamped.
   */
  private updateFieldOf(
    owner: FieldOwner,
    fieldUid: number,
    patch: Partial<Omit<FieldDef, "uid" | "type">>
  ): void {
    const fields = this.fieldsOf(owner);
    const field = fields?.find((f) => f.uid === fieldUid);
    if (!field || !fields) return;
    const { identifier, ...rest } = patch;
    const wasArray = field.isArray === true;
    Object.assign(field, rest);
    if ("isArray" in patch && wasArray !== (field.isArray === true)) {
      this.convertArrayValues(owner, field);
    }
    if (identifier !== undefined && identifier.trim()) {
      field.identifier = this.uniqueName(
        fields.filter((f) => f.uid !== fieldUid).map((f) => f.identifier),
        identifier.trim()
      );
    }
    if ("enumUid" in patch && !("defaultValue" in patch)) {
      field.defaultValue = initialDefault("Enum", this.getEnum(field.enumUid));
    }
    const valid = validateFieldValue(field, field.defaultValue, this.defs.enums);
    field.defaultValue = valid === undefined ? defaultFor(field) : valid;
    this.pruneFieldValues(owner, field);
    if ("refDefUid" in patch) this.dropMismatchedRefs(owner, field);
    this.defsChanged();
  }

  /**
   * After a field switched between one value and a list: a value becomes a
   * one-entry list, a list keeps its first entry.
   */
  private convertArrayValues(owner: FieldOwner, field: FieldDef): void {
    const key = String(field.uid);
    const convert = (value: FieldValue): FieldValue | undefined => {
      const list = valueList(value);
      if (field.isArray) return list;
      return list[0] ?? undefined;
    };
    for (const holder of this.holdersOf(owner)) {
      if (!(key in holder.fields)) continue;
      const next = convert(holder.fields[key]);
      if (next === undefined) delete holder.fields[key];
      else holder.fields[key] = next;
    }
    field.defaultValue = field.isArray
      ? []
      : initialDefault(field.type, this.getEnum(field.enumUid));
  }

  /** Drops references to entities of another type than the field allows. */
  private dropMismatchedRefs(owner: FieldOwner, field: FieldDef): void {
    if (field.type !== "EntityRef" || field.refDefUid == null) return;
    const allowed = (v: unknown) => {
      if (!isEntityRef(v)) return true;
      const target = this.findEntity(v);
      return !target || target.instance.defUid === field.refDefUid;
    };
    const key = String(field.uid);
    for (const holder of this.holdersOf(owner)) {
      const value = holder.fields[key];
      if (value === undefined) continue;
      if (Array.isArray(value)) holder.fields[key] = value.filter(allowed);
      else if (!allowed(value)) delete holder.fields[key];
    }
  }

  /** The entity a reference points at, with its level; null when it no longer exists. */
  findEntity(ref: EntityRef): { level: Level; instance: EntityInstance } | null {
    const level = this.getLevel(ref.levelUid);
    const instance = level?.entities.find((e) => e.iid === ref.entityIid);
    return level && instance ? { level, instance } : null;
  }

  private removeFieldOf(owner: FieldOwner, fieldUid: number): void {
    const fields = this.fieldsOf(owner);
    const index = fields?.findIndex((f) => f.uid === fieldUid) ?? -1;
    if (!fields || index === -1) return;
    fields.splice(index, 1);
    for (const holder of this.holdersOf(owner)) delete holder.fields[String(fieldUid)];
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
    this.forEachEnumField(uid, (field, owner) => {
      field.enumUid = null;
      field.defaultValue = defaultFor(field);
      this.pruneFieldValues(owner, field);
    });
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
      this.forEachEnumField(uid, (field, owner) => {
        if (field.defaultValue === id) field.defaultValue = entry.id;
        const key = String(field.uid);
        for (const holder of this.holdersOf(owner)) {
          if (holder.fields[key] === undefined) continue;
          holder.fields[key] = mapScalars(holder.fields[key], (v) => (v === id ? entry.id : v));
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
    this.forEachEnumField(uid, (field, owner) => {
      if (field.defaultValue === id) field.defaultValue = def.values[0]?.id ?? null;
      this.pruneFieldValues(owner, field);
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
      shiftPoints(this.getEntityDef(e.defUid)?.fields ?? [], e.fields);
    }
    shiftPoints(this.defs.levelFields, level.fields);
    this.events.emit("entities:changed", level.uid);

    function shiftPoints(fields: readonly FieldDef[], values: Record<string, FieldValue>) {
      for (const field of fields) {
        const key = String(field.uid);
        if (field.type !== "Point" || values[key] === undefined) continue;
        values[key] = mapScalars(values[key], (v) =>
          isPoint(v) ? { x: v.x + cellsX, y: v.y + cellsY } : v
        );
      }
    }
  }

  // ------------------------------------------------------------------ definition history

  /**
   * Receives every definition edit as `(label, before, after)` snapshots so
   * the app can record it as an undo step. Unset (tests, loading), edits
   * simply apply.
   */
  definitionRecorder:
    | ((label: string, before: DefinitionSnapshot, after: DefinitionSnapshot) => void)
    | null = null;
  private recordDepth = 0;
  /** Bumped by every definition change; tells real edits from no-ops. */
  private definitionVersion = 0;

  /**
   * Runs a definition edit; with a recorder installed, snapshots before and
   * after so it can be undone. Nested edits belong to the outermost one.
   */
  recordDefinitionEdit<T>(label: string, run: () => T): T {
    if (!this.definitionRecorder || this.recordDepth > 0) return run();
    const before = this.snapshotDefinitions();
    const version = this.definitionVersion;
    this.recordDepth++;
    let result: T;
    try {
      result = run();
    } finally {
      this.recordDepth--;
    }
    if (this.definitionVersion !== version) {
      this.definitionRecorder(label, before, this.snapshotDefinitions(before));
    }
    return result;
  }

  /**
   * Definitions, grid size and every level's layers (order, properties,
   * cells) and entities. With `share`, layer data equal to the shared
   * snapshot's reuses its copy, so unchanged layers cost nothing.
   */
  snapshotDefinitions(share?: DefinitionSnapshot): DefinitionSnapshot {
    const levels = new Map<number, LevelDefinitionSnapshot>();
    for (const level of this.levels) {
      const previous = share?.levels.get(level.uid);
      const layers = new Map<string, LayerSnapshot>();
      for (const layer of level.doc.layers) {
        const old = previous?.layers.get(layer.id);
        const data = old && sameCells(old.data, layer.data) ? old.data : new Int32Array(layer.data);
        layers.set(layer.id, {
          name: layer.name,
          visible: layer.visible,
          opacity: layer.opacity,
          locked: layer.locked,
          scale: layer.scale,
          width: layer.width,
          height: layer.height,
          data,
        });
      }
      levels.set(level.uid, {
        order: level.doc.layers.map((l) => l.id),
        layers,
        activeLayerId: level.doc.activeLayerId,
        entities: structuredClone(level.entities),
        fields: structuredClone(level.fields),
      });
    }
    return {
      defs: structuredClone(this.defs),
      gridSize: this.gridSize,
      defaultLevelBg: this.defaultLevelBg,
      levels,
    };
  }

  /**
   * Puts definitions and level layers back to a snapshot, in place: levels
   * and documents stay the same objects and layers keep their ids, so undo
   * steps recorded before (cell edits, entity edits, world edits) stay valid.
   */
  restoreDefinitions(snapshot: DefinitionSnapshot): void {
    const defs = structuredClone(snapshot.defs);
    this.defs.layers.splice(0, Infinity, ...defs.layers);
    this.defs.tilesets.splice(0, Infinity, ...defs.tilesets);
    this.defs.entities.splice(0, Infinity, ...defs.entities);
    this.defs.enums.splice(0, Infinity, ...defs.enums);
    this.defs.levelFields.splice(0, Infinity, ...defs.levelFields);
    this.defaultLevelBg = snapshot.defaultLevelBg;
    for (const level of this.levels) {
      const saved = snapshot.levels.get(level.uid);
      if (saved) this.restoreLevelLayers(level, saved);
    }
    if (snapshot.gridSize !== this.gridSize) {
      this.gridSize = snapshot.gridSize;
      this.events.emit("settings:changed");
    }
    this.defsChanged();
    this.events.emit("defs:restored");
  }

  private restoreLevelLayers(level: Level, saved: LevelDefinitionSnapshot): void {
    const { doc } = level;
    // Add missing layers first, so removing never empties the document.
    for (const id of saved.order) {
      const s = saved.layers.get(id)!;
      const layer = doc.getLayer(id);
      if (!layer) {
        doc.addLayer({ id, ...s, data: s.data, activate: false });
        continue;
      }
      layer.name = s.name;
      layer.visible = s.visible;
      layer.opacity = s.opacity;
      layer.locked = s.locked;
      if (layer.scale !== s.scale || layer.width !== s.width || layer.height !== s.height) {
        layer.scale = s.scale;
        layer.restore(s.width, s.height, new Int32Array(s.data));
        doc.events.emit("layer:updated", { layerId: id, property: "scale" });
        doc.notifyCellsChanged(id);
      } else if (!sameCells(layer.data, s.data)) {
        layer.data.set(s.data);
        layer.version++;
        doc.notifyCellsChanged(id);
      }
    }
    // Collected first: removing changes the list being iterated.
    const extra = doc.layers.filter((l) => !saved.order.includes(l.id));
    for (const layer of extra) doc.removeLayer(layer.id);
    saved.order.forEach((id, index) => {
      const from = doc.layers.findIndex((l) => l.id === id);
      if (from !== -1 && from !== index) doc.moveLayer(from, index);
    });
    if (saved.activeLayerId && doc.getLayer(saved.activeLayerId)) {
      doc.setActiveLayer(saved.activeLayerId);
    }
    level.entities = structuredClone(saved.entities);
    level.fields = structuredClone(saved.fields);
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
  private pruneFieldValues(owner: FieldOwner, field: FieldDef): void {
    const key = String(field.uid);
    for (const holder of this.holdersOf(owner)) {
      if (!(key in holder.fields)) continue;
      const valid = validateFieldValue(field, holder.fields[key], this.defs.enums);
      if (valid === undefined) delete holder.fields[key];
      else holder.fields[key] = valid;
    }
  }

  /** Every Enum field bound to an enum, with its owner (entity type uid or "level"). */
  private forEachEnumField(enumUid: number, fn: (field: FieldDef, owner: FieldOwner) => void) {
    const visit = (fields: FieldDef[], owner: FieldOwner) => {
      for (const field of fields) {
        if (field.type === "Enum" && field.enumUid === enumUid) fn(field, owner);
      }
    };
    for (const entity of this.defs.entities) visit(entity.fields, entity.uid);
    visit(this.defs.levelFields, "level");
  }

  private defsChanged(): void {
    this.definitionVersion++;
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

/**
 * Definition edits and their undo labels. Each is wrapped so that, with a
 * `definitionRecorder` installed, it becomes one undo step (see
 * `recordDefinitionEdit`); edits made inside another edit join that step.
 */
const DEFINITION_EDITS: Partial<Record<keyof LevelProject, string>> = {
  setGridSize: "Change grid size",
  addIntGridLayer: "Add layer",
  addTilesLayer: "Add layer",
  addEntitiesLayer: "Add layer",
  duplicateLayerDef: "Duplicate layer",
  removeLayerDef: "Delete layer",
  moveLayerDef: "Move layer",
  placeLayerDefAbove: "Move layer",
  renameLayerDef: "Rename layer",
  setLayerTileset: "Change layer tileset",
  addIntGridValue: "Add value",
  updateIntGridValue: "Edit value",
  removeIntGridValue: "Remove value",
  addTileset: "Add tileset",
  updateTileset: "Edit tileset",
  removeTileset: "Delete tileset",
  setAutoSource: "Change auto-tiling",
  setLayerGridSize: "Change layer grid",
  setLayerGuideGrid: "Change guide grid",
  addAutoRule: "Add rule",
  addAutoGroup: "Add rule group",
  updateAutoGroup: "Edit rule group",
  removeAutoGroup: "Delete rule group",
  moveAutoGroup: "Move rule group",
  updateAutoRule: "Edit rule",
  removeAutoRule: "Delete rule",
  duplicateAutoRule: "Duplicate rule",
  moveAutoRule: "Move rule",
  reshuffleAutoLayer: "Reshuffle auto-layer",
  addEntityDef: "Add entity",
  updateEntityDef: "Edit entity",
  removeEntityDef: "Delete entity",
  addField: "Add field",
  updateField: "Edit field",
  removeField: "Remove field",
  addEnum: "Add enum",
  renameEnum: "Rename enum",
  removeEnum: "Delete enum",
  addEnumValue: "Add enum value",
  updateEnumValue: "Edit enum value",
  removeEnumValue: "Remove enum value",
  addLevelField: "Add level field",
  updateLevelField: "Edit level field",
  removeLevelField: "Remove level field",
  setDefaultLevelBg: "Edit default level background",
};

for (const [name, label] of Object.entries(DEFINITION_EDITS)) {
  const proto = LevelProject.prototype as unknown as Record<
    string,
    (...args: unknown[]) => unknown
  >;
  const original = proto[name];
  proto[name] = function (this: LevelProject, ...args: unknown[]) {
    return this.recordDefinitionEdit(label, () => original.apply(this, args));
  };
}
