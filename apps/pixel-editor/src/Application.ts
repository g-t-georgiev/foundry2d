import {
  ClearCommand,
  EllipseTool,
  HistoryManager,
  LineTool,
  PixelUtils,
  RectangleTool,
  SelectTool,
  Selection,
  CompositeCommand,
  DrawCommand,
  SetSelectionCommand,
  clearRegionChanges,
  pasteRegionChanges,
  readRegion,
  type Region,
  ToolManager,
  type Storage,
  type Unsubscribe,
} from "@foundry2d/core";
import { LayerStackPass } from "@foundry2d/render";
import { GridDocumentScene, ProjectSession, Workspace, downloadBlob } from "@foundry2d/workspace";
import { ProjectBrowserEvents, type LayersPanel, type ProjectBrowser } from "@foundry2d/ui";
import type { ApplicationContext } from "./types";
import { ApplicationStateActions, applicationStore } from "./state";
import UIManager from "./ui/UIManager";
import LayersController from "./ui/LayersController";
import TimelineView from "./ui/TimelineView";
import AnimationPreview from "./ui/AnimationPreview";
import ExportDialog from "./ui/ExportDialog";
import { ExportController } from "./export/ExportController";
import PaletteView from "./ui/PaletteView";
import { MirrorGuidePass, SelectionPass } from "./ui/overlays";
import { PaletteFormatError, parsePaletteFile, toGplPalette, toHexPalette } from "./io/palette";
import { Sprite, type PixelDocument } from "./model/Sprite";
import {
  AddFrameCommand,
  MoveFrameCommand,
  RemoveFrameCommand,
  SetFrameDurationCommand,
  resizeAllFrames,
} from "./model/commands";
import { renderThumbnail } from "./io/thumbnail";
import {
  PROJECT_EXTENSION,
  ProjectFormatError,
  fromProjectFile,
  toProjectFile,
} from "./io/project";

export interface ApplicationElements {
  viewport: HTMLElement;
  canvas: HTMLCanvasElement;
  layersPanel: LayersPanel;
  projectBrowser: ProjectBrowser;
  timeline: HTMLElement;
  previewCanvas: HTMLCanvasElement;
  previewToggle: HTMLButtonElement | null;
  exportDialog: HTMLDialogElement;
  paletteRoot: HTMLElement;
}

const DEFAULT_NAME = "sprite";
const NEW_SIZES = [16, 32, 64, 128];
const ONION_ALPHA = 0.28;

/**
 * Composition root of the pixel editor.
 *
 * Ownership: pixels, layers, frames and undo history live in the model
 * (`Sprite` with one `GridDocument` per frame, `HistoryManager`); the store
 * only holds thin UI metadata (tool, color, pen size, toggles).
 */
export default class Application implements ApplicationContext {
  readonly sprite: Sprite;
  readonly history = new HistoryManager();
  readonly tools = new ToolManager<Uint32Array>();
  readonly workspace: Workspace;
  scene!: GridDocumentScene<Uint32Array>;
  readonly ui: UIManager;
  readonly layers: LayersController;
  readonly timeline: TimelineView;
  readonly preview: AnimationPreview;
  readonly exporter: ExportController;
  /** Rectangular selection shared by the select tool and clipboard actions. */
  readonly selection = new Selection();
  private readonly palette: PaletteView;
  /** Internal clipboard (pixels of the active layer). */
  private clipboard: Region | null = null;
  private readonly exportDialog: ExportDialog;
  readonly session: ProjectSession;
  private readonly browser: ProjectBrowser;
  private name = DEFAULT_NAME;
  /** True while a sprite is being loaded, so load-time events don't mark it dirty. */
  private loading = false;
  private docSubscriptions: Unsubscribe[] = [];
  private altHeld = false;

  constructor(elements: ApplicationElements, storage: Storage) {
    const { size } = applicationStore.getState().doc;
    this.sprite = Sprite.create(size.width, size.height);

    this.tools.registerTool(new LineTool<Uint32Array>("line"));
    this.tools.registerTool(new RectangleTool<Uint32Array>("rect", false));
    this.tools.registerTool(new EllipseTool<Uint32Array>("ellipse", false));
    this.tools.registerTool(new SelectTool<Uint32Array>(this.selection, "select"));

    this.workspace = new Workspace(elements.viewport, { canvas: elements.canvas });
    this.ui = new UIManager(this);
    this.layers = new LayersController(elements.layersPanel, this.sprite, this.history);
    this.timeline = new TimelineView(elements.timeline, {
      select: (index) => this.sprite.selectFrame(index),
      add: () => this.addFrame(false),
      duplicate: () => this.addFrame(true),
      remove: () => this.deleteFrame(),
      move: (direction) => this.moveFrame(direction),
      setDuration: (ms) => this.setFrameDuration(ms),
      setFps: (fps) => {
        this.sprite.setFps(fps);
      },
      setOnionSkin: (enabled) =>
        applicationStore.dispatch(ApplicationStateActions.ToggleOnionSkin, { enabled }),
    });
    this.preview = new AnimationPreview(
      elements.previewCanvas,
      this.sprite,
      elements.previewToggle
    );
    this.exporter = new ExportController(
      this.sprite,
      () => this.name,
      () => this.sprite.doc.activeLayerId
    );
    this.exportDialog = new ExportDialog(elements.exportDialog, this.exporter, (message) =>
      this.ui.showMessage(message, 3500)
    );
    this.palette = new PaletteView(elements.paletteRoot, {
      pick: (color) => applicationStore.dispatch(ApplicationStateActions.SetColor, { color }),
      add: () =>
        this.setPalette([...this.sprite.palette, applicationStore.getState().currentColor]),
      remove: (color) => this.setPalette(this.sprite.palette.filter((c) => c !== color)),
      import: (file) => void this.importPalette(file),
      export: (format) => this.exportPalette(format),
    });
    this.browser = elements.projectBrowser;
    this.session = new ProjectSession({
      app: "pixel",
      storage,
      titleSuffix: "Foundry2D Pixel Editor",
      fileType: {
        description: "Foundry2D sprite",
        mimeType: "application/json",
        extensions: [PROJECT_EXTENSION],
      },
      serialize: () => toProjectFile(this.sprite, this.name),
      getName: () => this.name,
      thumbnail: () => renderThumbnail(this.sprite.frames[0].doc),
      onChange: (state) =>
        this.ui.updateFileState(
          `${state.dirty ? "● " : ""}${state.fileName ?? (state.libraryId ? "browser library" : "not saved yet")}`
        ),
    });
    this.session.installUnloadGuard();
    this.ui.updateName(this.name);

    this.bindStore();
    this.bindSprite();
    this.bindWorkspace();
    this.bindKeys();
    this.bindBrowser();

    this.showFrame(true);
    this.session.refresh();
    void this.startup();
  }

  /** The frame document being edited. */
  get doc(): PixelDocument {
    return this.sprite.doc;
  }

  get spriteName(): string {
    return this.name;
  }

  // ------------------------------------------------------------------ frames

  /** Rebuilds the scene for the current frame; keeps the camera unless `fit`. */
  private showFrame(fit: boolean): void {
    this.workspace.input.cancelStroke();
    const sprite = this.sprite;
    const onion = (offset: -1 | 1) =>
      new LayerStackPass(
        {
          getSource: () => sprite.frames[sprite.currentIndex + offset]?.doc ?? null,
          cellSize: { width: 1, height: 1 },
          getMode: () => "composite",
          getAlpha: () => {
            const { onionSkin, preview } = applicationStore.getState().preferences;
            return onionSkin.enabled && !preview.enabled ? ONION_ALPHA : 0;
          },
        },
        offset < 0 ? "onion-prev" : "onion-next"
      );

    this.scene = new GridDocumentScene<Uint32Array>({
      doc: this.doc,
      tools: this.tools,
      history: this.history,
      getValue: () => applicationStore.getState().activeColorInt,
      getBrushSize: () => applicationStore.getState().penSize,
      getCursorFill: () => `${applicationStore.getState().currentColor}66`,
      onPickValue: (value) => this.pickColor(value),
      isPreview: () => applicationStore.getState().preferences.preview.enabled,
      showGrid: () => applicationStore.getState().preferences.grid.enabled,
      majorGridEvery: 8,
      underlayPasses: [onion(-1), onion(1)],
      getMirror: () => applicationStore.getState().preferences.mirror,
      overlayPasses: [
        new MirrorGuidePass(
          () => {
            const { mirror, preview } = applicationStore.getState().preferences;
            return preview.enabled ? { x: false, y: false } : mirror;
          },
          () => ({ width: this.sprite.width, height: this.sprite.height })
        ),
        new SelectionPass(this.selection),
      ],
    });
    const camera = fit ? undefined : this.workspace.camera.getState();
    void this.workspace.setScene(this.scene, { fit, camera });
    this.bindDocument();
  }

  addFrame(duplicate: boolean): void {
    const sprite = this.sprite;
    const frame = sprite.createFrame(duplicate ? sprite.currentIndex : null);
    this.history.execute(
      new AddFrameCommand(
        sprite,
        frame,
        sprite.currentIndex + 1,
        duplicate ? "Duplicate frame" : "Add frame"
      )
    );
  }

  deleteFrame(): void {
    const command = new RemoveFrameCommand(this.sprite, this.sprite.currentIndex);
    command.execute();
    if (command.succeeded) this.history.record(command);
    else this.ui.showMessage("A sprite needs at least one frame.");
  }

  moveFrame(direction: "left" | "right"): void {
    const from = this.sprite.currentIndex;
    const to = direction === "left" ? from - 1 : from + 1;
    if (to < 0 || to >= this.sprite.frames.length) return;
    this.history.execute(new MoveFrameCommand(this.sprite, from, to));
  }

  setFrameDuration(ms: number | null): void {
    const frame = this.sprite.current;
    if (frame.duration === ms) return;
    this.history.execute(new SetFrameDurationCommand(this.sprite, frame, ms));
  }

  // ------------------------------------------------------------------ files

  private confirmDiscard(action: string): boolean {
    return !this.session.state.dirty || confirm(`${action}? Unsaved changes will be lost.`);
  }

  /** Starts a new sprite of `size`×`size` (or the current size). */
  newDocument(size?: number): void {
    if (!this.confirmDiscard("Start a new sprite")) return;
    const width = size ?? this.sprite.width;
    const height = size ?? this.sprite.height;
    this.loadSprite(Sprite.create(width, height), DEFAULT_NAME);
    this.session.resetIdentity();
    this.ui.showMessage(`New ${width}×${height} sprite`);
  }

  private reportOpenError(error: unknown): void {
    const message =
      error instanceof ProjectFormatError
        ? error.message
        : error instanceof SyntaxError
          ? "File is not valid JSON."
          : error instanceof Error
            ? error.message
            : "Could not open the project.";
    this.ui.showMessage(message, 5000);
    console.error(error);
  }

  async openFile(): Promise<void> {
    if (!this.confirmDiscard("Open another sprite")) return;
    try {
      const picked = await this.session.pickFile();
      if (!picked) return;
      const { sprite, name } = fromProjectFile(picked.json);
      this.loadSprite(sprite, name || picked.name);
      await this.session.adoptFile(picked.name, picked.handle);
      this.ui.showMessage(`Opened ${picked.handle?.name ?? picked.name}`);
    } catch (error) {
      this.reportOpenError(error);
    }
  }

  async openRecent(id: string): Promise<void> {
    if (!this.confirmDiscard("Open another sprite")) return;
    try {
      const opened = await this.session.openRecent(id);
      if (!opened) {
        this.ui.showMessage("That file is no longer available.", 4000);
        return;
      }
      const { sprite, name } = fromProjectFile(opened.json);
      this.loadSprite(sprite, name || opened.name);
      await this.session.adoptFile(opened.name, opened.handle);
      this.ui.showMessage(`Opened ${opened.handle.name}`);
    } catch (error) {
      this.reportOpenError(error);
    }
  }

  async openFromLibrary(id: string): Promise<void> {
    if (!this.confirmDiscard("Open another sprite")) return;
    try {
      const opened = await this.session.openFromLibrary(id);
      if (!opened) {
        this.ui.showMessage("That sprite is no longer in this browser.", 4000);
        return;
      }
      const { sprite, name } = fromProjectFile(opened.json);
      this.loadSprite(sprite, name || opened.name);
      this.session.adoptLibrary(id);
      this.ui.showMessage(`Opened ${opened.name}`);
    } catch (error) {
      this.reportOpenError(error);
    }
  }

  rename(name: string): void {
    const clean = name.trim();
    if (!clean || clean === this.name) {
      this.ui.updateName(this.name);
      return;
    }
    this.name = clean;
    this.session.markDirty();
    this.session.refresh();
  }

  /** Ctrl+S: saves to the browser library and, if bound, back to the file. */
  async save(): Promise<void> {
    try {
      await this.session.save();
      const { fileName } = this.session.state;
      this.ui.showMessage(
        fileName ? `Saved to ${fileName} and the browser library` : "Saved in this browser"
      );
    } catch (error) {
      this.ui.showMessage(`Save failed: ${(error as Error).message}`, 5000);
      console.error(error);
    }
  }

  /** Ctrl+Shift+S: writes a file (picker where supported, download otherwise). */
  async saveAs(): Promise<void> {
    try {
      if (await this.session.saveAsFile()) {
        this.ui.showMessage(`Saved ${this.session.state.fileName ?? "a copy to Downloads"}`);
      }
    } catch (error) {
      this.ui.showMessage(`Save failed: ${(error as Error).message}`, 5000);
      console.error(error);
    }
  }

  /** Opens the start screen / Open dialog. */
  async showBrowser(): Promise<void> {
    const [library, recent] = await Promise.all([
      this.session.listLibrary(),
      this.session.listRecent(),
    ]);
    this.browser.show({
      title: "Sprites",
      templates: NEW_SIZES.map((size) => ({
        id: String(size),
        label: `${size} × ${size}`,
        description: "Empty sprite with one layer",
      })),
      library,
      recent,
      currentId: this.session.state.libraryId,
      warning:
        this.session.storage.kind === "memory"
          ? "Browser storage is unavailable (private mode?). Sprites saved here are lost on reload; use Save as."
          : undefined,
    });
  }

  private bindBrowser(): void {
    const browser = this.browser;
    browser.addEventListener(ProjectBrowserEvents.New, (ev) =>
      this.newDocument(Number(ev.detail.templateId) || undefined)
    );
    browser.addEventListener(ProjectBrowserEvents.OpenFile, () => void this.openFile());
    browser.addEventListener(
      ProjectBrowserEvents.OpenRecent,
      (ev) => void this.openRecent(ev.detail.id)
    );
    browser.addEventListener(
      ProjectBrowserEvents.OpenLibrary,
      (ev) => void this.openFromLibrary(ev.detail.id)
    );
    browser.addEventListener(ProjectBrowserEvents.DeleteLibrary, (ev) => {
      if (!confirm("Delete this sprite from the browser? Files on disk are not affected.")) return;
      void this.session.deleteFromLibrary(ev.detail.id).then(() => this.showBrowser());
    });
    browser.addEventListener(ProjectBrowserEvents.RemoveRecent, (ev) => {
      void this.session.removeRecent(ev.detail.id).then(() => this.showBrowser());
    });
  }

  // ------------------------------------------------------------------ editing

  /** Opens the export dialog. */
  openExport(): void {
    this.exportDialog.open();
  }

  /** Clears the active layer in the current frame. */
  clearLayer(): void {
    const layer = this.doc.getActiveLayer();
    if (!layer || !this.doc.getPolicy(layer.id).canDraw) {
      this.ui.showMessage("The active layer is hidden or locked.");
      return;
    }
    const rect = this.selection.rect;
    if (rect) {
      const changes = clearRegionChanges(layer, rect);
      if (changes.length)
        this.history.execute(new DrawCommand(this.doc, layer.id, changes, "Clear selection"));
      return;
    }
    const command = new ClearCommand(this.doc, layer.id);
    command.execute();
    if (!command.isNoop) this.history.record(command);
  }

  // ------------------------------------------------------------------ clipboard

  selectAll(): void {
    this.selection.set({ x: 0, y: 0, width: this.sprite.width, height: this.sprite.height });
  }

  deselect(): void {
    this.selection.set(null);
  }

  /** Copies the selection (or the whole layer) of the active layer. */
  copy(): boolean {
    const layer = this.doc.getActiveLayer();
    if (!layer) return false;
    const rect = this.selection.rect ?? { x: 0, y: 0, width: layer.width, height: layer.height };
    this.clipboard = readRegion(layer, rect);
    this.ui.showMessage(`Copied ${rect.width}×${rect.height} px`, 1500);
    return true;
  }

  cut(): void {
    const layer = this.doc.getActiveLayer();
    if (!layer || !this.copy()) return;
    if (!this.doc.getPolicy(layer.id).canDraw) return;
    const rect = this.selection.rect ?? { x: 0, y: 0, width: layer.width, height: layer.height };
    const changes = clearRegionChanges(layer, rect);
    if (changes.length) this.history.execute(new DrawCommand(this.doc, layer.id, changes, "Cut"));
  }

  /**
   * Pastes at the selection's top-left (or the top-left corner), selects the
   * pasted block and switches to the select tool so it can be dragged.
   */
  paste(): void {
    const layer = this.doc.getActiveLayer();
    const region = this.clipboard;
    if (!layer || !region) {
      this.ui.showMessage("Nothing to paste.");
      return;
    }
    if (!this.doc.getPolicy(layer.id).canDraw) {
      this.ui.showMessage("The active layer is hidden or locked.");
      return;
    }
    const at = this.selection.rect
      ? { x: this.selection.rect.x, y: this.selection.rect.y }
      : { x: 0, y: 0 };
    const target = { ...at, width: region.width, height: region.height };
    this.history.execute(
      new CompositeCommand(
        [
          new DrawCommand(this.doc, layer.id, pasteRegionChanges(layer, region, at), "Paste"),
          new SetSelectionCommand(this.selection, this.selection.rect, target),
        ],
        "Paste"
      )
    );
    applicationStore.dispatch(ApplicationStateActions.SetTool, "select");
  }

  // ------------------------------------------------------------------ palette

  private setPalette(colors: string[]): void {
    this.sprite.setPalette(colors);
  }

  private async importPalette(file: File): Promise<void> {
    try {
      const colors = parsePaletteFile(file.name, await file.text());
      this.setPalette(colors);
      this.ui.showMessage(`Imported ${colors.length} colours from ${file.name}`);
    } catch (error) {
      const message =
        error instanceof PaletteFormatError ? error.message : "Could not read the palette.";
      this.ui.showMessage(message, 5000);
      console.error(error);
    }
  }

  private exportPalette(format: "hex" | "gpl"): void {
    const colors = this.sprite.palette;
    const text = format === "hex" ? toHexPalette(colors) : toGplPalette(colors, this.name);
    downloadBlob(new Blob([text], { type: "text/plain" }), `${this.name}.${format}`);
    this.ui.showMessage(`Exported ${colors.length} colours as .${format}`);
  }

  private renderPalette(): void {
    this.palette.render(this.sprite.palette, applicationStore.getState().currentColor);
  }

  resizeDocument(width: number, height: number): void {
    if (width === this.sprite.width && height === this.sprite.height) return;
    this.history.execute(resizeAllFrames(this.sprite, width, height));
  }

  undo(): void {
    this.history.undo();
  }

  redo(): void {
    this.history.redo();
  }

  zoomBy(factor: number): void {
    this.workspace.zoomBy(factor);
  }

  fitToView(): void {
    void this.workspace.fitToView(200);
  }

  // ------------------------------------------------------------------ internals

  /** Swaps the sprite contents in place, so every subscriber keeps working. */
  private loadSprite(source: Sprite, name: string): void {
    this.loading = true;
    try {
      this.workspace.input.cancelStroke();
      this.selection.set(null);
      this.sprite.replaceWith(source);
      this.name = name;
      this.ui.updateName(name);
      this.history.clear();
    } finally {
      this.loading = false;
    }
    this.showFrame(true);
  }

  /** Restores unsaved work, or shows the start screen when there is saved work to pick from. */
  private async startup(): Promise<void> {
    const recovered = await this.session.loadRecovery();
    // Don't clobber work started before IndexedDB answered.
    if (recovered && !this.session.state.dirty) {
      try {
        const { sprite, name } = fromProjectFile(recovered.json);
        this.loadSprite(sprite, name);
        await this.session.adoptRecovered(recovered.snapshot);
        this.ui.showMessage("Restored unsaved work from the last session");
        return;
      } catch (error) {
        console.warn("Ignoring unreadable recovery snapshot", error);
      }
    }
    const [library, recent] = await Promise.all([
      this.session.listLibrary(),
      this.session.listRecent(),
    ]);
    if ((library.length > 0 || recent.length > 0) && !this.session.state.dirty) {
      await this.showBrowser();
    }
  }

  private pickColor(value: number): void {
    // Picking a fully transparent pixel keeps the current color.
    if (value >>> 24 !== 0) {
      applicationStore.dispatch(ApplicationStateActions.SetColor, {
        color: PixelUtils.uint32ToHex(value),
      });
    }
    if (!this.altHeld) this.returnToPreviousTool();
  }

  private returnToPreviousTool(): void {
    const { previousTool } = applicationStore.getState();
    applicationStore.dispatch(ApplicationStateActions.SetTool, previousTool);
  }

  private renderTimeline(): void {
    this.timeline.render(this.sprite, applicationStore.getState().preferences.onionSkin.enabled);
  }

  /** Store → engine. The store is the single source of truth for the active tool. */
  private bindStore(): void {
    this.tools.setTool(applicationStore.getState().currentTool);
    applicationStore.select(
      (s) => s.currentTool,
      (tool) => this.tools.setTool(tool)
    );
    const invalidate = () => this.scene.invalidate();
    applicationStore.select((s) => s.preferences.grid.enabled, invalidate);
    applicationStore.select((s) => s.preferences.preview.enabled, invalidate);
    applicationStore.select(
      (s) => s.preferences.onionSkin.enabled,
      () => {
        invalidate();
        this.renderTimeline();
      }
    );
    applicationStore.select((s) => s.penSize, invalidate);
    applicationStore.select(
      (s) => s.currentColor,
      () => {
        invalidate();
        this.renderPalette();
      }
    );
    applicationStore.select((s) => s.preferences.mirror, invalidate);
  }

  /** Sprite (frames) → scene, timeline, preview. */
  private bindSprite(): void {
    const { sprite, history } = this;
    sprite.events.on("frame:selected", () => {
      if (!this.loading) this.showFrame(false);
      this.renderTimeline();
      this.preview.invalidate();
    });
    sprite.events.on("frames:changed", () => {
      this.renderTimeline();
      this.preview.invalidate();
      this.scene?.invalidate();
    });
    sprite.events.on("settings:changed", () => {
      this.renderTimeline();
      this.preview.invalidate();
      if (!this.loading) this.session.markDirty();
    });

    sprite.events.on("palette:changed", () => {
      this.renderPalette();
      if (!this.loading) this.session.markDirty();
    });
    this.selection.events.on("changed", () => this.scene?.invalidate());
    this.renderPalette();

    history.onChange((state) => {
      this.ui.updateHistory(state);
      if (!this.loading) this.session.markDirty();
    });
    this.ui.updateHistory(history.getState());
    this.renderTimeline();
  }

  /** Current frame document → UI. Re-bound whenever another frame is shown. */
  private bindDocument(): void {
    this.docSubscriptions.forEach((unsubscribe) => unsubscribe());
    const doc = this.doc;
    const updateLayer = () => {
      this.ui.updateLayer(doc.getActiveLayer()?.name ?? "—");
      this.workspace.refreshCursor();
    };
    const pixelsChanged = () => {
      this.timeline.invalidateThumb(this.sprite.currentIndex);
      this.preview.invalidate();
    };
    const structureChanged = () => {
      updateLayer();
      this.timeline.invalidateThumb("all");
      this.preview.invalidate();
    };
    this.docSubscriptions = [
      doc.events.on("resized", ({ width, height }) => {
        const { size } = applicationStore.getState().doc;
        if (size.width !== width || size.height !== height) {
          applicationStore.dispatch(ApplicationStateActions.ResizeDocument, { width, height });
        }
        structureChanged();
        void this.workspace.fitToView();
      }),
      doc.events.on("layer:activated", updateLayer),
      doc.events.on("layer:updated", structureChanged),
      doc.events.on("layers:changed", structureChanged),
      doc.events.on("cells:changed", pixelsChanged),
    ];
    updateLayer();
    const { size } = applicationStore.getState().doc;
    if (size.width !== doc.width || size.height !== doc.height) {
      applicationStore.dispatch(ApplicationStateActions.ResizeDocument, {
        width: doc.width,
        height: doc.height,
      });
    }
  }

  private bindWorkspace(): void {
    this.workspace.events.on("pointer:move", ({ grid, inside }) => {
      const onCanvas =
        inside && grid.x >= 0 && grid.y >= 0 && grid.x < this.doc.width && grid.y < this.doc.height;
      this.ui.updatePointer(onCanvas ? grid : null);
    });
    this.workspace.events.on("camera:changed", ({ zoom }) => this.ui.updateZoom(zoom));
    this.ui.updateZoom(this.workspace.zoom);
  }

  private bindKeys(): void {
    const { keymap } = this.workspace;
    const setTool = (tool: string) => () =>
      void applicationStore.dispatch(ApplicationStateActions.SetTool, tool);
    const penSize = (delta: number) => () => {
      const size = Math.max(1, Math.min(32, applicationStore.getState().penSize + delta));
      applicationStore.dispatch(ApplicationStateActions.EditPen, { size });
    };
    const toggle =
      (
        action:
          | ApplicationStateActions.ToggleGrid
          | ApplicationStateActions.TogglePreview
          | ApplicationStateActions.ToggleOnionSkin
      ) =>
      () => {
        const { preferences } = applicationStore.getState();
        const enabled =
          action === ApplicationStateActions.ToggleGrid
            ? preferences.grid.enabled
            : action === ApplicationStateActions.TogglePreview
              ? preferences.preview.enabled
              : preferences.onionSkin.enabled;
        applicationStore.dispatch(action, { enabled: !enabled });
      };

    keymap.bind("mod+z", () => this.undo(), { repeat: true });
    keymap.bind("mod+shift+z", () => this.redo(), { repeat: true });
    keymap.bind("mod+y", () => this.redo(), { repeat: true });
    keymap.bind("mod+s", () => void this.save());
    keymap.bind("mod+shift+s", () => void this.saveAs());
    keymap.bind("mod+o", () => this.ui.runCommand("open"));
    keymap.bind("mod+e", () => this.openExport());
    keymap.bind("b", setTool("pen"));
    keymap.bind("p", setTool("pen"));
    keymap.bind("e", setTool("eraser"));
    keymap.bind("g", setTool("bucket"));
    keymap.bind("i", setTool("eyedropper"));
    keymap.bind("l", setTool("line"));
    keymap.bind("r", setTool("rect"));
    keymap.bind("c", setTool("ellipse"));
    keymap.bind("m", setTool("select"));
    keymap.bind("mod+a", () => this.selectAll());
    keymap.bind("mod+d", () => this.deselect());
    keymap.bind("mod+c", () => void this.copy());
    keymap.bind("mod+x", () => this.cut());
    keymap.bind("mod+v", () => this.paste());
    keymap.bind("escape", () => {
      if (!this.selection.rect) return false;
      this.deselect();
    });
    const toggleMirror = (axis: "x" | "y") => () => {
      const mirror = { ...applicationStore.getState().preferences.mirror };
      mirror[axis] = !mirror[axis];
      applicationStore.dispatch(ApplicationStateActions.SetMirror, mirror);
    };
    keymap.bind("shift+x", toggleMirror("x"));
    keymap.bind("shift+y", toggleMirror("y"));
    keymap.bind("[", penSize(-1), { repeat: true });
    keymap.bind("]", penSize(1), { repeat: true });
    keymap.bind("#", toggle(ApplicationStateActions.ToggleGrid));
    keymap.bind("alt+p", toggle(ApplicationStateActions.TogglePreview));
    keymap.bind("alt+o", toggle(ApplicationStateActions.ToggleOnionSkin));
    keymap.bind("f", () => this.fitToView());
    keymap.bind("+", () => this.zoomBy(1.25), { repeat: true });
    keymap.bind("=", () => this.zoomBy(1.25), { repeat: true });
    keymap.bind("-", () => this.zoomBy(0.8), { repeat: true });
    keymap.bind("delete", () => this.clearLayer());
    keymap.bind("n", () => this.layers.addLayer());
    // Frames.
    keymap.bind(",", () => this.sprite.selectFrame(this.sprite.currentIndex - 1), { repeat: true });
    keymap.bind(".", () => this.sprite.selectFrame(this.sprite.currentIndex + 1), { repeat: true });
    keymap.bind("shift+n", () => this.addFrame(false));
    keymap.bind("shift+d", () => this.addFrame(true));
    keymap.hold(
      "alt",
      () => {
        this.altHeld = true;
        applicationStore.dispatch(ApplicationStateActions.SetTool, "eyedropper");
      },
      () => {
        this.altHeld = false;
        if (applicationStore.getState().currentTool === "eyedropper") this.returnToPreviousTool();
      }
    );
  }
}
