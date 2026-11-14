import { EventEmitter, type HistoryManager, type Position } from "@foundry2d/core";
import type { RenderContext, RenderPass } from "@foundry2d/render";
import type { ScenePointerDelegate, ScenePointerEvent } from "@foundry2d/workspace";
import { defUidOf, type Level, type LevelProject } from "../model/LevelProject";
import { cloneInstance, entityRect, fieldValue, newIid, snapToCell } from "../model/entities";
import {
  AddEntityCommand,
  RemoveEntityCommand,
  UpdateEntityCommand,
} from "../model/entityCommands";
import type { EntityDef, EntityInstance, GridPoint, LayerDef } from "../model/types";

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
  /** Set while the next click picks a cell for a Point field. */
  private pointPick: { iid: string; fieldUid: number } | null = null;

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
    if (this.atLimit(def)) {
      this.hooks.notify(`${def.identifier} is limited to ${def.maxPerLevel} per level.`, 3500);
      return true;
    }
    const copy = cloneInstance(selected, newIid());
    copy.x += project.gridSize;
    copy.y += project.gridSize;
    const index = level.entities.findIndex((e) => e.iid === selected.iid) + 1;
    this.hooks.history.execute(new AddEntityCommand(project, level, copy, index));
    this.select(copy.iid);
    return true;
  }

  /** Moves the selection by whole cells (or pixels with `fine`). */
  nudge(dx: number, dy: number, fine: boolean): boolean {
    const selected = this.selected;
    if (!selected) return false;
    const step = fine ? 1 : this.hooks.getProject().gridSize;
    this.commitPosition(selected, selected.x + dx * step, selected.y + dy * step, "Move entity");
    return true;
  }

  /** Sets position (and/or field values) of an instance as one undo step. */
  update(iid: string, patch: Partial<Pick<EntityInstance, "x" | "y" | "fields">>, label: string) {
    const level = this.hooks.getLevel();
    const before = level.entities.find((e) => e.iid === iid);
    if (!before) return;
    const after = { ...cloneInstance(before), ...structuredClone(patch) };
    if (JSON.stringify(after) === JSON.stringify(before)) return;
    this.hooks.history.execute(
      new UpdateEntityCommand(this.hooks.getProject(), level, before, after, label)
    );
  }

  /** The next click on the level sets this Point field (Escape cancels). */
  startPointPick(iid: string, fieldUid: number): void {
    this.pointPick = { iid, fieldUid };
    this.hooks.notify("Click a cell to set the point. Esc cancels.", 4000);
    this.hooks.refreshCursor();
    this.emit();
  }

  get pickingPoint(): { iid: string; fieldUid: number } | null {
    return this.pointPick;
  }

  cancelPointPick(): boolean {
    if (!this.pointPick) return false;
    this.pointPick = null;
    this.hooks.refreshCursor();
    this.emit();
    return true;
  }

  /** Esc: cancel a point pick, else clear the selection. False when there was nothing to do. */
  escape(): boolean {
    if (this.cancelPointPick()) return true;
    if (!this.selectedIid) return false;
    this.select(null);
    return true;
  }

  // ------------------------------------------------------------------ pointer delegate

  getCursor(): string {
    if (this.pointPick) return "cell";
    if (this.drag) return "grabbing";
    if (this.hooks.isPicking()) return "copy";
    return this.hoverIid ? "grab" : "crosshair";
  }

  onPointerDown(ev: ScenePointerEvent): void {
    if (this.pointPick) {
      const { iid, fieldUid } = this.pointPick;
      this.pointPick = null;
      const instance = this.hooks.getLevel().entities.find((e) => e.iid === iid);
      if (instance && ev.button === 0 && this.insideLevel(ev.world)) {
        const { gridSize } = this.hooks.getProject();
        const point = {
          x: Math.floor(ev.world.x / gridSize),
          y: Math.floor(ev.world.y / gridSize),
        };
        this.update(iid, { fields: { ...instance.fields, [fieldUid]: point } }, "Set point");
      }
      this.hooks.refreshCursor();
      this.emit();
      return;
    }
    const hit = this.hitTest(ev.world);
    if (this.hooks.isPicking()) {
      if (hit) this.setPlaceDef(hit.defUid);
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
    const { gridSize } = this.hooks.getProject();
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
          Math.floor(ev.world.x / project.gridSize),
          Math.floor(ev.world.y / project.gridSize),
          project.gridSize
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

  /** Topmost instance on the active layer under a level-pixel point. */
  hitTest(p: Position): EntityInstance | undefined {
    const layerDef = this.activeLayerDef();
    if (!layerDef) return undefined;
    const project = this.hooks.getProject();
    const slack = 3 / Math.max(this.hooks.getZoom(), 0.0001);
    const entities = this.hooks.getLevel().entities;
    for (let i = entities.length - 1; i >= 0; i--) {
      const e = entities[i];
      if (e.layerUid !== layerDef.uid) continue;
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

  /** Point-field targets of an instance, for the overlay. */
  pointTargets(instance: EntityInstance): { label: string; point: GridPoint }[] {
    const project = this.hooks.getProject();
    const def = project.getEntityDef(instance.defUid);
    if (!def) return [];
    return def.fields.flatMap((field) => {
      if (field.type !== "Point") return [];
      const value = fieldValue(instance, field, project.defs.enums);
      return value && typeof value === "object" ? [{ label: field.identifier, point: value }] : [];
    });
  }

  get project(): LevelProject {
    return this.hooks.getProject();
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

    const hovered = controller.hovered;
    const selected = controller.selected;
    if (hovered && hovered !== selected) outline(hovered, false);
    if (selected) {
      links(selected);
      outline(selected, true);
    }
  }
}
