import type { LevelProject } from "../model/LevelProject";
import { tilesetGrid, type TileSelection } from "../model/tiles";
import type { TilesetDef } from "../model/types";

/**
 * Tile picker: shows a tileset image with its grid; click picks one tile,
 * drag picks a rectangular stamp. Pure view: selections are reported through
 * `onSelect`, and `render` draws whatever the app says is selected.
 */
export default class TilesetPickerView {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private tileset: TilesetDef | undefined;
  private project: LevelProject | null = null;
  private selection: TileSelection | null = null;
  private scale = 1;
  private drag: { x: number; y: number } | null = null;

  constructor(
    private readonly container: HTMLElement,
    private readonly onSelect: (tileset: TilesetDef, selection: TileSelection) => void
  ) {
    this.canvas = document.createElement("canvas");
    this.canvas.className = "tileset-canvas";
    this.canvas.setAttribute("role", "img");
    this.canvas.setAttribute("aria-label", "Tileset; click or drag to select tiles");
    this.ctx = this.canvas.getContext("2d")!;
    container.append(this.canvas);

    this.canvas.addEventListener("pointerdown", (ev) => {
      const cell = this.cellAt(ev);
      if (!cell) return;
      try {
        this.canvas.setPointerCapture(ev.pointerId);
      } catch {
        // The pointer is gone already; dragging still works without capture.
      }
      this.drag = cell;
      this.emit(cell, cell);
    });
    this.canvas.addEventListener("pointermove", (ev) => {
      if (!this.drag) return;
      const cell = this.cellAt(ev, true);
      if (cell) this.emit(this.drag, cell);
    });
    const end = () => {
      this.drag = null;
    };
    this.canvas.addEventListener("pointerup", end);
    this.canvas.addEventListener("pointercancel", end);
    new ResizeObserver(() => this.draw()).observe(container);
  }

  render(
    project: LevelProject,
    tileset: TilesetDef | undefined,
    selection: TileSelection | null
  ): void {
    this.project = project;
    this.tileset = tileset;
    this.selection = selection;
    this.draw();
  }

  /** Redraws (e.g. once the tileset image finished loading). */
  draw(): void {
    const { tileset, project, ctx, canvas } = this;
    if (!tileset || !project) {
      canvas.hidden = true;
      return;
    }
    canvas.hidden = false;
    const image = project.getTilesetImage(tileset);
    const available = Math.max(1, this.container.clientWidth);
    const { width, height } = tileset.image;
    // Integer upscaling keeps pixels crisp; large sheets shrink to fit.
    this.scale =
      width <= available
        ? Math.max(1, Math.min(4, Math.floor(available / width)))
        : available / width;
    const dpr = window.devicePixelRatio || 1;
    canvas.style.width = `${width * this.scale}px`;
    canvas.style.height = `${height * this.scale}px`;
    canvas.width = Math.round(width * this.scale * dpr);
    canvas.height = Math.round(height * this.scale * dpr);

    ctx.setTransform(dpr * this.scale, 0, 0, dpr * this.scale, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, width, height);
    if (image) ctx.drawImage(image, 0, 0);

    // Grid.
    const { columns, rows } = tilesetGrid(tileset);
    const step = tileset.tileSize + tileset.spacing;
    ctx.lineWidth = 1 / this.scale;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.18)";
    ctx.beginPath();
    for (let c = 0; c <= columns; c++) {
      const x = tileset.padding + c * step - (c === columns ? tileset.spacing : 0);
      ctx.moveTo(x, tileset.padding);
      ctx.lineTo(x, tileset.padding + rows * step - tileset.spacing);
    }
    for (let r = 0; r <= rows; r++) {
      const y = tileset.padding + r * step - (r === rows ? tileset.spacing : 0);
      ctx.moveTo(tileset.padding, y);
      ctx.lineTo(tileset.padding + columns * step - tileset.spacing, y);
    }
    ctx.stroke();

    const sel = this.selection;
    if (sel) {
      ctx.lineWidth = 2 / this.scale;
      ctx.strokeStyle = "#38bdf8";
      ctx.fillStyle = "rgba(56, 189, 248, 0.2)";
      const x = tileset.padding + sel.x * step;
      const y = tileset.padding + sel.y * step;
      const w = sel.width * step - tileset.spacing;
      const h = sel.height * step - tileset.spacing;
      ctx.fillRect(x, y, w, h);
      ctx.strokeRect(x, y, w, h);
    }
  }

  private cellAt(ev: PointerEvent, clamp = false): { x: number; y: number } | null {
    const tileset = this.tileset;
    if (!tileset) return null;
    const rect = this.canvas.getBoundingClientRect();
    const px = (ev.clientX - rect.left) / this.scale - tileset.padding;
    const py = (ev.clientY - rect.top) / this.scale - tileset.padding;
    const step = tileset.tileSize + tileset.spacing;
    const { columns, rows } = tilesetGrid(tileset);
    let x = Math.floor(px / step);
    let y = Math.floor(py / step);
    if (clamp) {
      x = Math.max(0, Math.min(columns - 1, x));
      y = Math.max(0, Math.min(rows - 1, y));
    } else if (x < 0 || y < 0 || x >= columns || y >= rows) {
      return null;
    }
    return { x, y };
  }

  private emit(a: { x: number; y: number }, b: { x: number; y: number }): void {
    if (!this.tileset) return;
    this.onSelect(this.tileset, {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      width: Math.abs(a.x - b.x) + 1,
      height: Math.abs(a.y - b.y) + 1,
    });
  }
}
