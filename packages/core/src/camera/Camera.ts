export interface CameraConfig {
  cellSize?: { width: number; height: number };
  uiPadding?: number;
  viewportPadding?: number;
}

export class Camera {
  public x: number = 0;
  public y: number = 0;
  public zoom: number = 1.0;
  public cellSize: { width: number; height: number };
  public uiPadding: number;
  public viewportPadding: number;

  constructor(config: CameraConfig = {}) {
    this.cellSize = config.cellSize || { width: 1, height: 1 };
    this.uiPadding = config.uiPadding ?? 24;
    this.viewportPadding = config.viewportPadding ?? 32;
  }

  screenToWorld(screenX: number, screenY: number, canvasRect: DOMRect) {
    const localX = screenX - canvasRect.left;
    const localY = screenY - canvasRect.top;
    const worldX = (localX - this.x) / this.zoom;
    const worldY = (localY - this.y) / this.zoom;
    return { localX, localY, worldX, worldY };
  }

  worldToGrid(worldX: number, worldY: number) {
    return {
      x: Math.floor(worldX / this.cellSize.width),
      y: Math.floor(worldY / this.cellSize.height),
    };
  }

  gridToWorld(gridX: number, gridY: number) {
    return {
      x: gridX * this.cellSize.width,
      y: gridY * this.cellSize.height,
    };
  }

  moveBy(dx?: number, dy?: number) {
    if (dx) this.x += dx;
    if (dy) this.y += dy;
  }

  clamp(canvasWidth: number, canvasHeight: number, docCols: number, docRows: number) {
    const totalPixelWidth = docCols * this.cellSize.width * this.zoom;
    const totalPixelHeight = docRows * this.cellSize.height * this.zoom;

    const overlapRatio = 0.3;
    const marginX = (canvasWidth - this.uiPadding) * (1 - overlapRatio);
    const marginY = (canvasHeight - this.uiPadding) * (1 - overlapRatio);

    const minX = -totalPixelWidth + (canvasWidth - marginX);
    const maxX = this.uiPadding + marginX;
    const minY = -totalPixelHeight + (canvasHeight - marginY);
    const maxY = this.uiPadding + marginY;

    this.x = Math.min(maxX, Math.max(this.x, minX));
    this.y = Math.min(maxY, Math.max(this.y, minY));
  }
}
