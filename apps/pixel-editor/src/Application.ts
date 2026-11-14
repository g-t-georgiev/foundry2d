import {
  ClearCommand,
  GridDocument,
  HistoryManager,
  PixelUtils,
  ResizeCommand,
  ToolManager,
  type Storage,
} from "@foundry2d/core";
import { GridDocumentScene, ProjectSession, Workspace } from "@foundry2d/workspace";
import { ProjectBrowserEvents, type LayersPanel, type ProjectBrowser } from "@foundry2d/ui";
import type { ApplicationContext } from "./types";
import { ApplicationStateActions, applicationStore } from "./state";
import UIManager from "./ui/UIManager";
import LayersController from "./ui/LayersController";
import { exportPng, renderThumbnail } from "./io/exportPng";
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
}

const DEFAULT_NAME = "sprite";
const NEW_SIZES = [16, 32, 64, 128];

/**
 * Composition root of the pixel editor.
 *
 * Ownership: cell data, layers and undo history live in core objects
 * (`GridDocument`, `HistoryManager`); the store only holds thin UI metadata
 * (tool, color, pen size, toggles, mirrored document size).
 */
export default class Application implements ApplicationContext {
  readonly doc: GridDocument<Uint32Array>;
  readonly history = new HistoryManager();
  readonly tools = new ToolManager<Uint32Array>();
  readonly workspace: Workspace;
  readonly scene: GridDocumentScene<Uint32Array>;
  readonly ui: UIManager;
  readonly layers: LayersController;
  readonly session: ProjectSession;
  private readonly browser: ProjectBrowser;
  private name = DEFAULT_NAME;
  /** True while a document is being loaded, so load-time events don't mark it dirty. */
  private loading = false;

  constructor(elements: ApplicationElements, storage: Storage) {
    const { size } = applicationStore.getState().doc;
    this.doc = Application.createDocument(size.width, size.height);

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
    });

    this.workspace = new Workspace(elements.viewport, { canvas: elements.canvas });
    this.ui = new UIManager(this);
    this.layers = new LayersController(elements.layersPanel, this.doc, this.history);
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
      serialize: () => toProjectFile(this.doc, this.name),
      getName: () => this.name,
      thumbnail: () => renderThumbnail(this.doc),
      onChange: (state) =>
        this.ui.updateFileState(
          `${state.dirty ? "● " : ""}${state.fileName ?? (state.libraryId ? "browser library" : "not saved yet")}`
        ),
    });
    this.session.installUnloadGuard();
    this.ui.updateName(this.name);

    this.bindStore();
    this.bindDocument();
    this.bindWorkspace();
    this.bindKeys();

    this.bindBrowser();

    void this.workspace.setScene(this.scene);
    this.session.refresh();
    void this.startup();
  }

  static createDocument(width: number, height: number): GridDocument<Uint32Array> {
    const doc = new GridDocument<Uint32Array>({
      width,
      height,
      emptyValue: 0x00000000,
      bufferCtor: Uint32Array,
    });
    doc.addLayer("Layer 1");
    return doc;
  }

  // ------------------------------------------------------------------ commands

  private confirmDiscard(action: string): boolean {
    return !this.session.state.dirty || confirm(`${action}? Unsaved changes will be lost.`);
  }

  /** Starts a new sprite of `size`×`size` (or the current size). */
  newDocument(size?: number): void {
    if (!this.confirmDiscard("Start a new sprite")) return;
    const width = size ?? this.doc.width;
    const height = size ?? this.doc.height;
    this.loadDocument(Application.createDocument(width, height), DEFAULT_NAME);
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
      const { doc, name } = fromProjectFile(picked.json);
      this.loadDocument(doc, name || picked.name);
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
      const { doc, name } = fromProjectFile(opened.json);
      this.loadDocument(doc, name || opened.name);
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
      const { doc, name } = fromProjectFile(opened.json);
      this.loadDocument(doc, name || opened.name);
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

  async exportPNG(scale: number): Promise<void> {
    await exportPng(this.doc, this.name, scale);
    this.ui.showMessage(`Exported PNG at ${scale}×`);
  }

  clearLayer(): void {
    const layer = this.doc.getActiveLayer();
    if (!layer || !this.doc.getPolicy(layer.id).canDraw) {
      this.ui.showMessage("The active layer is hidden or locked.");
      return;
    }
    const command = new ClearCommand(this.doc, layer.id);
    command.execute();
    if (!command.isNoop) this.history.record(command);
  }

  resizeDocument(width: number, height: number): void {
    if (width === this.doc.width && height === this.doc.height) return;
    this.history.execute(new ResizeCommand(this.doc, { width, height }));
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

  /** Swaps document contents in place, so every subscriber keeps working. */
  private loadDocument(source: GridDocument<Uint32Array>, name: string): void {
    this.loading = true;
    try {
      this.workspace.input.cancelStroke();
      this.doc.replaceWith(source);
      this.name = name;
      this.ui.updateName(name);
      this.history.clear();
    } finally {
      this.loading = false;
    }
    void this.workspace.fitToView();
  }

  /** Restores unsaved work, or shows the start screen when there is saved work to pick from. */
  private async startup(): Promise<void> {
    const recovered = await this.session.loadRecovery();
    // Don't clobber work started before IndexedDB answered.
    if (recovered && !this.session.state.dirty) {
      try {
        const { doc, name } = fromProjectFile(recovered.json);
        this.loadDocument(doc, name);
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

  private altHeld = false;

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
    applicationStore.select((s) => s.penSize, invalidate);
    applicationStore.select((s) => s.currentColor, invalidate);
  }

  /** Engine → store/UI. */
  private bindDocument(): void {
    const { doc, history } = this;

    doc.events.on("resized", ({ width, height }) => {
      const { size } = applicationStore.getState().doc;
      if (size.width !== width || size.height !== height) {
        applicationStore.dispatch(ApplicationStateActions.ResizeDocument, { width, height });
      }
      void this.workspace.fitToView();
    });

    const updateLayer = () => {
      this.ui.updateLayer(doc.getActiveLayer()?.name ?? "—");
      this.workspace.refreshCursor();
    };
    doc.events.on("layer:activated", updateLayer);
    doc.events.on("layer:updated", updateLayer);
    doc.events.on("layers:changed", updateLayer);
    updateLayer();

    history.onChange((state) => {
      this.ui.updateHistory(state);
      if (!this.loading) this.session.markDirty();
    });
    this.ui.updateHistory(history.getState());
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
      (action: ApplicationStateActions.ToggleGrid | ApplicationStateActions.TogglePreview) =>
      () => {
        const { preferences } = applicationStore.getState();
        const enabled =
          action === ApplicationStateActions.ToggleGrid
            ? preferences.grid.enabled
            : preferences.preview.enabled;
        applicationStore.dispatch(action, { enabled: !enabled });
      };

    keymap.bind("mod+z", () => this.undo(), { repeat: true });
    keymap.bind("mod+shift+z", () => this.redo(), { repeat: true });
    keymap.bind("mod+y", () => this.redo(), { repeat: true });
    keymap.bind("mod+s", () => void this.save());
    keymap.bind("mod+shift+s", () => void this.saveAs());
    keymap.bind("mod+o", () => this.ui.runCommand("open"));
    keymap.bind("mod+e", () => void this.exportPNG(1));
    keymap.bind("b", setTool("pen"));
    keymap.bind("p", setTool("pen"));
    keymap.bind("e", setTool("eraser"));
    keymap.bind("g", setTool("bucket"));
    keymap.bind("i", setTool("eyedropper"));
    keymap.bind("[", penSize(-1), { repeat: true });
    keymap.bind("]", penSize(1), { repeat: true });
    keymap.bind("#", toggle(ApplicationStateActions.ToggleGrid));
    keymap.bind("alt+p", toggle(ApplicationStateActions.TogglePreview));
    keymap.bind("f", () => this.fitToView());
    keymap.bind("+", () => this.zoomBy(1.25), { repeat: true });
    keymap.bind("=", () => this.zoomBy(1.25), { repeat: true });
    keymap.bind("-", () => this.zoomBy(0.8), { repeat: true });
    keymap.bind("delete", () => this.clearLayer());
    keymap.bind("n", () => this.layers.addLayer());
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
