import type { HistoryManager, ToolManager } from "@foundry2d/core";
import {
  type CellBuffer,
  type Dimensions,
  type GridDocument,
  type GridLayer,
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
  type LayerRenderer,
  type LayerStackMode,
  type RenderContext,
  type RenderPass,
} from "@foundry2d/render";
import type { ScenePointerEvent, WorkspaceScene } from "../types";
import type { Workspace } from "../Workspace";

/**
 * Takes over pointer input from the grid tools, e.g. for object layers
 * (entities) whose editing is not cell-based. Receives hover moves too.
 */
export interface ScenePointerDelegate {
  onPointerDown(ev: ScenePointerEvent): void;
  onPointerMove(ev: ScenePointerEvent): void;
  onPointerUp(ev: ScenePointerEvent): void;
  onPointerCancel(): void;
  getCursor(): string;
}

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
  /** Per-layer value → color mapping; takes precedence over `colorize`. */
  getColorizer?: (layer: GridLayer<CellBuffer>) => CellColorizer | undefined;
  /** Custom per-layer drawing (e.g. tiles); see `LayerStackPass`. */
  getLayerRenderer?: (layer: GridLayer<CellBuffer>) => LayerRenderer | undefined;
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
  /** Mirror drawing flags passed to tools (see `ToolContext.mirror`). */
  getMirror?: () => { x: boolean; y: boolean };
  /** Extra passes drawn above everything else in the scene (selection, guides). */
  overlayPasses?: RenderPass[];
  /** Extra world passes drawn under the layers (e.g. onion skins of other frames). */
  underlayPasses?: RenderPass[];
  /** Draw the transparency checkerboard (default `true`). */
  checkerboard?: boolean;
  /** Returns a delegate while pointer input should bypass the grid tools. */
  getPointerDelegate?: () => ScenePointerDelegate | null;
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
  /** Delegate that received the current press, so it also gets the release. */
  private pressDelegate: ScenePointerDelegate | null = null;
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
      getColorizer: options.getColorizer,
      getLayerRenderer: options.getLayerRenderer,
      getPaletteVersion: options.getPaletteVersion,
      getClip: () => this.getBounds(),
    });
    this.gridPass = new GridLinesPass({
      getBounds: () =>
        this.isPreview || !(this.options.showGrid?.() ?? true) ? null : getBounds(),
      step: () => this.activeCellSize(),
      majorEvery: options.majorGridEvery,
    });

    this.passes = [
      ...(options.checkerboard === false
        ? []
        : [new CheckerboardPass({ getBounds, squareSize: Math.max(1, this.cellSize.width / 2) })]),
      ...(options.underlayPasses ?? []),
      this.layerPass,
      this.gridPass,
      new BoundsPass({ getBounds }),
      new CursorPass({ getShape: (rc) => this.getCursorShape(rc) }),
      ...(options.overlayPasses ?? []),
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

  /** World size of a cell of the active layer (its own grid, when it has one). */
  activeCellSize(): Dimensions {
    const scale = this.options.doc.getActiveLayer()?.scale ?? 1;
    return { width: this.cellSize.width * scale, height: this.cellSize.height * scale };
  }

  /** Pointer cells are cells of the active layer, so tools work in its grid. */
  worldToGrid(world: Position): Position {
    const cell = this.activeCellSize();
    return { x: Math.floor(world.x / cell.width), y: Math.floor(world.y / cell.height) };
  }

  getCursor(): string {
    if (this.isPreview) return "default";
    const delegate = this.options.getPointerDelegate?.();
    if (delegate) return delegate.getCursor();
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
    this.pressDelegate = null;
  }

  /** Call when an external setting (grid toggle, preview, palette) changes. */
  invalidate(): void {
    this.workspace?.refreshCursor();
    this.workspace?.requestRender();
  }

  onPointerDown(ev: ScenePointerEvent): void {
    if (this.isPreview) return;
    const delegate = this.options.getPointerDelegate?.();
    if (delegate) {
      this.pressDelegate = delegate;
      delegate.onPointerDown(ev);
      return;
    }
    const ctx = this.buildContext(ev.button === 2, ev);
    if (!ctx) return;
    this.isDrawing = true;
    ctx.isDrawing = true;
    this.options.tools.executePointerAction("down", ev.grid, ctx);
  }

  onPointerMove(ev: ScenePointerEvent): void {
    const delegate = this.pressDelegate ?? this.options.getPointerDelegate?.();
    if (delegate && !this.isPreview) {
      delegate.onPointerMove(ev);
      return;
    }
    if (!this.isDrawing) return;
    const ctx = this.buildContext(ev.native.buttons === 2, ev);
    if (!ctx) return;
    this.options.tools.executePointerAction("move", ev.grid, ctx);
  }

  onPointerUp(ev: ScenePointerEvent): void {
    if (this.pressDelegate) {
      const delegate = this.pressDelegate;
      this.pressDelegate = null;
      delegate.onPointerUp(ev);
      return;
    }
    if (!this.isDrawing) return;
    this.isDrawing = false;
    const ctx = this.buildContext(ev.button === 2, ev);
    if (!ctx) return;
    this.options.tools.executePointerAction("up", ev.grid, ctx);
  }

  onPointerCancel(): void {
    if (this.pressDelegate) {
      const delegate = this.pressDelegate;
      this.pressDelegate = null;
      delegate.onPointerCancel();
      return;
    }
    if (!this.isDrawing) return;
    this.isDrawing = false;
    const ctx = this.buildContext(false);
    if (ctx) this.options.tools.cancelStroke(ctx);
  }

  private buildContext(secondary: boolean, ev?: ScenePointerEvent): ToolContext<Buffer> | null {
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
      mirror: this.options.getMirror?.(),
      modifiers: ev
        ? { shift: ev.shiftKey, alt: ev.altKey, mod: ev.ctrlKey || ev.metaKey }
        : undefined,
    };
  }

  private getCursorShape(rc: RenderContext): CursorShape | null {
    if (this.isPreview || !rc.pointer || this.options.getPointerDelegate?.()) return null;
    const { doc, tools } = this.options;
    const tool = tools.activeTool;
    const { grid } = rc.pointer;
    const layer = doc.getActiveLayer();
    const cols = layer?.width ?? doc.width;
    const rows = layer?.height ?? doc.height;
    if (grid.x < 0 || grid.y < 0 || grid.x >= cols || grid.y >= rows) return null;

    const isBrush = tool === "pen" || tool === "eraser";
    const size = isBrush ? Math.max(1, this.options.getBrushSize?.() ?? 1) : 1;
    const half = Math.floor(size / 2);
    const origin: Position = { x: grid.x - half, y: grid.y - half };
    const { width: cw, height: ch } = this.activeCellSize();

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
