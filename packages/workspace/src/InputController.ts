import type { Position } from "@foundry2d/core";
import type { Workspace } from "./Workspace";
import { normalizeKey, isTypingTarget } from "./Keymap";

export const MouseButton = {
  Primary: 0,
  Middle: 1,
  Secondary: 2,
} as const;

export interface InputOptions {
  /** Element receiving keyboard events. Defaults to `window`. */
  keyTarget?: Window | HTMLElement;
  /** Zoom speed per wheel delta pixel. */
  wheelZoomSpeed?: number;
}

/**
 * Translates DOM input into camera navigation and scene pointer events.
 *
 * Navigation built in: middle-drag or Space+drag pans, wheel zooms at the
 * pointer, Shift+wheel pans horizontally. Everything else goes to the scene.
 */
export class InputController {
  /** When set (e.g. a hand tool), primary-button drags pan instead of reaching the scene. */
  public panMode = false;

  private panning: { pointerId: number; last: Position } | null = null;
  private scenePointerId: number | null = null;
  private spaceHeld = false;
  private readonly keyTarget: Window | HTMLElement;
  private readonly wheelZoomSpeed: number;
  private readonly abort = new AbortController();

  constructor(
    private readonly workspace: Workspace,
    private readonly canvas: HTMLCanvasElement,
    options: InputOptions = {}
  ) {
    this.keyTarget = options.keyTarget ?? window;
    this.wheelZoomSpeed = options.wheelZoomSpeed ?? 0.0015;
    this.attach();
  }

  get isPanning(): boolean {
    return this.panning !== null;
  }

  /** Whether a primary-button drag would pan right now. */
  get wantsPan(): boolean {
    return this.panMode || this.spaceHeld;
  }

  destroy(): void {
    this.abort.abort();
  }

  private attach(): void {
    const signal = this.abort.signal;
    const canvas = this.canvas;

    canvas.style.touchAction = "none";
    canvas.addEventListener("pointerdown", (ev) => this.onPointerDown(ev), { signal });
    canvas.addEventListener("pointermove", (ev) => this.onPointerMove(ev), { signal });
    canvas.addEventListener("pointerup", (ev) => this.onPointerUp(ev), { signal });
    canvas.addEventListener("pointercancel", (ev) => this.onPointerCancel(ev), { signal });
    canvas.addEventListener("pointerleave", () => this.workspace.updatePointer(null), { signal });
    canvas.addEventListener("wheel", (ev) => this.onWheel(ev), { passive: false, signal });
    canvas.addEventListener("dblclick", (ev) => this.onDoubleClick(ev), { signal });
    canvas.addEventListener("contextmenu", (ev) => ev.preventDefault(), { signal });

    const keyTarget = this.keyTarget as HTMLElement;
    keyTarget.addEventListener("keydown", (ev: KeyboardEvent) => this.onKeyDown(ev), { signal });
    keyTarget.addEventListener("keyup", (ev: KeyboardEvent) => this.onKeyUp(ev), { signal });
    window.addEventListener("blur", () => this.onBlur(), { signal });
  }

  /**
   * Pointer capture throws for pointers that are no longer active (e.g. a pen
   * lifted between events). Losing capture is harmless; a throw here would
   * leave the stroke state stuck and block all further input.
   */
  private capture(pointerId: number): void {
    try {
      this.canvas.setPointerCapture(pointerId);
    } catch {
      // Ignored: see above.
    }
  }

  private localPosition(ev: { clientX: number; clientY: number }): Position {
    const rect = this.canvas.getBoundingClientRect();
    return { x: ev.clientX - rect.left, y: ev.clientY - rect.top };
  }

  private onPointerDown(ev: PointerEvent): void {
    this.canvas.focus({ preventScroll: true });
    const local = this.localPosition(ev);
    this.workspace.updatePointer(local);

    const pan =
      ev.button === MouseButton.Middle || (ev.button === MouseButton.Primary && this.wantsPan);
    if (pan) {
      ev.preventDefault();
      this.panning = { pointerId: ev.pointerId, last: { x: ev.clientX, y: ev.clientY } };
      this.capture(ev.pointerId);
      this.workspace.refreshCursor();
      return;
    }

    // One scene stroke at a time.
    if (this.scenePointerId !== null) return;
    if (ev.button !== MouseButton.Primary && ev.button !== MouseButton.Secondary) return;

    this.scenePointerId = ev.pointerId;
    this.capture(ev.pointerId);
    this.workspace.scene?.onPointerDown?.(this.workspace.toScenePointer(ev, local));
  }

  private onPointerMove(ev: PointerEvent): void {
    const local = this.localPosition(ev);
    this.workspace.updatePointer(local);

    if (this.panning && ev.pointerId === this.panning.pointerId) {
      this.workspace.panBy(ev.clientX - this.panning.last.x, ev.clientY - this.panning.last.y);
      this.panning.last = { x: ev.clientX, y: ev.clientY };
      return;
    }

    if (this.scenePointerId === null || ev.pointerId === this.scenePointerId) {
      // Coalesced events give smooth strokes when the pointer moves fast.
      const events = this.scenePointerId !== null ? (ev.getCoalescedEvents?.() ?? []) : [];
      const scene = this.workspace.scene;
      if (events.length > 1) {
        for (const sub of events) {
          scene?.onPointerMove?.(this.workspace.toScenePointer(sub, this.localPosition(sub)));
        }
      } else {
        scene?.onPointerMove?.(this.workspace.toScenePointer(ev, local));
      }
    }
  }

  private onPointerUp(ev: PointerEvent): void {
    if (this.canvas.hasPointerCapture(ev.pointerId)) {
      this.canvas.releasePointerCapture(ev.pointerId);
    }

    if (this.panning && ev.pointerId === this.panning.pointerId) {
      this.panning = null;
      this.workspace.refreshCursor();
      return;
    }

    if (ev.pointerId === this.scenePointerId) {
      this.scenePointerId = null;
      this.workspace.scene?.onPointerUp?.(
        this.workspace.toScenePointer(ev, this.localPosition(ev))
      );
    }
  }

  private onPointerCancel(ev: PointerEvent): void {
    if (this.panning?.pointerId === ev.pointerId) this.panning = null;
    if (ev.pointerId === this.scenePointerId) this.cancelStroke();
    this.workspace.refreshCursor();
  }

  /** Interrupts the current scene stroke, if any. */
  cancelStroke(): void {
    if (this.scenePointerId === null) return;
    if (this.canvas.hasPointerCapture(this.scenePointerId)) {
      this.canvas.releasePointerCapture(this.scenePointerId);
    }
    this.scenePointerId = null;
    this.workspace.scene?.onPointerCancel?.();
  }

  private onDoubleClick(ev: MouseEvent): void {
    const local = this.localPosition(ev);
    this.workspace.scene?.onDoubleClick?.(this.workspace.toScenePointer(ev, local));
  }

  private onWheel(ev: WheelEvent): void {
    ev.preventDefault();
    const local = this.localPosition(ev);
    // Normalize line/page delta modes to pixels.
    const unit = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? this.canvas.clientHeight : 1;

    if (ev.shiftKey && !ev.ctrlKey) {
      this.workspace.panBy(-(ev.deltaY || ev.deltaX) * unit, 0);
      return;
    }

    const delta = Math.max(-300, Math.min(300, ev.deltaY * unit));
    const factor = Math.exp(-delta * this.wheelZoomSpeed * (ev.ctrlKey ? 3 : 1));
    this.workspace.zoomAtLocal(local.x, local.y, factor);
  }

  private onKeyDown(ev: KeyboardEvent): void {
    if (isTypingTarget(ev.target)) return;

    if (normalizeKey(ev.key) === "space") {
      ev.preventDefault();
      if (!this.spaceHeld) {
        this.spaceHeld = true;
        this.workspace.refreshCursor();
      }
      return;
    }

    if (normalizeKey(ev.key) === "escape" && this.scenePointerId !== null) {
      this.cancelStroke();
      ev.preventDefault();
      return;
    }

    this.workspace.keymap.handleKeyDown(ev);
  }

  private onKeyUp(ev: KeyboardEvent): void {
    if (normalizeKey(ev.key) === "space" && this.spaceHeld) {
      this.spaceHeld = false;
      this.workspace.refreshCursor();
    }
    this.workspace.keymap.handleKeyUp(ev);
  }

  private onBlur(): void {
    this.spaceHeld = false;
    this.panning = null;
    this.cancelStroke();
    this.workspace.keymap.releaseAll();
    this.workspace.refreshCursor();
  }
}
