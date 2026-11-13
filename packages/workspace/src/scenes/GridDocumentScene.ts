import type { HistoryManager, ToolManager } from "@foundry2d/core";
import {
  type CellBuffer,
  type Dimensions,
  type GridDocument,
  type Position,
  type Rect,
  type ToolContext,
  type Unsubscribe,
} from "@foundry2d/core";
import {
  BoundsPass,
  CheckerboardPass,
  CursorPass,
  GridLinesPass,
  LayerStackPass,
  type CellColorizer,
  type CursorShape,
  type LayerStackMode,
  type RenderContext,
  type RenderPass,
} from "@foundry2d/render";
import type { ScenePointerEvent, WorkspaceScene } from "../types";
import type { Workspace } from "../Workspace";

export interface GridDocumentSceneOptions<Buffer extends CellBuffer> {
  doc: GridDocument<Buffer>;
  tools: ToolManager<Buffer>;
  history: HistoryManager;
  /** World size of one cell. Pixel art: 1x1; tilemaps: the tile size. */
  cellSize?: Dimensions;
  /** Value drawn by the pen/bucket. */
  getValue: () => number;
  /** Value drawn with the secondary (right) mouse button. Defaults to the empty value (erase). */
  getSecondaryValue?: () => number;
  getBrushSize?: () => number;
  /** Called by the eyedropper. */
  onPickValue?: (value: number) => void;
  /** Value → color for id layers; omit for RGBA documents. */
  colorize?: CellColorizer;
  getPaletteVersion?: () => number;
  /** CSS color for the brush preview fill. */
  getCursorFill?: () => string | null;
  /** Read-only mode: shows the composite and ignores editing input. */
  isPreview?: () => boolean;
  /** Layer display mode while editing (default "focus"). */
  getLayerMode?: () => LayerStackMode;
  showGrid?: () => boolean;
  /** Grid lines drawn every N cells with the major color (e.g. 8 for pixel art blocks). */
  majorGridEvery?: number;
  /** Draw the transparency checkerboard (default `true`). */
  checkerboard?: boolean;
}

/**
 * Edits a single `GridDocument` with a `ToolManager`. Used directly by the
 * pixel editor and by the level designer's level view.
 */
export class GridDocumentScene<Buffer extends CellBuffer = CellBuffer> implements WorkspaceScene {
  readonly cellSize: Dimensions;
  private workspace: Workspace | null = null;
  private subscriptions: Unsubscribe[] = [];
  private isDrawing = false;
  private readonly passes: RenderPass[];

  readonly layerPass: LayerStackPass;
  readonly gridPass: GridLinesPass;

  constructor(private readonly options: GridDocumentSceneOptions<Buffer>) {
    this.cellSize = options.cellSize ?? { width: 1, height: 1 };
    const getBounds = () => this.getBounds();

    this.layerPass = new LayerStackPass({
      getSource: () => this.options.doc,
      cellSize: this.cellSize,
      getMode: () => (this.isPreview ? "composite" : (this.options.getLayerMode?.() ?? "focus")),
      colorize: options.colorize,
      getPaletteVersion: options.getPaletteVersion,
    });
    this.gridPass = new GridLinesPass({
      getBounds: () =>
        this.isPreview || !(this.options.showGrid?.() ?? true) ? null : getBounds(),
      step: this.cellSize,
      majorEvery: options.majorGridEvery,
    });

    this.passes = [
      ...(options.checkerboard === false
        ? []
        : [new CheckerboardPass({ getBounds, squareSize: Math.max(1, this.cellSize.width / 2) })]),
      this.layerPass,
      this.gridPass,
      new BoundsPass({ getBounds }),
      new CursorPass({ getShape: (rc) => this.getCursorShape(rc) }),
    ];
  }

  get doc(): GridDocument<Buffer> {
    return this.options.doc;
  }

  get isPreview(): boolean {
    return this.options.isPreview?.() ?? false;
  }

  getBounds(): Rect {
    const { doc } = this.options;
    return {
      x: 0,
      y: 0,
      width: doc.width * this.cellSize.width,
      height: doc.height * this.cellSize.height,
    };
  }

  getPasses(): RenderPass[] {
    return this.passes;
  }

  getCursor(): string {
    if (this.isPreview) return "default";
    const tool = this.options.tools.getActiveTool();
    if (tool?.modifiesLayer && !this.options.doc.getPolicy().canDraw) return "not-allowed";
    return tool?.cursor ?? "crosshair";
  }

  attach(workspace: Workspace): void {
    this.workspace = workspace;
    const rerender = () => workspace.requestRender();
    const layerStateChanged = () => {
      workspace.refreshCursor();
      rerender();
    };
    const { doc, history, tools } = this.options;
    this.subscriptions = [
      doc.events.on("cells:changed", rerender),
      doc.events.on("layers:changed", layerStateChanged),
      doc.events.on("layer:updated", layerStateChanged),
      doc.events.on("layer:activated", layerStateChanged),
      doc.events.on("resized", rerender),
      history.onChange(rerender),
      tools.onChange(() => {
        workspace.refreshCursor();
        rerender();
      }),
    ];
  }

  detach(): void {
    for (const unsubscribe of this.subscriptions) unsubscribe();
    this.subscriptions = [];
    this.workspace = null;
    this.isDrawing = false;
  }

  /** Call when an external setting (grid toggle, preview, palette) changes. */
  invalidate(): void {
    this.workspace?.refreshCursor();
    this.workspace?.requestRender();
  }

  onPointerDown(ev: ScenePointerEvent): void {
    if (this.isPreview) return;
    const ctx = this.buildContext(ev.button === 2);
    if (!ctx) return;
    this.isDrawing = true;
    ctx.isDrawing = true;
    this.options.tools.executePointerAction("down", ev.grid, ctx);
  }

  onPointerMove(ev: ScenePointerEvent): void {
    if (!this.isDrawing) return;
    const ctx = this.buildContext(ev.native.buttons === 2);
    if (!ctx) return;
    this.options.tools.executePointerAction("move", ev.grid, ctx);
  }

  onPointerUp(ev: ScenePointerEvent): void {
    if (!this.isDrawing) return;
    this.isDrawing = false;
    const ctx = this.buildContext(ev.button === 2);
    if (!ctx) return;
    this.options.tools.executePointerAction("up", ev.grid, ctx);
  }

  onPointerCancel(): void {
    if (!this.isDrawing) return;
    this.isDrawing = false;
    const ctx = this.buildContext(false);
    if (ctx) this.options.tools.cancelStroke(ctx);
  }

  private buildContext(secondary: boolean): ToolContext<Buffer> | null {
    const { doc, history } = this.options;
    const layer = doc.getActiveLayer();
    if (!layer) return null;
    const value = secondary
      ? (this.options.getSecondaryValue?.() ?? doc.emptyValue)
      : this.options.getValue();
    return {
      doc,
      layer,
      history,
      value,
      size: this.options.getBrushSize?.() ?? 1,
      isDrawing: this.isDrawing,
      onPickValue: this.options.onPickValue,
    };
  }

  private getCursorShape(rc: RenderContext): CursorShape | null {
    if (this.isPreview || !rc.pointer) return null;
    const { doc, tools } = this.options;
    const tool = tools.activeTool;
    const { grid } = rc.pointer;
    if (grid.x < 0 || grid.y < 0 || grid.x >= doc.width || grid.y >= doc.height) return null;

    const isBrush = tool === "pen" || tool === "eraser";
    const size = isBrush ? Math.max(1, this.options.getBrushSize?.() ?? 1) : 1;
    const half = Math.floor(size / 2);
    const origin: Position = { x: grid.x - half, y: grid.y - half };
    const { width: cw, height: ch } = this.cellSize;

    const editable = doc.getActiveLayer()?.isEditable ?? false;
    let fill: string | undefined;
    if (!editable && tools.getActiveTool()?.modifiesLayer) fill = "rgba(255, 60, 60, 0.25)";
    else if (tool === "eraser") fill = rc.theme.cursorEraseFill;
    else if (tool === "pen") fill = this.options.getCursorFill?.() ?? undefined;

    return {
      x: origin.x * cw,
      y: origin.y * ch,
      width: size * cw,
      height: size * ch,
      fill,
    };
  }
}
