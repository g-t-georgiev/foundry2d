import type { Dimensions, Position, Rect } from "../types";

export interface CameraConfig {
  /** Size of one grid cell in world units. Pixel art: 1x1. Tilemaps: tile size in px. */
  cellSize?: Dimensions;
  /** Screen-space inset on the left/top edge reserved for UI such as rulers. */
  uiPadding?: number;
  /** Breathing room around content when fitting it to the view. */
  viewportPadding?: number;
  minZoom?: number;
  maxZoom?: number;
}

export interface CameraState {
  x: number;
  y: number;
  zoom: number;
}

/**
 * 2D camera mapping world units to CSS pixels of the viewport:
 * `local = world * zoom + offset`.
 *
 * All view sizes passed in are CSS pixels of the canvas element (not device
 * pixels); the renderer applies devicePixelRatio separately.
 */
export class Camera {
  public x = 0;
  public y = 0;
  public zoom = 1;
  public cellSize: Dimensions;
  public uiPadding: number;
  public viewportPadding: number;
  public minZoom: number;
  public maxZoom: number;

  constructor(config: CameraConfig = {}) {
    this.cellSize = config.cellSize ?? { width: 1, height: 1 };
    this.uiPadding = config.uiPadding ?? 24;
    this.viewportPadding = config.viewportPadding ?? 32;
    this.minZoom = config.minZoom ?? 0.05;
    this.maxZoom = config.maxZoom ?? 150;
  }

  // ---------------------------------------------------------------- mapping

  screenToWorld(screenX: number, screenY: number, canvasRect: { left: number; top: number }) {
    const localX = screenX - canvasRect.left;
    const localY = screenY - canvasRect.top;
    const { x: worldX, y: worldY } = this.localToWorld(localX, localY);
    return { localX, localY, worldX, worldY };
  }

  localToWorld(localX: number, localY: number): Position {
    return { x: (localX - this.x) / this.zoom, y: (localY - this.y) / this.zoom };
  }

  worldToLocal(worldX: number, worldY: number): Position {
    return { x: worldX * this.zoom + this.x, y: worldY * this.zoom + this.y };
  }

  worldToGrid(worldX: number, worldY: number): Position {
    return {
      x: Math.floor(worldX / this.cellSize.width),
      y: Math.floor(worldY / this.cellSize.height),
    };
  }

  gridToWorld(gridX: number, gridY: number): Position {
    return { x: gridX * this.cellSize.width, y: gridY * this.cellSize.height };
  }

  /** World-space rectangle currently visible (excluding the UI inset). */
  getVisibleWorldRect(viewWidth: number, viewHeight: number): Rect {
    const topLeft = this.localToWorld(this.uiPadding, this.uiPadding);
    const bottomRight = this.localToWorld(viewWidth, viewHeight);
    return {
      x: topLeft.x,
      y: topLeft.y,
      width: bottomRight.x - topLeft.x,
      height: bottomRight.y - topLeft.y,
    };
  }

  // ---------------------------------------------------------------- framing

  /** Zoom at which `bounds` fits inside the usable view area. */
  getFitZoom(viewWidth: number, viewHeight: number, bounds: Dimensions): number {
    if (!viewWidth || !viewHeight || !bounds.width || !bounds.height) return this.zoom;
    const availW = Math.max(1, viewWidth - this.uiPadding - this.viewportPadding * 2);
    const availH = Math.max(1, viewHeight - this.uiPadding - this.viewportPadding * 2);
    return Math.min(availW / bounds.width, availH / bounds.height);
  }

  /** Zooms and centers so that `bounds` (world units) fills the view. */
  fitToBounds(viewWidth: number, viewHeight: number, bounds: Rect): void {
    if (!viewWidth || !viewHeight || !bounds.width || !bounds.height) return;
    this.zoom = this.clampZoom(this.getFitZoom(viewWidth, viewHeight, bounds));
    this.centerOn(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2, viewWidth, viewHeight);
  }

  /** Convenience for grid documents anchored at the origin. */
  fitToView(viewWidth: number, viewHeight: number, cols: number, rows: number): void {
    this.fitToBounds(viewWidth, viewHeight, this.gridBounds(cols, rows));
  }

  /** Places world point at the center of the usable view area. */
  centerOn(worldX: number, worldY: number, viewWidth: number, viewHeight: number): void {
    const centerX = this.uiPadding + (viewWidth - this.uiPadding) / 2;
    const centerY = this.uiPadding + (viewHeight - this.uiPadding) / 2;
    this.x = centerX - worldX * this.zoom;
    this.y = centerY - worldY * this.zoom;
  }

  /** World point currently at the center of the usable view area. */
  getCenter(viewWidth: number, viewHeight: number): Position {
    return this.localToWorld(
      this.uiPadding + (viewWidth - this.uiPadding) / 2,
      this.uiPadding + (viewHeight - this.uiPadding) / 2
    );
  }

  // ---------------------------------------------------------------- movement

  moveBy(dx = 0, dy = 0): void {
    this.x += dx;
    this.y += dy;
  }

  clampZoom(zoom: number, minZoom = this.minZoom): number {
    return Math.max(minZoom, Math.min(zoom, this.maxZoom));
  }

  /** Zooms by `factor`, keeping the world point under the local (canvas) position fixed. */
  zoomAt(localX: number, localY: number, factor: number, minZoom = this.minZoom): void {
    const newZoom = this.clampZoom(this.zoom * factor, minZoom);
    if (newZoom === this.zoom) return;
    const world = this.localToWorld(localX, localY);
    this.zoom = newZoom;
    this.x = localX - world.x * newZoom;
    this.y = localY - world.y * newZoom;
  }

  /** Sets an absolute zoom around a local anchor (defaults to the view center). */
  setZoom(zoom: number, anchor: Position): void {
    this.zoomAt(anchor.x, anchor.y, zoom / this.zoom);
  }

  /**
   * Keeps at least `1 - overlapRatio` of the view showing some part of `bounds`,
   * so content can't be panned completely off-screen.
   */
  clamp(viewWidth: number, viewHeight: number, bounds: Rect, overlapRatio = 0.3): void {
    if (!viewWidth || !viewHeight) return;

    const left = bounds.x * this.zoom;
    const top = bounds.y * this.zoom;
    const width = bounds.width * this.zoom;
    const height = bounds.height * this.zoom;

    const marginX = (viewWidth - this.uiPadding) * (1 - overlapRatio);
    const marginY = (viewHeight - this.uiPadding) * (1 - overlapRatio);

    const minX = viewWidth - marginX - (left + width);
    const maxX = this.uiPadding + marginX - left;
    const minY = viewHeight - marginY - (top + height);
    const maxY = this.uiPadding + marginY - top;

    this.x = Math.min(maxX, Math.max(this.x, minX));
    this.y = Math.min(maxY, Math.max(this.y, minY));
  }

  // ---------------------------------------------------------------- state

  getState(): CameraState {
    return { x: this.x, y: this.y, zoom: this.zoom };
  }

  setState(state: CameraState): void {
    this.x = state.x;
    this.y = state.y;
    this.zoom = state.zoom;
  }

  /** Interpolates between two states. Zoom interpolates geometrically for a smooth feel. */
  static lerpState(from: CameraState, to: CameraState, t: number): CameraState {
    const zoom = from.zoom * Math.pow(to.zoom / from.zoom, t);
    return {
      zoom,
      x: from.x + (to.x - from.x) * t,
      y: from.y + (to.y - from.y) * t,
    };
  }

  gridBounds(cols: number, rows: number): Rect {
    return { x: 0, y: 0, width: cols * this.cellSize.width, height: rows * this.cellSize.height };
  }
}
