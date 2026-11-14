import {
  Camera,
  EventEmitter,
  type CameraConfig,
  type CameraState,
  type Position,
  type Rect,
} from "@foundry2d/core";
import {
  Renderer,
  RulersPass,
  type PointerInfo,
  type RenderPass,
  type RenderTheme,
  type RulersPassOptions,
} from "@foundry2d/render";
import { InputController, type InputOptions } from "./InputController";
import { Keymap } from "./Keymap";
import type { ScenePointerEvent, WorkspaceEventMap, WorkspaceScene } from "./types";

export interface WorkspaceOptions {
  /** Use an existing canvas; otherwise one is created inside the container. */
  canvas?: HTMLCanvasElement;
  theme?: Partial<RenderTheme>;
  camera?: CameraConfig;
  /** Show rulers (default `true`). Pass options to customize units. */
  rulers?: boolean | RulersPassOptions;
  /** Extra screen overlays drawn above the scene and below the rulers. */
  overlays?: RenderPass[];
  input?: InputOptions;
  /** How far beyond "fit" the user may zoom out on bounded scenes (default 0.25 = 4x smaller). */
  minZoomFitRatio?: number;
}

export interface SetSceneOptions {
  /** Fit the new scene's bounds to the view (default `true` unless `camera` is given). */
  fit?: boolean;
  /** Restore an explicit camera state. */
  camera?: CameraState;
  /** Animate the transition to the target camera (ms). */
  animate?: number;
}

/**
 * The shared editor viewport: a canvas, camera, renderer, input and render
 * loop. Apps provide a `WorkspaceScene` that decides what is drawn and how
 * pointer input edits it.
 *
 * Rendering happens on demand: call `requestRender()` after changing state
 * (scenes usually subscribe to their document's events for this).
 */
export class Workspace {
  public readonly canvas: HTMLCanvasElement;
  public readonly camera: Camera;
  public readonly renderer: Renderer;
  public readonly keymap = new Keymap();
  public readonly events = new EventEmitter<WorkspaceEventMap>();
  public readonly input: InputController;

  private _scene: WorkspaceScene | null = null;
  private readonly rulers: RulersPass | null;
  private readonly overlays: RenderPass[];
  private readonly minZoomFitRatio: number;
  private viewWidth = 0;
  private viewHeight = 0;
  private dpr = 1;
  private pointer: PointerInfo | null = null;
  private dirty = true;
  private rafId = 0;
  private hasInitialFit = false;
  private animation: {
    from: CameraState;
    to: CameraState;
    start: number;
    duration: number;
    resolve: () => void;
  } | null = null;
  private readonly resizeObserver: ResizeObserver;
  private readonly ownsCanvas: boolean;

  constructor(
    public readonly container: HTMLElement,
    options: WorkspaceOptions = {}
  ) {
    this.ownsCanvas = !options.canvas;
    this.canvas = options.canvas ?? document.createElement("canvas");
    if (this.ownsCanvas) {
      this.canvas.style.display = "block";
      this.canvas.style.width = "100%";
      this.canvas.style.height = "100%";
      container.appendChild(this.canvas);
    }
    this.canvas.tabIndex = this.canvas.tabIndex >= 0 ? this.canvas.tabIndex : 0;
    this.canvas.style.outline = "none";

    const rulerOptions =
      options.rulers === false ? null : options.rulers === true ? {} : (options.rulers ?? {});
    this.rulers = rulerOptions ? new RulersPass(rulerOptions) : null;

    this.camera = new Camera({
      uiPadding: this.rulers ? this.rulers.size : 0,
      ...options.camera,
    });
    this.renderer = new Renderer(this.canvas, options.theme);
    this.overlays = options.overlays ?? [];
    this.minZoomFitRatio = options.minZoomFitRatio ?? 0.25;
    this.input = new InputController(this, this.canvas, options.input);

    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(container);
    this.handleResize();

    this.loop = this.loop.bind(this);
    this.rafId = requestAnimationFrame(this.loop);
  }

  // ------------------------------------------------------------------ scene

  get scene(): WorkspaceScene | null {
    return this._scene;
  }

  async setScene(scene: WorkspaceScene | null, options: SetSceneOptions = {}): Promise<void> {
    if (this._scene === scene) return;
    this.input.cancelStroke();
    this._scene?.detach?.();
    this._scene = scene;

    if (scene) {
      this.camera.cellSize = { ...scene.cellSize };
      scene.attach?.(this);
    }
    this.rebuildPasses();
    this.refreshCursor();
    this.events.emit("scene:changed", { scene });

    let target: CameraState | null = options.camera ?? null;
    if (!target && (options.fit ?? true) && scene) target = this.computeFitState();
    if (target) {
      this.hasInitialFit = true;
      if (options.animate) await this.animateTo(target, options.animate);
      else this.setCamera(target);
    }
    this.requestRender();
  }

  /** Re-reads the scene's passes (call when a scene adds/removes passes). */
  rebuildPasses(): void {
    const scenePasses = this._scene?.getPasses() ?? [];
    const passes = [...scenePasses, ...this.overlays];
    if (this.rulers) passes.push(this.rulers);
    this.renderer.setPasses(passes);
    this.requestRender();
  }

  // ------------------------------------------------------------------ camera

  get zoom(): number {
    return this.camera.zoom;
  }

  get viewSize(): { width: number; height: number } {
    return { width: this.viewWidth, height: this.viewHeight };
  }

  fitToView(animate = 0): Promise<void> {
    const target = this.computeFitState();
    if (!target) return Promise.resolve();
    if (animate > 0) return this.animateTo(target, animate);
    this.setCamera(target);
    return Promise.resolve();
  }

  /** Zooms around the view center. */
  zoomBy(factor: number): void {
    const center = {
      x: this.camera.uiPadding + (this.viewWidth - this.camera.uiPadding) / 2,
      y: this.camera.uiPadding + (this.viewHeight - this.camera.uiPadding) / 2,
    };
    this.zoomAtLocal(center.x, center.y, factor);
  }

  zoomAtLocal(localX: number, localY: number, factor: number): void {
    this.stopAnimation();
    this.camera.zoomAt(localX, localY, factor, this.getMinZoom());
    this.afterCameraChange();
  }

  panBy(dx: number, dy: number): void {
    if (!dx && !dy) return;
    this.stopAnimation();
    this.camera.moveBy(dx, dy);
    this.afterCameraChange();
  }

  setCamera(state: CameraState): void {
    this.camera.setState(state);
    this.afterCameraChange();
  }

  /** Smoothly moves the camera to `target`. Resolves when done or interrupted. */
  animateTo(target: CameraState, duration = 250): Promise<void> {
    this.stopAnimation();
    if (duration <= 0) {
      this.setCamera(target);
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const animation = {
        from: this.camera.getState(),
        to: target,
        start: performance.now(),
        duration,
        resolve,
      };
      this.animation = animation;
      this.requestRender();
      // requestAnimationFrame is paused in background tabs and hidden panes;
      // make sure the camera still lands and callers aren't left waiting.
      setTimeout(() => {
        if (this.animation !== animation) return;
        this.animation = null;
        this.setCamera(target);
        resolve();
      }, duration + 200);
    });
  }

  /** Camera state that fits `rect` (default: the current scene bounds) into the view. */
  computeFitState(rect?: Rect): CameraState | null {
    // The layout may have changed since the last ResizeObserver callback
    // (e.g. a sidebar was just shown); measure now so the fit is exact.
    this.handleResize();
    const bounds = rect ?? this._scene?.getBounds();
    if (!bounds || !this.viewWidth || !this.viewHeight) return null;
    const probe = new Camera({
      cellSize: this.camera.cellSize,
      uiPadding: this.camera.uiPadding,
      viewportPadding: this.camera.viewportPadding,
      minZoom: this.camera.minZoom,
      maxZoom: this.camera.maxZoom,
    });
    probe.fitToBounds(this.viewWidth, this.viewHeight, bounds);
    return probe.getState();
  }

  // ------------------------------------------------------------------ pointer

  /** Grid cell under a world point, as the scene counts cells. */
  private toGrid(world: Position): Position {
    return this.scene?.worldToGrid?.(world) ?? this.camera.worldToGrid(world.x, world.y);
  }

  /** Converts a DOM event to a scene event in all coordinate spaces. */
  toScenePointer(ev: MouseEvent, local: Position): ScenePointerEvent {
    const world = this.camera.localToWorld(local.x, local.y);
    return {
      pointerId: "pointerId" in ev ? (ev as PointerEvent).pointerId : 1,
      button: ev.button,
      local,
      world,
      grid: this.toGrid(world),
      shiftKey: ev.shiftKey,
      altKey: ev.altKey,
      ctrlKey: ev.ctrlKey,
      metaKey: ev.metaKey,
      native: ev,
    };
  }

  /** Updates the hover position (`null` when the pointer left the canvas). */
  updatePointer(local: Position | null): void {
    if (!local) {
      if (this.pointer?.inside) {
        this.pointer = { ...this.pointer, inside: false };
        this.events.emit("pointer:move", { ...this.pointer });
        this.requestRender();
      }
      return;
    }
    const world = this.camera.localToWorld(local.x, local.y);
    const grid = this.toGrid(world);
    const inside =
      local.x >= this.camera.uiPadding &&
      local.y >= this.camera.uiPadding &&
      local.x <= this.viewWidth &&
      local.y <= this.viewHeight;
    this.pointer = { local, world, grid, inside };
    this.events.emit("pointer:move", { world, grid, inside });
    this.requestRender();
  }

  get pointerInfo(): PointerInfo | null {
    return this.pointer;
  }

  refreshCursor(): void {
    const cursor = this.input.isPanning
      ? "grabbing"
      : this.input.wantsPan
        ? "grab"
        : (this._scene?.getCursor?.() ?? "default");
    if (this.canvas.style.cursor !== cursor) this.canvas.style.cursor = cursor;
  }

  // ------------------------------------------------------------------ frame

  requestRender(): void {
    this.dirty = true;
  }

  /** Renders synchronously (useful for screenshots/tests). */
  renderNow(): void {
    this.renderer.render({
      camera: this.camera,
      viewWidth: this.viewWidth,
      viewHeight: this.viewHeight,
      devicePixelRatio: this.dpr,
      pointer: this.pointer,
    });
    this.dirty = false;
  }

  destroy(): void {
    cancelAnimationFrame(this.rafId);
    this.stopAnimation();
    this.resizeObserver.disconnect();
    this.input.destroy();
    this._scene?.detach?.();
    this._scene = null;
    this.renderer.dispose();
    this.events.removeAllListeners();
    this.keymap.clear();
    if (this.ownsCanvas) this.canvas.remove();
  }

  // ------------------------------------------------------------------ internals

  private loop(now: number): void {
    this.rafId = requestAnimationFrame(this.loop);

    if ((window.devicePixelRatio || 1) !== this.dpr) this.handleResize();

    if (this.animation) {
      const { from, to, start, duration, resolve } = this.animation;
      const t = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - t, 3);
      this.camera.setState(t >= 1 ? to : Camera.lerpState(from, to, eased));
      this.events.emit("camera:changed", this.camera.getState());
      if (t >= 1) {
        this.animation = null;
        resolve();
      }
      this.dirty = true;
    }

    if (this.dirty) this.renderNow();
  }

  private stopAnimation(): void {
    if (!this.animation) return;
    const { resolve } = this.animation;
    this.animation = null;
    resolve();
  }

  private getMinZoom(): number {
    const bounds = this._scene?.getBounds();
    if (!bounds || this._scene?.clampCamera === false) return this.camera.minZoom;
    const fit = this.camera.getFitZoom(this.viewWidth, this.viewHeight, bounds);
    return Math.max(this.camera.minZoom, Math.min(fit * this.minZoomFitRatio, 1));
  }

  private afterCameraChange(): void {
    const bounds = this._scene?.getBounds();
    if (bounds && this._scene?.clampCamera !== false) {
      this.camera.clamp(this.viewWidth, this.viewHeight, bounds);
    }
    // Keep hover info in sync with what's under the (stationary) pointer.
    if (this.pointer) this.updatePointer(this.pointer.inside ? this.pointer.local : null);
    this.events.emit("camera:changed", this.camera.getState());
    this.requestRender();
  }

  private handleResize(): void {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    if (width === this.viewWidth && height === this.viewHeight && dpr === this.dpr) return;

    const hadSize = this.viewWidth > 0 && this.viewHeight > 0;
    const center = hadSize ? this.camera.getCenter(this.viewWidth, this.viewHeight) : null;

    this.viewWidth = width;
    this.viewHeight = height;
    this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.round(width * dpr));
    this.canvas.height = Math.max(1, Math.round(height * dpr));

    if (width > 0 && height > 0) {
      if (!this.hasInitialFit) {
        const fit = this.computeFitState();
        if (fit) {
          this.camera.setState(fit);
          this.hasInitialFit = true;
        }
      } else if (center) {
        this.camera.centerOn(center.x, center.y, width, height);
      }
    }

    this.events.emit("resized", { width, height });
    // The fit/recentre above moved the camera: let zoom displays etc. know.
    this.events.emit("camera:changed", this.camera.getState());
    this.requestRender();
  }
}
