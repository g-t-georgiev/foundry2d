import { EventEmitter, type HistoryManager, type Position } from "@foundry2d/core";
import type { RenderContext, RenderPass } from "@foundry2d/render";
import type { ScenePointerDelegate, ScenePointerEvent } from "@foundry2d/workspace";
import { defUidOf, type Level, type LevelProject } from "../model/LevelProject";
import {
  cloneInstance,
  entityRect,
  fieldValue,
  isEntityRef,
  isPoint,
  newIid,
  snapToCell,
  valueList,
  withEntry,
} from "../model/entities";
import {
  AddEntityCommand,
  RemoveEntityCommand,
  UpdateEntityCommand,
} from "../model/entityCommands";
import type {
  EntityDef,
  EntityInstance,
  FieldDef,
  FieldScalar,
  GridPoint,
  LayerDef,
} from "../model/types";

/** A canvas pick in progress: which field (and array entry) the next click sets. */
export interface FieldPick {
  iid: string;
  fieldUid: number;
  /** Array entry to set (the array length appends); 0 for single values. */
  index: number;
}

export interface EntityControllerHooks {
  getProject: () => LevelProject;
  getLevel: () => Level;
  history: HistoryManager;
  /** Screen pixels per level pixel (for hit-test slack). */
  getZoom: () => number;
  /** True while the eyedropper is active (Alt held): clicks pick a definition. */
  isPicking: () => boolean;
  requestRender: () => void;
  refreshCursor: () => void;
  notify: (message: string, timeout?: number) => void;
}

type Drag =
  | {
      kind: "place";
      instance: EntityInstance;
      index: number;
      start: Position;
      origin: Position;
    }
  | {
      kind: "move";
      before: EntityInstance;
      instance: EntityInstance;
      start: Position;
      origin: Position;
      label: string;
    };

/**
 * Entity editing on an Entities layer: place, select, move, duplicate and
 * delete instances, as undo steps in the project history.
 *
 * Plugs into the level scene as a pointer delegate (grid tools don't run on
 * Entities layers) and as an overlay pass (selection, hover, Point fields).
 * The chosen definition and the selection are transient UI state.
 */
export class EntityController implements ScenePointerDelegate {
  readonly events = new EventEmitter<{ changed: () => void }>();
  readonly overlay: RenderPass;
  private placeDefUid: number | null = null;
  private selectedIid: string | null = null;
  private hoverIid: string | null = null;
  private drag: Drag | null = null;
  /** Set while the next click picks a cell (Point) or an entity (EntityRef) for a field. */
  private pick: FieldPick | null = null;

  constructor(private readonly hooks: EntityControllerHooks) {
    this.overlay = new EntityOverlayPass(this);
  }

  // ------------------------------------------------------------------ state

  /** The active layer's definition, when it is an Entities layer. */
  activeLayerDef(): LayerDef | undefined {
    const id = this.hooks.getLevel().doc.activeLayerId ?? "";
    const def = this.hooks.getProject().getLayerDefForLayer(id);
    return def?.type === "Entities" ? def : undefined;
  }

  get isActive(): boolean {
    return this.activeLayerDef() !== undefined;
  }

  /**
   * Why the active Entities layer can't be edited (locked or hidden), or
   * `null` when it can. Selection and inspection still work.
   */
  get blockedReason(): string | null {
    const layer = this.hooks.getLevel().doc.getActiveLayer();
    if (!layer || !this.isActive) return null;
    if (layer.locked) return `"${layer.name}" is locked. Unlock it in the layers panel to edit.`;
    if (!layer.visible) return `"${layer.name}" is hidden. Show it to edit.`;
    return null;
  }

  /** Reports a blocked edit; returns true when blocked. */
  private blocked(): boolean {
    const reason = this.blockedReason;
    if (reason) this.hooks.notify(reason, 3500);
    return reason !== null;
  }

  /** Definition placed by a click on empty space (defaults to the first one). */
  get placeDef(): EntityDef | undefined {
    const project = this.hooks.getProject();
    return project.getEntityDef(this.placeDefUid ?? -1) ?? project.defs.entities[0] ?? undefined;
  }

  setPlaceDef(uid: number): void {
    if (this.placeDefUid === uid) return;
    this.placeDefUid = uid;
    this.emit();
  }

  /** The selected instance, if it still exists in the open level. */
  get selected(): EntityInstance | undefined {
    if (!this.selectedIid) return undefined;
    return this.hooks.getLevel().entities.find((e) => e.iid === this.selectedIid);
  }

  get hovered(): EntityInstance | undefined {
    if (!this.hoverIid) return undefined;
    return this.hooks.getLevel().entities.find((e) => e.iid === this.hoverIid);
  }

  select(iid: string | null): void {
    if (this.selectedIid === iid) return;
    this.selectedIid = iid;
    this.emit();
  }

  /** Called when the open level changes or its entities change externally. */
  refresh(): void {
    if (this.selectedIid && !this.selected) this.selectedIid = null;
    if (this.hoverIid && !this.hovered) this.hoverIid = null;
    this.emit();
  }

  // ------------------------------------------------------------------ actions

  deleteSelected(): boolean {
    const selected = this.selected;
    if (!selected) return false;
    if (this.blocked()) return true;
    const { history } = this.hooks;
    history.execute(
      new RemoveEntityCommand(this.hooks.getProject(), this.hooks.getLevel(), selected.iid)
    );
    this.select(null);
    return true;
  }

  /** Copies the selected instance one cell to the right and down, and selects the copy. */
  duplicateSelected(): boolean {
    const selected = this.selected;
    const project = this.hooks.getProject();
    const level = this.hooks.getLevel();
    const def = selected ? project.getEntityDef(selected.defUid) : undefined;
    if (!selected || !def) return false;
    if (this.blocked()) return true;
    if (this.atLimit(def)) {
      this.hooks.notify(`${def.identifier} is limited to ${def.maxPerLevel} per level.`, 3500);
      return true;
    }
    const copy = cloneInstance(selected, newIid());
    const step = this.gridOf(selected.layerUid);
    copy.x += step;
    copy.y += step;
    const index = level.entities.findIndex((e) => e.iid === selected.iid) + 1;
    this.hooks.history.execute(new AddEntityCommand(project, level, copy, index));
    this.select(copy.iid);
    return true;
  }

  /** Moves the selection by whole cells (or pixels with `fine`). */
  nudge(dx: number, dy: number, fine: boolean): boolean {
    const selected = this.selected;
    if (!selected) return false;
    if (this.blocked()) return true;
    const step = fine ? 1 : this.gridOf(selected.layerUid);
    this.commitPosition(selected, selected.x + dx * step, selected.y + dy * step, "Move entity");
    return true;
  }

  /** Sets position (and/or field values) of an instance as one undo step. */
  update(iid: string, patch: Partial<Pick<EntityInstance, "x" | "y" | "fields">>, label: string) {
    const level = this.hooks.getLevel();
    const before = level.entities.find((e) => e.iid === iid);
    if (!before || this.blocked()) return;
    const after = { ...cloneInstance(before), ...structuredClone(patch) };
    if (JSON.stringify(after) === JSON.stringify(before)) return;
    this.hooks.history.execute(
      new UpdateEntityCommand(this.hooks.getProject(), level, before, after, label)
    );
  }

  /**
   * The next click on the level sets this field: a cell for Point fields,
   * an entity for EntityRef fields (Escape cancels).
   */
  startPick(iid: string, fieldUid: number, index = 0): void {
    this.pick = { iid, fieldUid, index };
    const field = this.pickField();
    this.hooks.notify(
      field?.type === "EntityRef"
        ? "Click an entity to point at. Esc cancels."
        : "Click a cell to set the point. Esc cancels.",
      4000
    );
    this.hooks.refreshCursor();
    this.emit();
  }

  get picking(): FieldPick | null {
    return this.pick;
  }

  cancelPick(): boolean {
    if (!this.pick) return false;
    this.pick = null;
    this.hooks.refreshCursor();
    this.emit();
    return true;
  }

  /** The field being picked, if its instance and definition still exist. */
  private pickField(): FieldDef | undefined {
    if (!this.pick) return undefined;
    const { iid, fieldUid } = this.pick;
    const instance = this.hooks.getLevel().entities.find((e) => e.iid === iid);
    const def = instance && this.hooks.getProject().getEntityDef(instance.defUid);
    return def?.fields.find((f) => f.uid === fieldUid);
  }

  /** Finishes a pick with a click; returns false to keep picking (a miss). */
  private completePick(ev: ScenePointerEvent): boolean {
    const { iid, fieldUid, index } = this.pick!;
    const project = this.hooks.getProject();
    const level = this.hooks.getLevel();
    const instance = level.entities.find((e) => e.iid === iid);
    const field = this.pickField();
    if (!instance || !field || ev.button !== 0) return true;
    let picked: FieldScalar;
    if (field.type === "EntityRef") {
      const hit = this.hitTest(ev.world, true);
      if (!hit) {
        this.hooks.notify("Click an entity to point at. Esc cancels.", 3000);
        return false;
      }
      const wanted = field.refDefUid == null ? undefined : project.getEntityDef(field.refDefUid);
      if (wanted && hit.defUid !== wanted.uid) {
        this.hooks.notify(
          `${field.identifier} points at a ${wanted.identifier}. Esc cancels.`,
          3000
        );
        return false;
      }
      picked = { entityIid: hit.iid, levelUid: level.uid };
    } else {
      if (!this.insideLevel(ev.world)) return true;
      const { gridSize } = project;
      picked = { x: Math.floor(ev.world.x / gridSize), y: Math.floor(ev.world.y / gridSize) };
    }
    const current = fieldValue(instance, field, project.defs.enums);
    this.update(
      iid,
      { fields: { ...instance.fields, [fieldUid]: withEntry(field, current, index, picked) } },
      field.type === "EntityRef" ? `Set ${field.identifier}` : "Set point"
    );
    return true;
  }

  /** Esc: cancel a point pick, else clear the selection. False when there was nothing to do. */
  escape(): boolean {
    if (this.cancelPick()) return true;
    if (!this.selectedIid) return false;
    this.select(null);
    return true;
  }

  // ------------------------------------------------------------------ pointer delegate

  getCursor(): string {
    if (this.pick) return this.pickField()?.type === "EntityRef" ? "alias" : "cell";
    if (this.drag) return "grabbing";
    if (this.hooks.isPicking()) return "copy";
    if (this.blockedReason) return this.hoverIid ? "pointer" : "not-allowed";
    return this.hoverIid ? "grab" : "crosshair";
  }

  onPointerDown(ev: ScenePointerEvent): void {
    if (this.pick) {
      if (this.completePick(ev)) this.pick = null;
      this.hooks.refreshCursor();
      this.emit();
      return;
    }
    const hit = this.hitTest(ev.world);
    if (this.hooks.isPicking()) {
      if (hit) this.setPlaceDef(hit.defUid);
      return;
    }
    if (this.blockedReason) {
      // Locked or hidden: clicks only select, so the inspector can still show values.
      this.select(hit?.iid ?? null);
      if (!hit || ev.button === 2) this.blocked();
      return;
    }
    if (ev.button === 2) {
      if (hit) {
        this.select(hit.iid);
        this.deleteSelected();
      }
      return;
    }
    if (ev.button !== 0) return;

    if (hit) {
      this.select(hit.iid);
      this.drag = {
        kind: "move",
        before: cloneInstance(hit),
        instance: hit,
        start: ev.world,
        origin: { x: hit.x, y: hit.y },
        label: "Move entity",
      };
    } else {
      this.beginPlace(ev);
    }
    this.hooks.refreshCursor();
  }

  onPointerMove(ev: ScenePointerEvent): void {
    const drag = this.drag;
    if (!drag) {
      const hover = this.hitTest(ev.world)?.iid ?? null;
      if (hover !== this.hoverIid) {
        this.hoverIid = hover;
        this.hooks.refreshCursor();
        this.hooks.requestRender();
      }
      return;
    }
    const gridSize = this.gridOf(drag.instance.layerUid);
    const rawX = ev.world.x - drag.start.x;
    const rawY = ev.world.y - drag.start.y;
    const dx = ev.shiftKey ? Math.round(rawX) : Math.round(rawX / gridSize) * gridSize;
    const dy = ev.shiftKey ? Math.round(rawY) : Math.round(rawY / gridSize) * gridSize;
    const next = this.clampToLevel(drag.origin.x + dx, drag.origin.y + dy);
    if (next.x === drag.instance.x && next.y === drag.instance.y) return;
    drag.instance.x = next.x;
    drag.instance.y = next.y;
    this.hooks.requestRender();
  }

  onPointerUp(_ev?: ScenePointerEvent): void {
    const drag = this.drag;
    this.drag = null;
    if (!drag) return;
    const project = this.hooks.getProject();
    const level = this.hooks.getLevel();
    const { history } = this.hooks;
    if (drag.kind === "place") {
      // Already inserted for the live preview; record it as one step.
      history.record(new AddEntityCommand(project, level, drag.instance, drag.index));
      project.events.emit("entities:changed", level.uid);
    } else if (drag.instance.x !== drag.before.x || drag.instance.y !== drag.before.y) {
      history.record(
        new UpdateEntityCommand(project, level, drag.before, drag.instance, drag.label)
      );
      project.events.emit("entities:changed", level.uid);
    }
    this.hooks.refreshCursor();
    this.emit();
  }

  onPointerCancel(): void {
    const drag = this.drag;
    this.drag = null;
    if (!drag) return;
    const project = this.hooks.getProject();
    const level = this.hooks.getLevel();
    if (drag.kind === "place") {
      project.removeEntity(level, drag.instance.iid);
      this.select(null);
    } else {
      drag.instance.x = drag.before.x;
      drag.instance.y = drag.before.y;
    }
    this.hooks.refreshCursor();
    this.hooks.requestRender();
  }

  // ------------------------------------------------------------------ internals

  private beginPlace(ev: ScenePointerEvent): void {
    const project = this.hooks.getProject();
    const level = this.hooks.getLevel();
    const layerDef = this.activeLayerDef();
    const def = this.placeDef;
    if (!layerDef) return;
    if (!def) {
      this.select(null);
      this.hooks.notify("No entity definitions yet. Add one in Project settings → Entities.", 4000);
      return;
    }
    if (!this.insideLevel(ev.world)) {
      this.select(null);
      return;
    }
    const position = ev.shiftKey
      ? { x: Math.round(ev.world.x), y: Math.round(ev.world.y) }
      : snapToCell(
          def,
          Math.floor(ev.world.x / this.gridOf()),
          Math.floor(ev.world.y / this.gridOf()),
          this.gridOf()
        );

    if (this.atLimit(def)) {
      // LDtk behaviour: at the limit, the most recent instance moves here.
      const last = [...level.entities].reverse().find((e) => e.defUid === def.uid);
      if (!last) return;
      const before = cloneInstance(last);
      last.x = position.x;
      last.y = position.y;
      this.select(last.iid);
      this.drag = {
        kind: "move",
        before,
        instance: last,
        start: ev.world,
        origin: position,
        label: `Move ${def.identifier}`,
      };
      this.hooks.requestRender();
      return;
    }

    const instance: EntityInstance = {
      iid: newIid(),
      defUid: def.uid,
      layerUid: layerDef.uid,
      x: position.x,
      y: position.y,
      fields: {},
    };
    const index = level.entities.length;
    project.insertEntity(level, instance, index);
    // Keep a handle on the inserted object so drags move the live instance.
    const live = level.entities[index];
    this.select(live.iid);
    this.drag = { kind: "place", instance: live, index, start: ev.world, origin: position };
  }

  private atLimit(def: EntityDef): boolean {
    return (
      def.maxPerLevel > 0 &&
      this.hooks.getProject().countEntities(def.uid, this.hooks.getLevel()) >= def.maxPerLevel
    );
  }

  private commitPosition(instance: EntityInstance, x: number, y: number, label: string) {
    const next = this.clampToLevel(x, y);
    this.update(instance.iid, next, label);
  }

  private insideLevel(p: Position): boolean {
    const { gridSize } = this.hooks.getProject();
    const level = this.hooks.getLevel();
    return p.x >= 0 && p.y >= 0 && p.x < level.width * gridSize && p.y < level.height * gridSize;
  }

  private clampToLevel(x: number, y: number): Position {
    const { gridSize } = this.hooks.getProject();
    const level = this.hooks.getLevel();
    return {
      x: Math.min(level.width * gridSize, Math.max(0, x)),
      y: Math.min(level.height * gridSize, Math.max(0, y)),
    };
  }

  /** Topmost instance on the active layer (or on any layer) under a level-pixel point. */
  hitTest(p: Position, anyLayer = false): EntityInstance | undefined {
    const layerDef = this.activeLayerDef();
    if (!layerDef && !anyLayer) return undefined;
    const project = this.hooks.getProject();
    const slack = 3 / Math.max(this.hooks.getZoom(), 0.0001);
    const entities = this.hooks.getLevel().entities;
    for (let i = entities.length - 1; i >= 0; i--) {
      const e = entities[i];
      if (!anyLayer && e.layerUid !== layerDef?.uid) continue;
      const def = project.getEntityDef(e.defUid);
      if (!def) continue;
      const r = entityRect(def, e);
      if (
        p.x >= r.x - slack &&
        p.y >= r.y - slack &&
        p.x <= r.x + r.width + slack &&
        p.y <= r.y + r.height + slack
      ) {
        return e;
      }
    }
    return undefined;
  }

  /** Point-field targets of an instance, for the overlay (array entries labelled by index). */
  pointTargets(instance: EntityInstance): { label: string; point: GridPoint }[] {
    return this.fieldTargets(instance, "Point").flatMap(({ label, value }) =>
      isPoint(value) ? [{ label, point: value }] : []
    );
  }

  /** Entities in this level that an instance's EntityRef fields point at, for the overlay. */
  refTargets(instance: EntityInstance): { label: string; target: EntityInstance }[] {
    const level = this.hooks.getLevel();
    return this.fieldTargets(instance, "EntityRef").flatMap(({ label, value }) => {
      if (!isEntityRef(value) || value.levelUid !== level.uid) return [];
      const target = level.entities.find((e) => e.iid === value.entityIid);
      return target ? [{ label, target }] : [];
    });
  }

  private fieldTargets(instance: EntityInstance, type: "Point" | "EntityRef") {
    const project = this.hooks.getProject();
    const def = project.getEntityDef(instance.defUid);
    return (def?.fields ?? []).flatMap((field) => {
      if (field.type !== type) return [];
      const values = valueList(fieldValue(instance, field, project.defs.enums));
      return values.map((value, i) => ({
        label: field.isArray ? `${field.identifier}[${i}]` : field.identifier,
        value,
      }));
    });
  }

  get project(): LevelProject {
    return this.hooks.getProject();
  }

  /** Snapping step in pixels: the grid of an Entities layer (the active one by default). */
  private gridOf(layerUid?: number): number {
    const project = this.hooks.getProject();
    const def = layerUid === undefined ? this.activeLayerDef() : project.getLayerDef(layerUid);
    return project.layerGridSize(def);
  }

  get level(): Level {
    return this.hooks.getLevel();
  }

  /** Layer uid of a document layer id, for views. */
  static layerUidOf(layerId: string | null): number | null {
    return layerId ? defUidOf(layerId) : null;
  }

  private emit(): void {
    this.hooks.requestRender();
    this.events.emit("changed");
  }
}

/** Selection and hover outlines plus Point-field links, in screen space for crisp lines. */
class EntityOverlayPass implements RenderPass {
  readonly id = "entity-overlay";
  readonly space = "screen";
  enabled = true;

  constructor(private readonly controller: EntityController) {}

  render(rc: RenderContext): void {
    const controller = this.controller;
    if (!controller.isActive) return;
    const { ctx, camera } = rc;
    const project = controller.project;
    const { gridSize } = project;

    const outline = (instance: EntityInstance, selected: boolean) => {
      const def = project.getEntityDef(instance.defUid);
      if (!def) return;
      const r = entityRect(def, instance);
      const tl = camera.worldToLocal(r.x, r.y);
      const br = camera.worldToLocal(r.x + r.width, r.y + r.height);
      const x = Math.round(tl.x) - 1.5;
      const y = Math.round(tl.y) - 1.5;
      const w = Math.round(br.x - tl.x) + 3;
      const h = Math.round(br.y - tl.y) + 3;
      ctx.lineWidth = 1;
      if (selected) {
        ctx.setLineDash([4, 3]);
        ctx.strokeStyle = "#000";
        ctx.strokeRect(x, y, w, h);
        ctx.lineDashOffset = 3.5;
        ctx.strokeStyle = "#fff";
        ctx.strokeRect(x, y, w, h);
        ctx.setLineDash([]);
        ctx.lineDashOffset = 0;
      } else {
        ctx.strokeStyle = "rgba(255, 255, 255, 0.55)";
        ctx.strokeRect(x, y, w, h);
      }
    };

    const links = (instance: EntityInstance) => {
      const from = camera.worldToLocal(instance.x, instance.y);
      ctx.font = `11px ${rc.theme.font}`;
      ctx.textBaseline = "bottom";
      for (const { label, point } of controller.pointTargets(instance)) {
        const to = camera.worldToLocal((point.x + 0.5) * gridSize, (point.y + 0.5) * gridSize);
        ctx.strokeStyle = "rgba(250, 204, 21, 0.9)";
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(to.x, to.y);
        ctx.stroke();
        ctx.setLineDash([]);
        const size = Math.max(4, (gridSize * camera.zoom) / 2);
        ctx.beginPath();
        ctx.moveTo(to.x, to.y - size);
        ctx.lineTo(to.x + size, to.y);
        ctx.lineTo(to.x, to.y + size);
        ctx.lineTo(to.x - size, to.y);
        ctx.closePath();
        ctx.stroke();
        ctx.fillStyle = "rgba(250, 204, 21, 0.95)";
        ctx.fillText(label, to.x + size + 3, to.y - 2);
      }
    };

    const refs = (instance: EntityInstance) => {
      const from = camera.worldToLocal(instance.x, instance.y);
      ctx.font = `11px ${rc.theme.font}`;
      ctx.textBaseline = "bottom";
      const color = "rgba(96, 205, 255, 0.95)";
      for (const { label, target } of controller.refTargets(instance)) {
        const def = project.getEntityDef(target.defUid);
        if (!def) continue;
        const r = entityRect(def, target);
        const to = camera.worldToLocal(r.x + r.width / 2, r.y + r.height / 2);
        const angle = Math.atan2(to.y - from.y, to.x - from.x);
        // Stop at the target's box so the arrowhead stays visible.
        const half = (Math.min(r.width, r.height) / 2) * camera.zoom;
        const tip = { x: to.x - Math.cos(angle) * half, y: to.y - Math.sin(angle) * half };
        ctx.strokeStyle = color;
        ctx.fillStyle = color;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.moveTo(from.x, from.y);
        ctx.lineTo(tip.x, tip.y);
        ctx.stroke();
        const head = 8;
        ctx.beginPath();
        ctx.moveTo(tip.x, tip.y);
        ctx.lineTo(tip.x - head * Math.cos(angle - 0.45), tip.y - head * Math.sin(angle - 0.45));
        ctx.lineTo(tip.x - head * Math.cos(angle + 0.45), tip.y - head * Math.sin(angle + 0.45));
        ctx.closePath();
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.fillText(label, (from.x + tip.x) / 2 + 4, (from.y + tip.y) / 2 - 2);
      }
    };

    const hovered = controller.hovered;
    const selected = controller.selected;
    if (hovered && hovered !== selected) outline(hovered, false);
    if (selected) {
      links(selected);
      refs(selected);
      outline(selected, true);
    }
  }
}
