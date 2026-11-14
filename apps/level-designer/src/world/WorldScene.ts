import type { Dimensions, Rect, Unsubscribe } from "@foundry2d/core";
import { LayerBitmapCache, type RenderContext, type RenderPass } from "@foundry2d/render";
import type { ScenePointerEvent, Workspace, WorkspaceScene } from "@foundry2d/workspace";
import type { Level, LevelProject } from "../model/LevelProject";
import { levelLayerRendererFor } from "../render/entityRenderer";

export interface WorldSceneHooks {
  getSelectedUid: () => number | null;
  select: (uid: number | null) => void;
  /** Double-click on a level. */
  open: (uid: number) => void;
  /** Double-click on empty space (world pixels). */
  createAt: (x: number, y: number) => void;
  /** Drag finished: commit the move as an undo step. */
  commitMove: (uid: number, from: { x: number; y: number }, to: { x: number; y: number }) => void;
}

const DRAG_THRESHOLD_PX = 4;

/**
 * The LDtk-style world view: every level drawn at its world position, with
 * selection, drag-to-move (snapped to the layout) and double-click to open.
 */
export class WorldScene implements WorkspaceScene {
  readonly cellSize: Dimensions;
  readonly clampCamera = false;
  private workspace: Workspace | null = null;
  private subscriptions: Unsubscribe[] = [];
  private caches = new Map<number, LayerBitmapCache>();
  private hoverUid: number | null = null;
  private drag: {
    uid: number;
    startLocal: { x: number; y: number };
    grabOffset: { x: number; y: number };
    from: { x: number; y: number };
    moved: boolean;
  } | null = null;
  private readonly passes: RenderPass[];
  private readonly layerRenderer: ReturnType<typeof levelLayerRendererFor>;

  constructor(
    private readonly project: LevelProject,
    private readonly hooks: WorldSceneHooks
  ) {
    this.cellSize = { width: project.gridSize, height: project.gridSize };
    this.layerRenderer = levelLayerRendererFor(project);
    this.passes = [
      {
        id: "world-grid",
        space: "screen",
        enabled: true,
        render: (rc) => this.renderWorldGrid(rc),
      },
      { id: "levels", space: "world", enabled: true, render: (rc) => this.renderLevels(rc) },
      { id: "level-labels", space: "screen", enabled: true, render: (rc) => this.renderLabels(rc) },
    ];
  }

  getBounds(): Rect | null {
    return this.project.getWorldBounds();
  }

  getPasses(): RenderPass[] {
    return this.passes;
  }

  getCursor(): string {
    if (this.drag?.moved) return "grabbing";
    if (this.hoverUid !== null) return this.project.canDragLevels ? "grab" : "pointer";
    return "default";
  }

  attach(workspace: Workspace): void {
    this.workspace = workspace;
    const rerender = () => workspace.requestRender();
    this.subscriptions = [
      this.project.events.on("levels:changed", rerender),
      this.project.events.on("defs:changed", rerender),
      this.project.events.on("settings:changed", rerender),
      this.project.events.on("tilesets:loaded", rerender),
    ];
    // Level edits (cells, visibility) also show up in the world.
    for (const level of this.project.levels) this.watchLevel(level, rerender);
    this.subscriptions.push(
      this.project.events.on("levels:changed", () => {
        for (const level of this.project.levels) this.watchLevel(level, rerender);
      })
    );
  }

  detach(): void {
    this.subscriptions.forEach((unsubscribe) => unsubscribe());
    this.subscriptions = [];
    this.watched.clear();
    this.workspace = null;
    this.drag = null;
  }

  invalidate(): void {
    this.workspace?.refreshCursor();
    this.workspace?.requestRender();
  }

  // ------------------------------------------------------------------ input

  onPointerDown(ev: ScenePointerEvent): void {
    if (ev.button !== 0) return;
    const level = this.project.levelAt(ev.world.x, ev.world.y);
    this.hooks.select(level?.uid ?? null);
    if (!level) return;
    this.drag = {
      uid: level.uid,
      startLocal: ev.local,
      grabOffset: { x: ev.world.x - level.worldX, y: ev.world.y - level.worldY },
      from: { x: level.worldX, y: level.worldY },
      moved: false,
    };
  }

  onPointerMove(ev: ScenePointerEvent): void {
    const drag = this.drag;
    if (!drag) {
      const hover = this.project.levelAt(ev.world.x, ev.world.y)?.uid ?? null;
      if (hover !== this.hoverUid) {
        this.hoverUid = hover;
        this.invalidate();
      }
      return;
    }
    if (!this.project.canDragLevels) return;
    if (
      !drag.moved &&
      Math.hypot(ev.local.x - drag.startLocal.x, ev.local.y - drag.startLocal.y) < DRAG_THRESHOLD_PX
    ) {
      return;
    }
    drag.moved = true;
    const target = this.project.snapPosition(
      ev.world.x - drag.grabOffset.x,
      ev.world.y - drag.grabOffset.y
    );
    // Live preview; the undo step is recorded on release.
    this.project.moveLevel(drag.uid, target.x, target.y);
    this.workspace?.refreshCursor();
  }

  onPointerUp(): void {
    const drag = this.drag;
    this.drag = null;
    if (!drag?.moved) return;
    const level = this.project.getLevel(drag.uid);
    if (level && (level.worldX !== drag.from.x || level.worldY !== drag.from.y)) {
      this.hooks.commitMove(drag.uid, drag.from, { x: level.worldX, y: level.worldY });
    }
    this.workspace?.refreshCursor();
  }

  onPointerCancel(): void {
    const drag = this.drag;
    this.drag = null;
    if (drag?.moved) this.project.moveLevel(drag.uid, drag.from.x, drag.from.y);
    this.workspace?.refreshCursor();
  }

  onDoubleClick(ev: ScenePointerEvent): void {
    const level = this.project.levelAt(ev.world.x, ev.world.y);
    if (level) this.hooks.open(level.uid);
    else this.hooks.createAt(ev.world.x, ev.world.y);
  }

  // ------------------------------------------------------------------ rendering

  private watched = new Set<number>();

  private watchLevel(level: Level, rerender: () => void): void {
    if (this.watched.has(level.uid)) return;
    this.watched.add(level.uid);
    const { events } = level.doc;
    this.subscriptions.push(
      events.on("cells:changed", rerender),
      events.on("layer:updated", rerender),
      events.on("layers:changed", rerender),
      events.on("resized", rerender)
    );
  }

  private renderWorldGrid(rc: RenderContext): void {
    const { ctx, camera, viewWidth, viewHeight, devicePixelRatio: dpr } = rc;
    const project = this.project;
    const step =
      project.worldLayout === "gridvania"
        ? project.worldGrid
        : { width: project.gridSize * 8, height: project.gridSize * 8 };
    const visible = camera.getVisibleWorldRect(viewWidth, viewHeight);
    const spacing = Math.min(step.width, step.height) * camera.zoom;
    const snap = (v: number) => (Math.round(v * dpr) + 0.5) / dpr;

    ctx.lineWidth = 1 / dpr;
    if (spacing >= 8) {
      ctx.strokeStyle =
        project.worldLayout === "gridvania"
          ? "rgba(255, 255, 255, 0.08)"
          : "rgba(255, 255, 255, 0.035)";
      ctx.beginPath();
      const startX = Math.floor(visible.x / step.width) * step.width;
      for (let x = startX; x <= visible.x + visible.width; x += step.width) {
        const sx = snap(camera.worldToLocal(x, 0).x);
        ctx.moveTo(sx, 0);
        ctx.lineTo(sx, viewHeight);
      }
      const startY = Math.floor(visible.y / step.height) * step.height;
      for (let y = startY; y <= visible.y + visible.height; y += step.height) {
        const sy = snap(camera.worldToLocal(0, y).y);
        ctx.moveTo(0, sy);
        ctx.lineTo(viewWidth, sy);
      }
      ctx.stroke();
    }

    // World origin axes.
    const origin = camera.worldToLocal(0, 0);
    ctx.strokeStyle = "rgba(56, 189, 248, 0.25)";
    ctx.beginPath();
    ctx.moveTo(snap(origin.x), 0);
    ctx.lineTo(snap(origin.x), viewHeight);
    ctx.moveTo(0, snap(origin.y));
    ctx.lineTo(viewWidth, snap(origin.y));
    ctx.stroke();
  }

  private renderLevels(rc: RenderContext): void {
    const { ctx, camera, viewWidth, viewHeight } = rc;
    const project = this.project;
    const visible = camera.getVisibleWorldRect(viewWidth, viewHeight);
    const live = new Set<number>();

    ctx.imageSmoothingEnabled = false;
    for (const level of project.levels) {
      live.add(level.uid);
      const r = level.worldRect(project.gridSize);
      if (
        r.x > visible.x + visible.width ||
        r.y > visible.y + visible.height ||
        r.x + r.width < visible.x ||
        r.y + r.height < visible.y
      ) {
        continue;
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = project.levelBackground(level);
      ctx.fillRect(r.x, r.y, r.width, r.height);

      let cache = this.caches.get(level.uid);
      if (!cache) {
        cache = new LayerBitmapCache();
        this.caches.set(level.uid, cache);
      }
      for (const layer of level.doc.layers) {
        if (!layer.visible || layer.opacity <= 0) continue;
        ctx.globalAlpha = layer.opacity;
        const custom = this.layerRenderer(layer, level);
        if (custom) {
          custom(ctx, layer, r, visible);
          continue;
        }
        const bitmap = cache.get(layer, project.colorizerFor(layer.id), project.paletteVersion);
        ctx.drawImage(bitmap, r.x, r.y, r.width, r.height);
      }
      cache.prune(level.doc.layers.map((l) => l.id));
    }
    ctx.globalAlpha = 1;

    for (const uid of this.caches.keys()) {
      if (!live.has(uid)) this.caches.delete(uid);
    }
  }

  private renderLabels(rc: RenderContext): void {
    const { ctx, camera, theme } = rc;
    const project = this.project;
    const selected = this.hooks.getSelectedUid();

    ctx.font = `12px ${theme.font}`;
    ctx.textBaseline = "bottom";
    for (const level of project.levels) {
      const r = level.worldRect(project.gridSize);
      const tl = camera.worldToLocal(r.x, r.y);
      const br = camera.worldToLocal(r.x + r.width, r.y + r.height);
      const isSelected = level.uid === selected;
      const isHover = level.uid === this.hoverUid;

      ctx.lineWidth = isSelected ? 2 : 1;
      ctx.strokeStyle = isSelected
        ? theme.selection
        : isHover
          ? "rgba(255, 255, 255, 0.6)"
          : "rgba(255, 255, 255, 0.22)";
      const inset = ctx.lineWidth / 2;
      ctx.strokeRect(
        Math.round(tl.x) + inset,
        Math.round(tl.y) + inset,
        Math.round(br.x - tl.x) - ctx.lineWidth,
        Math.round(br.y - tl.y) - ctx.lineWidth
      );

      const label = `${level.identifier}  ${level.width}×${level.height}`;
      ctx.fillStyle = isSelected ? theme.selection : "rgba(244, 244, 245, 0.75)";
      ctx.fillText(label, Math.round(tl.x) + 2, Math.round(tl.y) - 4);
    }
  }
}
