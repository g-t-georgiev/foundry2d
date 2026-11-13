import {
  ClearCommand,
  GridDocument,
  HistoryManager,
  PixelUtils,
  ResizeCommand,
  ToolManager,
} from "@foundry2d/core";
import { GridDocumentScene, Workspace } from "@foundry2d/workspace";
import type { LayersPanel } from "@foundry2d/ui";
import type { ApplicationContext } from "./types";
import { ApplicationStateActions, applicationStore } from "./state";
import UIManager from "./ui/UIManager";
import LayersController from "./ui/LayersController";
import { Autosave } from "./io/Autosave";
import { exportPng } from "./io/exportPng";
import { ProjectFormatError, readProjectFile, saveProjectFile } from "./io/project";

export interface ApplicationElements {
  viewport: HTMLElement;
  canvas: HTMLCanvasElement;
  layersPanel: LayersPanel;
}

const DEFAULT_NAME = "sprite";

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
  private readonly autosave: Autosave;
  private name = DEFAULT_NAME;

  constructor(elements: ApplicationElements) {
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
    this.autosave = new Autosave(
      () => ({ doc: this.doc, name: this.name }),
      () => this.ui.showMessage("Autosaved", 1200)
    );

    this.bindStore();
    this.bindDocument();
    this.bindWorkspace();
    this.bindKeys();

    void this.workspace.setScene(this.scene);
    void this.restoreAutosave();
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

  newDocument(): void {
    if (this.history.canUndo && !confirm("Start a new sprite? Unsaved changes will be lost.")) {
      return;
    }
    const { width, height } = this.doc;
    this.loadDocument(Application.createDocument(width, height), DEFAULT_NAME);
    void this.autosave.clear();
    this.ui.showMessage("New sprite");
  }

  async openProject(file: File): Promise<void> {
    try {
      const { doc, name } = await readProjectFile(file);
      this.loadDocument(doc, name);
      this.ui.showMessage(`Opened ${file.name}`);
    } catch (error) {
      const message = error instanceof ProjectFormatError ? error.message : "Could not open file.";
      this.ui.showMessage(message, 5000);
      console.error(error);
    }
  }

  saveProject(): void {
    saveProjectFile(this.doc, this.name);
    this.ui.showMessage("Project saved");
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
    this.workspace.input.cancelStroke();
    this.doc.replaceWith(source);
    this.name = name;
    this.history.clear();
    void this.workspace.fitToView();
  }

  private async restoreAutosave(): Promise<void> {
    const saved = await this.autosave.load();
    if (!saved) return;
    // Don't clobber work started before IndexedDB answered.
    if (this.history.canUndo) return;
    this.loadDocument(saved.doc, saved.name);
    this.ui.showMessage("Restored previous session");
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
      this.autosave.schedule();
    });
    // Layer selection isn't an undo step but is still worth persisting.
    doc.events.on("layer:activated", () => this.autosave.schedule());
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
    keymap.bind("mod+s", () => this.saveProject());
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
