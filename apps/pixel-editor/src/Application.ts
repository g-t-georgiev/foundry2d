import {
  EllipseTool,
  HistoryManager,
  LassoTool,
  LineTool,
  MagicWandTool,
  PixelUtils,
  RectangleTool,
  SelectTool,
  Selection,
  ToolManager,
  type Storage,
  type Unsubscribe,
} from "@foundry2d/core";
import { LayerStackPass } from "@foundry2d/render";
import {
  GridDocumentScene,
  ProjectFiles,
  ProjectSession,
  Workspace,
  editorBlock,
  isTypingTarget,
  readBoolean,
  readCamera,
  readInteger,
  readRecord,
  readString,
  tryRestore,
} from "@foundry2d/workspace";
import {
  SplitButtonEvents,
  bindProjectBrowser,
  type LayersPanel,
  type ProjectBrowser,
  type SplitButton,
} from "@foundry2d/ui";
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
  LEGACY_EXTENSIONS,
  PROJECT_EXTENSION,
  PROJECT_MIME,
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

/** Name of a new, not yet named sprite (same as the level designer's blank project). */
const DEFAULT_NAME = "untitled";
const NEW_SIZES = [16, 32, 64, 128];
const ONION_ALPHA = 0.28;

/** What a pixel-editor project file holds. */
interface SpriteProject {
  sprite: Sprite;
  name: string;
  /** The work file's `editor` block (view and tool state), if any. */
  editor?: Record<string, unknown>;
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
  /** Resolves once the current scene has been shown (and fitted). */
  private sceneReady: Promise<void> = Promise.resolve();

  constructor(elements: ApplicationElements, storage: Storage) {
    const { size } = applicationStore.getState().doc;
    this.sprite = Sprite.create(size.width, size.height);
    const notify = (message: string, timeout?: number) => this.ui.showMessage(message, timeout);

    this.tools.registerTool(new LineTool<Uint32Array>("line"));
    this.tools.registerTool(new RectangleTool<Uint32Array>("rect", false));
    this.tools.registerTool(new EllipseTool<Uint32Array>("ellipse", false));
    this.tools.registerTool(new LassoTool<Uint32Array>(this.selection, "lasso"));
    this.tools.registerTool(new MagicWandTool<Uint32Array>(this.selection, "wand"));
    this.tools.registerTool(
      new SelectTool<Uint32Array>(this.selection, "select", {
        onBlocked: (layer) =>
          notify(
            `Can't move pixels: "${layer.name}" is ${layer.locked ? "locked" : "hidden"}.`,
            3500
          ),
      })
    );

    this.workspace = new Workspace(elements.viewport, {
      canvas: elements.canvas,
      // Pixels counted in 1, 2, 4, 8… so labels meet the grid's stronger lines (every 8).
      rulers: { steps: () => "binary" },
    });
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
        mimeType: PROJECT_MIME,
        extensions: [PROJECT_EXTENSION],
        legacyExtensions: LEGACY_EXTENSIONS,
      },
      serialize: () => ({
        ...toProjectFile(this.sprite, this.name),
        editor: this.captureEditorState(),
      }),
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
        return { sprite, name: name || opened.name, editor: editorBlock(opened.json) };
      },
      load: ({ sprite, name, editor }) => {
        this.loadSprite(sprite, name);
        if (editor) this.restoreEditorState(editor);
      },
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
      setName: (name) => this.rename(name),
    });
    bindProjectBrowser(elements.projectBrowser, this.files);
    // Paste (Ctrl+V): images from the system clipboard or the internal copy.
    document.addEventListener("paste", (ev) => {
      if (isTypingTarget(ev.target) || isTypingTarget(document.activeElement)) return;
      ev.preventDefault();
      void this.clipboard.pasteFromEvent(ev);
    });
    for (const button of document.querySelectorAll<HTMLButtonElement>("[data-transform]")) {
      button.addEventListener("click", () =>
        this.clipboard.transform(button.dataset.transform as "flipX" | "flipY" | "rotateCW")
      );
    }
    document
      .querySelector<SplitButton>("#saveAsButton")
      ?.addEventListener(SplitButtonEvents.Action, (ev) => {
        if (ev.detail.value === "browser") void this.files.saveCopyInBrowser(this.name);
        else void this.files.saveAs();
      });
    this.ui.updateName(this.name);

    this.bindStore();
    this.bindSprite();
    this.bindWorkspace();
    bindKeys(this.workspace.keymap, this);

    this.showFrame(true);
    this.session.refresh();
    void this.files.startup().then(() => this.files.bindLaunchQueue());
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
    // Selection tools use Alt to subtract from the selection instead.
    const tool = applicationStore.getState().currentTool;
    if (tool === "select" || tool === "lasso" || tool === "wand") return;
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

  // ------------------------------------------------------------------ editor state

  /**
   * View and tool state saved in the work file's `editor` block (not part
   * of the sprite itself), so a sprite reopens as it was left.
   */
  private captureEditorState(): Record<string, unknown> {
    const state = applicationStore.getState();
    const tool =
      state.currentTool === "eyedropper" && this.altHeld ? state.previousTool : state.currentTool;
    return {
      camera: this.workspace.camera.getState(),
      frame: this.sprite.currentIndex,
      tool,
      color: state.currentColor,
      penSize: state.penSize,
      grid: state.preferences.grid.enabled,
      onionSkin: state.preferences.onionSkin.enabled,
      mirror: { ...state.preferences.mirror },
    };
  }

  /** Restores what `captureEditorState` saved; invalid entries are skipped. */
  private restoreEditorState(editor: Record<string, unknown>): void {
    const dispatch = applicationStore.dispatch.bind(applicationStore);
    const tool = readString(editor.tool);
    const color = readString(editor.color);
    const penSize = readInteger(editor.penSize);
    const grid = readBoolean(editor.grid);
    const onionSkin = readBoolean(editor.onionSkin);
    const mirror = readRecord(editor.mirror);
    const frame = readInteger(editor.frame);
    if (tool) tryRestore(() => dispatch(ApplicationStateActions.SetTool, tool));
    if (color) tryRestore(() => dispatch(ApplicationStateActions.SetColor, { color }));
    if (penSize) tryRestore(() => dispatch(ApplicationStateActions.EditPen, { size: penSize }));
    if (grid !== undefined) {
      tryRestore(() => dispatch(ApplicationStateActions.ToggleGrid, { enabled: grid }));
    }
    if (onionSkin !== undefined) {
      tryRestore(() => dispatch(ApplicationStateActions.ToggleOnionSkin, { enabled: onionSkin }));
    }
    if (mirror) {
      const x = readBoolean(mirror.x) ?? false;
      const y = readBoolean(mirror.y) ?? false;
      tryRestore(() => dispatch(ApplicationStateActions.SetMirror, { x, y }));
    }
    if (frame !== undefined && frame > 0 && frame < this.sprite.frames.length) {
      this.sprite.selectFrame(frame);
    }
    const camera = readCamera(editor.camera);
    // After the first fit of the new scene, or it would override the camera.
    if (camera) void this.sceneReady.then(() => this.workspace.setCamera(camera));
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
        new SelectionPass(
          this.selection,
          () => applicationStore.getState().currentTool === "select"
        ),
      ],
    });
    const camera = fit ? undefined : this.workspace.camera.getState();
    this.sceneReady = this.workspace.setScene(this.scene, { fit, camera });
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
