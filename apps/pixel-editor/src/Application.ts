import {
  EllipseTool,
  HistoryManager,
  LineTool,
  PixelUtils,
  RectangleTool,
  SelectTool,
  Selection,
  ToolManager,
  type Storage,
  type Unsubscribe,
} from "@foundry2d/core";
import { LayerStackPass } from "@foundry2d/render";
import { GridDocumentScene, ProjectFiles, ProjectSession, Workspace } from "@foundry2d/workspace";
import { bindProjectBrowser, type LayersPanel, type ProjectBrowser } from "@foundry2d/ui";
import type { ApplicationContext } from "./types";
import { ApplicationStateActions, applicationStore } from "./state";
import UIManager from "./ui/UIManager";
import LayersController from "./ui/LayersController";
import TimelineView from "./ui/TimelineView";
import AnimationPreview from "./ui/AnimationPreview";
import ExportDialog from "./ui/ExportDialog";
import { ExportController } from "./export/ExportController";
import { PaletteController } from "./ui/PaletteController";
import { ClipboardController } from "./editing/ClipboardController";
import { MirrorGuidePass, SelectionPass } from "./ui/overlays";
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
import { bindKeys } from "./keys";

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

/** What a pixel-editor project file holds. */
interface SpriteProject {
  sprite: Sprite;
  name: string;
}

/**
 * Composition root of the pixel editor: creates the model, views and
 * controllers and wires them together.
 *
 * - Model: `Sprite` (one `GridDocument` per frame) and `HistoryManager`. The
 *   store only holds thin UI state (tool, colour, pen size, toggles).
 * - Controllers: `ProjectFiles` (open/save/library, shared with the level
 *   designer), `ClipboardController`, `PaletteController`, `LayersController`
 *   and `ExportController`; key bindings live in `keys.ts`.
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
  readonly clipboard: ClipboardController;
  readonly session: ProjectSession;
  readonly files: ProjectFiles<SpriteProject>;
  private readonly palette: PaletteController;
  private readonly exportDialog: ExportDialog;
  private name = DEFAULT_NAME;
  /** True while a sprite is being loaded, so load-time events don't mark it dirty. */
  private loading = false;
  private docSubscriptions: Unsubscribe[] = [];
  private altHeld = false;

  constructor(elements: ApplicationElements, storage: Storage) {
    const { size } = applicationStore.getState().doc;
    this.sprite = Sprite.create(size.width, size.height);
    const notify = (message: string, timeout?: number) => this.ui.showMessage(message, timeout);

    this.tools.registerTool(new LineTool<Uint32Array>("line"));
    this.tools.registerTool(new RectangleTool<Uint32Array>("rect", false));
    this.tools.registerTool(new EllipseTool<Uint32Array>("ellipse", false));
    this.tools.registerTool(
      new SelectTool<Uint32Array>(this.selection, "select", {
        onBlocked: (layer) =>
          notify(
            `Can't move pixels: "${layer.name}" is ${layer.locked ? "locked" : "hidden"}.`,
            3500
          ),
      })
    );

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
      setFps: (fps) => this.sprite.setFps(fps),
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
      notify(message, 3500)
    );
    this.palette = new PaletteController(elements.paletteRoot, this.sprite, {
      getName: () => this.name,
      notify,
    });
    this.clipboard = new ClipboardController({
      getDoc: () => this.doc,
      selection: this.selection,
      history: this.history,
      notify,
      onPasted: () => applicationStore.dispatch(ApplicationStateActions.SetTool, "select"),
    });

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
    this.files = new ProjectFiles<SpriteProject>({
      session: this.session,
      startScreen: elements.projectBrowser,
      noun: { one: "sprite", title: "Sprites" },
      parse: (opened) => {
        const { sprite, name } = fromProjectFile(opened.json);
        return { sprite, name: name || opened.name };
      },
      load: ({ sprite, name }) => this.loadSprite(sprite, name),
      templates: () =>
        NEW_SIZES.map((s) => ({
          id: String(s),
          label: `${s} × ${s}`,
          description: "Empty sprite with one layer",
        })),
      createFromTemplate: (id) => {
        const width = Number(id) || this.sprite.width;
        const height = Number(id) || this.sprite.height;
        return {
          project: { sprite: Sprite.create(width, height), name: DEFAULT_NAME },
          message: `New ${width}×${height} sprite`,
        };
      },
      isUserFacingError: (error) => error instanceof ProjectFormatError,
      notify,
    });
    bindProjectBrowser(elements.projectBrowser, this.files);
    this.ui.updateName(this.name);

    this.bindStore();
    this.bindSprite();
    this.bindWorkspace();
    bindKeys(this.workspace.keymap, this);

    this.showFrame(true);
    this.session.refresh();
    void this.files.startup();
  }

  /** The frame document being edited. */
  get doc(): PixelDocument {
    return this.sprite.doc;
  }

  get spriteName(): string {
    return this.name;
  }

  // ------------------------------------------------------------------ ApplicationContext

  showBrowser(): Promise<void> {
    return this.files.showBrowser();
  }

  save(): Promise<void> {
    return this.files.save();
  }

  saveAs(): Promise<void> {
    return this.files.saveAs();
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

  /** Opens the export dialog. */
  openExport(): void {
    this.exportDialog.open();
  }

  clearLayer(): void {
    this.clipboard.clearLayer();
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

  // ------------------------------------------------------------------ frames

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

  // ------------------------------------------------------------------ eyedropper

  /** Alt held: pick colours until released. */
  beginTemporaryEyedropper(): void {
    this.altHeld = true;
    applicationStore.dispatch(ApplicationStateActions.SetTool, "eyedropper");
  }

  endTemporaryEyedropper(): void {
    this.altHeld = false;
    if (applicationStore.getState().currentTool === "eyedropper") this.returnToPreviousTool();
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

  // ------------------------------------------------------------------ internals

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
        this.palette.render();
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
      this.palette.render();
      if (!this.loading) this.session.markDirty();
    });
    this.selection.events.on("changed", () => this.scene?.invalidate());
    this.palette.render();

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
    const syncSize = () => {
      const { size } = applicationStore.getState().doc;
      if (size.width !== doc.width || size.height !== doc.height) {
        applicationStore.dispatch(ApplicationStateActions.ResizeDocument, {
          width: doc.width,
          height: doc.height,
        });
      }
    };
    this.docSubscriptions = [
      doc.events.on("resized", () => {
        syncSize();
        structureChanged();
        void this.workspace.fitToView();
      }),
      doc.events.on("layer:activated", updateLayer),
      doc.events.on("layer:updated", structureChanged),
      doc.events.on("layers:changed", structureChanged),
      doc.events.on("cells:changed", pixelsChanged),
    ];
    updateLayer();
    syncSize();
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
}
