import {
  CompositeCommand,
  createZip,
  HistoryManager,
  RectangleTool,
  StampTool,
  type StampPattern,
  pruneUnusedAssets,
  ResizeCommand,
  ToolManager,
  type CameraState,
  type ICommand,
  type Rect,
  type Storage,
  type Unsubscribe,
} from "@foundry2d/core";
import {
  GridDocumentScene,
  ProjectFiles,
  ProjectSession,
  Workspace,
  downloadBlob,
  editorBlock,
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
import type { DefinitionSnapshot, Level, LevelProject } from "./model/LevelProject";
import { WORLD_LAYOUTS, type LayerDef, type WorldLayout } from "./model/types";
import { createProjectFromPreset, presets, DEFAULT_PRESET_ID } from "./model/presets";
import { bindKeys } from "./keys";
import { bindStatusBar } from "./ui/StatusBar";
import {
  DefinitionEditCommand,
  MoveLevelCommand,
  SetLevelPropertiesCommand,
  type LevelProperties,
} from "./model/commands";
import { fieldInput } from "./ui/fieldInputs";
import { fieldValue } from "./model/entities";
import { LevelActions, levelStore, type EditorView, type LevelTool } from "./state";
import PaletteView from "./ui/PaletteView";
import TilesetPickerView from "./ui/TilesetPickerView";
import { levelLayerRendererFor } from "./render/entityRenderer";
import { EntityController } from "./entities/EntityController";
import EntityPanel from "./entities/EntityPanel";
import { ShiftEntitiesCommand } from "./model/entityCommands";
import { decodeTile, selectionToPattern, tilesetGrid } from "./model/tiles";
import LevelLayersController from "./ui/LevelLayersController";
import LevelsListView from "./ui/LevelsListView";
import SettingsDialog from "./ui/SettingsDialog";
import AutoRulesDialog from "./ui/AutoRulesDialog";
import AddLayerMenu from "./ui/AddLayerMenu";
import { WorldScene } from "./world/WorldScene";
import { LevelBackgroundPass } from "./render/levelBackground";
import { decodeWorkFile, encodeWorkFile } from "./io/packagedFile";
import { GridLinesPass } from "@foundry2d/render";
import { LevelOperations } from "./world/LevelOperations";
import {
  LEGACY_EXTENSIONS,
  PROJECT_EXTENSION,
  PROJECT_MIME,
  ProjectFormatError,
  deserializeProject,
  isProjectFile,
  serializeProject,
} from "./io/projectFile";
import {
  entitiesForLayer,
  toCsvFiles,
  formatLayerAsArray,
  fromGameFormat,
  isGameFormat,
  toGameFormat,
} from "./io/gameFormat";
import { externalizeAssets, internalizeAssets } from "./io/assets";
import { renderProjectThumbnail } from "./io/thumbnail";
import { renderLevelPng } from "./io/levelImage";

const $ = <T extends Element = HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;

const TRANSITION_MS = 320;

/** Grows a rectangle by `amount` on every side. */
const inflate = (r: Rect, amount: number): Rect => ({
  x: r.x - amount,
  y: r.y - amount,
  width: r.width + amount * 2,
  height: r.height + amount * 2,
});

/** A level project as opened from a work file, with its saved editor state. */
interface LevelWork {
  project: LevelProject;
  editor?: Record<string, unknown>;
}

/**
 * Composition root of the level designer.
 *
 * Lifetimes:
 * - app: workspace, tools, store and static DOM wiring;
 * - project session: world scene and project subscriptions, rebuilt on New/Open;
 * - level session: level scene, layers panel bridge, document subscriptions,
 *   rebuilt whenever another level is opened.
 *
 * One undo history spans the whole project: cell edits and world edits
 * (add, move, delete levels) undo in the order they were made.
 */
export default class Application {
  readonly history = new HistoryManager();
  readonly tools = new ToolManager<Int32Array>();
  readonly workspace: Workspace;
  project: LevelProject;
  level: Level;
  levelScene!: GridDocumentScene<Int32Array>;
  worldScene!: WorldScene;

  private projectSession: Unsubscribe[] = [];
  private levelSession: { layers: LevelLayersController; unsubscribe: Unsubscribe[] } | null = null;
  private readonly palette: PaletteView;
  private readonly tilePicker: TilesetPickerView;
  private readonly levelsList: LevelsListView;
  private readonly settings: SettingsDialog;
  private readonly rulesDialog: AutoRulesDialog;
  readonly entities: EntityController;
  private readonly entityPanel: EntityPanel;
  private readonly addLayerMenu = new AddLayerMenu($("#addLayerMenu"));
  private readonly exportButton = $<SplitButton>("#exportButton");
  readonly session: ProjectSession;
  /** True while a project is being loaded, so load-time events don't mark it dirty. */
  private loading = false;
  private readonly layersPanel: LayersPanel;
  private altHeld = false;
  /** Bumped on every history change; tells whether the last definition edit is still on top. */
  private historyVersion = 0;
  /** The last recorded definition edit, for merging rapid repeats (colour drags). */
  private lastDefinitionEdit: {
    command: DefinitionEditCommand;
    at: number;
    historyVersion: number;
  } | null = null;
  readonly files: ProjectFiles<LevelWork>;
  readonly levelOps: LevelOperations;
  /**
   * The running view transition. World/level switches are chained on it, so
   * a request made mid-animation (e.g. Enter right after Escape) runs next
   * instead of being dropped.
   */
  private transition: Promise<void> = Promise.resolve();
  /** Resolves once the scene shown by `loadProject` has been fitted. */
  private sceneReady: Promise<void> = Promise.resolve();
  private messageTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(storage: Storage) {
    this.tools.registerTool(new RectangleTool<Int32Array>("rect", true));
    // Engine-only tool: the pen becomes a stamp when several tiles are selected.
    this.tools.registerTool(new StampTool<Int32Array>(() => this.currentPattern(), "stamp"));

    this.project = createProjectFromPreset(DEFAULT_PRESET_ID);
    this.levelOps = new LevelOperations({
      getProject: () => this.project,
      getOpenLevel: () => this.level,
      getSelectedLevel: () => this.selectedLevel(),
      select: (uid, reveal) => this.selectLevel(uid, reveal),
      history: this.history,
      notify: (message, timeout) => this.showMessage(message, timeout),
    });
    this.level = this.project.levels[0];

    this.workspace = new Workspace($("#viewport"), {
      canvas: $<HTMLCanvasElement>("#levelCanvas"),
      rulers: {
        // Level view: cells of the active layer (its own grid, item 17), counted 1, 2, 4, 8…
        // so labels meet the grid's stronger lines; world view: pixels, 1, 2, 5, 10….
        unitScale: () => (this.view === "level" ? this.project.layerGridSize(this.activeDef()) : 1),
        unitLabel: () => (this.view === "level" ? "t" : "px"),
        steps: () => (this.view === "level" ? "binary" : "decimal"),
      },
      theme: {
        workspaceBackground: "#0e0e11",
        checkerLight: "#1c1c22",
        checkerDark: "#18181c",
      },
    });

    this.layersPanel = $<LayersPanel>("#layersPanel");
    this.palette = new PaletteView(
      $<HTMLElement>("#palette"),
      $<HTMLElement>("#paletteLayer"),
      (value) => this.selectValue(value)
    );
    this.levelsList = new LevelsListView($("#levelsList"), $("#levelsRail"), {
      select: (uid) => this.selectLevel(uid, true),
      open: (uid) => void this.enterLevel(uid),
      add: () => this.levelOps.add(),
      importLevel: () => this.importGameLevel(),
      duplicate: (uid) => this.levelOps.duplicate(uid),
      remove: (uid) => this.levelOps.remove(uid),
      move: (uid, direction) => this.levelOps.reorder(uid, direction),
      rename: (uid, identifier) => this.levelOps.rename(uid, identifier),
    });
    this.settings = new SettingsDialog($<HTMLDialogElement>("#settingsDialog"), {
      confirm: (message) => window.confirm(message),
      notify: (message) => this.showMessage(message, 5000),
      editRules: (uid) => this.rulesDialog.open(this.project, uid),
    });
    this.rulesDialog = new AutoRulesDialog($<HTMLDialogElement>("#rulesDialog"));
    $("#editAutoRules").addEventListener("click", () => {
      const def = this.activeDef();
      if (def && this.project.isAutoLayer(def)) this.rulesDialog.open(this.project, def.uid);
    });
    this.session = new ProjectSession({
      app: "level",
      storage,
      titleSuffix: "Foundry2D Level Designer",
      fileType: {
        description: "Foundry2D level project",
        mimeType: PROJECT_MIME,
        extensions: [PROJECT_EXTENSION],
        legacyExtensions: LEGACY_EXTENSIONS,
      },
      serialize: () => ({
        ...serializeProject(this.project),
        editor: this.captureEditorState(),
      }),
      encodeFile: (json) => Promise.resolve(encodeWorkFile(json)),
      decodeFile: (file) => decodeWorkFile(file),
      toStored: (json) => externalizeAssets(json, storage.assets),
      fromStored: (json) => internalizeAssets(json, storage.assets),
      getName: () => this.project.name,
      thumbnail: () => renderProjectThumbnail(this.project),
      onChange: (state) => {
        const where = state.fileName ?? (state.libraryId ? "browser library" : "not saved yet");
        $("#statFile").textContent = `${state.dirty ? "● " : ""}${where}`;
      },
    });
    this.session.installUnloadGuard();
    const browser = $<ProjectBrowser>("#projectBrowser");
    this.files = new ProjectFiles<LevelWork>({
      session: this.session,
      startScreen: browser,
      noun: { one: "project", title: "Level projects" },
      // Files may be native projects or game exports; library and recovery
      // copies are always native.
      parse: ({ json }) => {
        if (isProjectFile(json)) {
          return { project: deserializeProject(json), editor: editorBlock(json) };
        }
        if (isGameFormat(json)) return { project: fromGameFormat(json) };
        throw new ProjectFormatError("Unrecognized file: expected a level project or game JSON.");
      },
      load: ({ project, editor }) => {
        this.loadProject(project);
        if (editor) this.restoreEditorState(editor);
      },
      templates: () =>
        presets.map((p) => ({ id: p.id, label: p.label, description: p.description })),
      createFromTemplate: (id) => {
        const label = presets.find((p) => p.id === id)?.label ?? id;
        return {
          project: { project: createProjectFromPreset(id) },
          message: `New project from "${label}"`,
        };
      },
      isUserFacingError: (error) => error instanceof ProjectFormatError,
      notify: (message, timeout) => this.showMessage(message, timeout),
      afterDelete: () => this.pruneAssets(),
      setName: (name) => this.project.setName(name),
    });
    bindProjectBrowser(browser, this.files);

    this.tilePicker = new TilesetPickerView($("#tilesetCanvasHost"), (tileset, selection) => {
      levelStore.dispatch(LevelActions.SelectTiles, { tilesetUid: tileset.uid, ...selection });
      const { currentTool } = levelStore.getState();
      if (currentTool === "eraser" || currentTool === "eyedropper") {
        levelStore.dispatch(LevelActions.SetTool, "pen");
      }
    });

    this.entities = new EntityController({
      getProject: () => this.project,
      getLevel: () => this.level,
      history: this.history,
      getZoom: () => this.workspace.zoom,
      isPicking: () => levelStore.getState().currentTool === "eyedropper",
      requestRender: () => this.workspace.requestRender(),
      refreshCursor: () => this.workspace.refreshCursor(),
      notify: (message, timeout) => this.showMessage(message, timeout),
    });
    this.entityPanel = new EntityPanel($("#entityList"), $("#entityInspector"), this.entities, () =>
      this.settings.open(this.project, null, "entities")
    );
    this.entities.events.on("changed", () => this.renderEntityPanel());

    this.bindStore();
    this.bindDom();
    bindKeys(this.workspace.keymap, this);
    bindStatusBar(this);
    this.history.onChange(() => this.historyVersion++);
    this.history.onChange((state) => {
      $<HTMLButtonElement>('[data-command="undo"]').disabled = !state.canUndo;
      $<HTMLButtonElement>('[data-command="redo"]').disabled = !state.canRedo;
      this.markDirty();
    });

    this.loadProject(this.project);
    // Only refresh the title here: resetIdentity() would discard the recovery
    // snapshot that startup() is about to restore.
    this.session.refresh();
    this.files.bindLaunchQueue();
    void this.files.startup();
  }

  get view(): EditorView {
    return levelStore.getState().view;
  }

  // ------------------------------------------------------------------ project lifecycle

  loadProject(project: LevelProject): void {
    this.loading = true;
    try {
      this.loadProjectInner(project);
    } finally {
      this.loading = false;
    }
  }

  private loadProjectInner(project: LevelProject): void {
    this.workspace.input.cancelStroke();
    this.projectSession.forEach((unsubscribe) => unsubscribe());

    this.project = project;
    this.history.clear();
    this.lastDefinitionEdit = null;
    // Definition edits become undo steps in the same history as cell edits.
    project.definitionRecorder = (label, before, after) =>
      this.recordDefinitionEdit(project, label, before, after);
    this.worldScene = this.createWorldScene();

    const persist = () => this.markDirty();
    this.projectSession = [
      project.events.on("tilesets:loaded", () => {
        this.workspace.requestRender();
        this.tilePicker.draw();
        this.rulesDialog.refresh();
      }),
      project.events.on("defs:changed", () => {
        this.renderLevelInfo();
        this.syncEngineTool();
        this.renderPalette();
        this.workspace.refreshCursor();
        this.levelScene.invalidate();
        persist();
      }),
      project.events.on("defs:restored", () => {
        this.settings.refresh();
        this.rulesDialog.refresh();
      }),
      project.events.on("settings:changed", () => {
        this.session.refresh();
        this.refreshScenes();
        this.renderProjectInfo();
        this.renderWorldSettings();
        persist();
      }),
      project.events.on("entities:changed", (levelUid) => {
        if (levelUid === this.level.uid) {
          this.entities.refresh();
          this.levelScene.invalidate();
        } else {
          this.workspace.requestRender();
        }
        persist();
      }),
      project.events.on("levels:changed", () => {
        // The open level may have been deleted (e.g. undo of "add level").
        if (!project.getLevel(this.level.uid)) {
          this.openLevelSession(project.levels[0]);
          if (this.view === "level") void this.showWorld(false);
        }
        if (!project.getLevel(levelStore.getState().selectedLevelUid ?? -1)) {
          levelStore.dispatch(LevelActions.SelectLevel, { uid: this.level.uid });
        }
        this.renderLevelsList();
        this.renderLevelInfo();
        this.workspace.requestRender();
        persist();
      }),
    ];

    this.openLevelSession(project.levels[0]);
    levelStore.dispatch(LevelActions.SelectLevel, { uid: this.level.uid });
    this.renderProjectInfo();
    this.renderWorldSettings();
    this.renderLevelsList();

    // Single-level projects open straight into the level; multi-level ones in the world.
    const view: EditorView = project.levels.length > 1 ? "world" : "level";
    levelStore.dispatch(LevelActions.SetView, view);
    this.sceneReady = this.workspace.setScene(
      view === "world" ? this.worldScene : this.levelScene,
      { fit: true }
    );
    this.renderView();
  }

  /** Binds the panels and the level scene to `level`. */
  private openLevelSession(level: Level): void {
    this.workspace.input.cancelStroke();
    this.levelSession?.layers.destroy();
    this.levelSession?.unsubscribe.forEach((unsubscribe) => unsubscribe());

    this.level = level;
    this.entities.select(null);
    this.entities.cancelPick();
    const { doc } = level;
    const refreshLayerUi = () => {
      this.renderPalette();
      this.renderProjectInfo();
      this.workspace.refreshCursor();
    };
    this.levelSession = {
      layers: new LevelLayersController(this.layersPanel, this.project, level, this.history, {
        chooseLayerType: () => this.addLayerMenu.choose(),
        confirm: (message) => window.confirm(message),
        notify: (message, timeout) => this.showMessage(message, timeout),
      }),
      unsubscribe: [
        doc.events.on("layer:activated", refreshLayerUi),
        doc.events.on("resized", () => {
          this.project.arrangeLevels();
          this.renderLevelInfo();
          this.renderLevelsList();
        }),
      ],
    };
    this.levelScene = this.createLevelScene(level);
    this.renderLevelInfo();
    refreshLayerUi();
  }

  private createLevelScene(level: Level): GridDocumentScene<Int32Array> {
    const project = this.project;
    const { gridSize } = project;
    const renderers = levelLayerRendererFor(project);
    return new GridDocumentScene<Int32Array>({
      doc: level.doc,
      tools: this.tools,
      history: this.history,
      cellSize: { width: gridSize, height: gridSize },
      getValue: () => this.currentValue(),
      getColorizer: (layer) => project.colorizerFor(layer.id),
      getLayerRenderer: (layer) => renderers(layer, level),
      getPointerDelegate: () => (this.entities.isActive ? this.entities : null),
      overlayPasses: [
        new GridLinesPass({
          id: "guide-grid",
          // Shown with the grid toggle, while the active layer has a guide grid.
          getBounds: () =>
            this.activeDef()?.guideGrid && levelStore.getState().grid.enabled
              ? this.levelScene.getBounds()
              : null,
          step: () => this.activeDef()?.guideGrid ?? { width: 1, height: 1 },
          color: "rgba(96, 205, 255, 0.6)",
        }),
        this.entities.overlay,
      ],
      getPaletteVersion: () => project.paletteVersion,
      getCursorFill: () => {
        if (this.activeDef()?.type === "Tiles") return "rgba(56, 189, 248, 0.25)";
        const entry = this.activeDef()?.intGridValues.find((v) => v.value === this.currentValue());
        return entry ? `${entry.color}88` : null;
      },
      onPickValue: (value) => this.pickValue(value),
      showGrid: () => levelStore.getState().grid.enabled,
      majorGridEvery: 4,
      checkerboard: true,
      underlayPasses: [
        new LevelBackgroundPass(
          () => level.bgColor,
          () => this.levelScene.getBounds()
        ),
      ],
    });
  }

  private createWorldScene(): WorldScene {
    return new WorldScene(this.project, {
      getSelectedUid: () => levelStore.getState().selectedLevelUid,
      select: (uid) => this.selectLevel(uid, false),
      open: (uid) => void this.enterLevel(uid),
      createAt: (x, y) => this.levelOps.add(x, y),
      commitMove: (uid, from, to) =>
        this.history.record(new MoveLevelCommand(this.project, uid, from, to)),
    });
  }

  /** Scene cell sizes are fixed, so a grid size change needs new scenes. */
  private refreshScenes(): void {
    const camera = this.workspace.camera.getState();
    this.levelScene = this.createLevelScene(this.level);
    this.worldScene = this.createWorldScene();
    void this.workspace.setScene(this.view === "world" ? this.worldScene : this.levelScene, {
      camera,
    });
  }

  // ------------------------------------------------------------------ views

  // ------------------------------------------------------------------ editor state

  /**
   * View and tool state saved in the work file's `editor` block (not part
   * of the project data), so a project reopens as it was left.
   */
  private captureEditorState(): Record<string, unknown> {
    const state = levelStore.getState();
    const tool =
      state.currentTool === "eyedropper" && this.altHeld ? state.previousTool : state.currentTool;
    return {
      view: this.view,
      levelUid: this.level.uid,
      camera: this.workspace.camera.getState(),
      tool,
      grid: state.grid.enabled,
      selectedValues: { ...state.selectedValues },
      tileFlip: { ...state.tileFlip },
      tileSelections: structuredClone(state.tileSelections),
    };
  }

  /** Restores what `captureEditorState` saved; invalid entries are skipped. */
  private restoreEditorState(editor: Record<string, unknown>): void {
    const dispatch = levelStore.dispatch.bind(levelStore);
    const tool = readString(editor.tool);
    const grid = readBoolean(editor.grid);
    if (tool) tryRestore(() => dispatch(LevelActions.SetTool, tool as LevelTool));
    if (grid !== undefined) tryRestore(() => dispatch(LevelActions.ToggleGrid, { enabled: grid }));
    for (const [defUid, value] of Object.entries(readRecord(editor.selectedValues) ?? {})) {
      const uid = Number(defUid);
      if (Number.isInteger(uid) && Number.isInteger(value)) {
        tryRestore(() =>
          dispatch(LevelActions.SelectValue, { defUid: uid, value: value as number })
        );
      }
    }
    const flip = readRecord(editor.tileFlip);
    if (flip) {
      const x = readBoolean(flip.x) ?? false;
      const y = readBoolean(flip.y) ?? false;
      tryRestore(() => dispatch(LevelActions.SetTileFlip, { x, y }));
    }
    for (const [tilesetUid, rect] of Object.entries(readRecord(editor.tileSelections) ?? {})) {
      const r = readRecord(rect);
      const uid = Number(tilesetUid);
      if (!r || !Number.isInteger(uid)) continue;
      tryRestore(() =>
        dispatch(LevelActions.SelectTiles, {
          tilesetUid: uid,
          x: readInteger(r.x) ?? 0,
          y: readInteger(r.y) ?? 0,
          width: readInteger(r.width) ?? 1,
          height: readInteger(r.height) ?? 1,
        })
      );
    }

    // View, level and camera, after the scene `loadProject` showed is fitted.
    const level = this.project.getLevel(readInteger(editor.levelUid) ?? -1);
    const view = readString(editor.view);
    const camera = readCamera(editor.camera);
    void this.sceneReady
      .then(() => {
        if (view === "world") return this.showWorld(false);
        if (view === "level" && level) return this.enterLevel(level.uid, false);
      })
      .then(() => {
        if (camera) this.workspace.setCamera(camera);
      });
  }

  /** Opens a level for editing, zooming in from its place in the world. */
  enterLevel(uid: number, animate = true): Promise<void> {
    return this.queueTransition(() => this.enterLevelNow(uid, animate));
  }

  /** Returns to the world, zooming out around the level that was open. */
  showWorld(animate = true): Promise<void> {
    return this.queueTransition(() => this.showWorldNow(animate));
  }

  private queueTransition(run: () => Promise<void>): Promise<void> {
    const next = this.transition.then(run);
    // Keep the chain alive even if one transition fails.
    this.transition = next.catch((error: unknown) => console.error(error));
    return next;
  }

  private async enterLevelNow(uid: number, animate: boolean): Promise<void> {
    const level = this.project.getLevel(uid);
    if (!level) return;
    levelStore.dispatch(LevelActions.SelectLevel, { uid });
    if (level !== this.level) this.openLevelSession(level);

    const fromWorld = this.view === "world";
    levelStore.dispatch(LevelActions.SetView, "level");
    this.renderView();

    if (!fromWorld || !animate) {
      await this.workspace.setScene(this.levelScene, { fit: true });
      return;
    }
    // Same picture, level-local coordinates; then frame the level.
    const world = this.workspace.camera.getState();
    const start: CameraState = {
      zoom: world.zoom,
      x: world.x + level.worldX * world.zoom,
      y: world.y + level.worldY * world.zoom,
    };
    await this.workspace.setScene(this.levelScene, { camera: start });
    await this.workspace.fitToView(TRANSITION_MS);
  }

  private async showWorldNow(animate: boolean): Promise<void> {
    if (this.view === "world") return;
    this.workspace.input.cancelStroke();
    const level = this.level;
    const local = this.workspace.camera.getState();
    levelStore.dispatch(LevelActions.SetView, "world");
    levelStore.dispatch(LevelActions.SelectLevel, { uid: level.uid });
    this.renderView();

    const start: CameraState = {
      zoom: local.zoom,
      x: local.x - level.worldX * local.zoom,
      y: local.y - level.worldY * local.zoom,
    };
    const rect = level.worldRect(this.project.gridSize);
    const target = this.workspace.computeFitState(
      inflate(rect, Math.max(rect.width, rect.height) * 0.75)
    );
    await this.workspace.setScene(this.worldScene, { camera: start });
    if (target) await this.workspace.animateTo(target, animate ? TRANSITION_MS : 0);
  }

  /** Selects a level in the world; optionally pans it into view. */
  selectLevel(uid: number | null, reveal: boolean): void {
    levelStore.dispatch(LevelActions.SelectLevel, { uid });
    if (uid === null || !reveal || this.view !== "world") return;
    const level = this.project.getLevel(uid);
    if (!level) return;
    const rect = level.worldRect(this.project.gridSize);
    const { camera } = this.workspace;
    const view = this.workspace.viewSize;
    const centerX = camera.uiPadding + (view.width - camera.uiPadding) / 2;
    const centerY = camera.uiPadding + (view.height - camera.uiPadding) / 2;
    void this.workspace.animateTo(
      {
        zoom: camera.zoom,
        x: centerX - (rect.x + rect.width / 2) * camera.zoom,
        y: centerY - (rect.y + rect.height / 2) * camera.zoom,
      },
      220
    );
  }

  selectedLevel(): Level | undefined {
    const uid = levelStore.getState().selectedLevelUid;
    return uid === null ? undefined : this.project.getLevel(uid);
  }

  // ------------------------------------------------------------------ files

  /**
   * Records a definition edit. Repeats of the same "Edit …" step within a
   * moment (a colour picker being dragged) merge into one undo step.
   */
  private recordDefinitionEdit(
    project: LevelProject,
    label: string,
    before: DefinitionSnapshot,
    after: DefinitionSnapshot
  ): void {
    const now = performance.now();
    const last = this.lastDefinitionEdit;
    // Only continuous edits merge (a colour picker being dragged records many
    // "Edit value" steps); two quick deletes must stay two undo steps.
    if (
      last &&
      label.startsWith("Edit ") &&
      last.command.label === label &&
      now - last.at < 800 &&
      last.historyVersion === this.historyVersion
    ) {
      last.command.after = after;
      last.at = now;
      this.markDirty();
      return;
    }
    const command = new DefinitionEditCommand(project, label, before, after);
    this.history.record(command);
    this.lastDefinitionEdit = { command, at: now, historyVersion: this.historyVersion };
  }

  /**
   * Deletes tileset images in the asset store that no library project and no
   * unsaved work refers to any more.
   */
  private async pruneAssets(): Promise<void> {
    // Unsaved work may reference assets too: refresh its snapshot first.
    if (this.session.state.dirty) await this.session.flushRecovery();
    await pruneUnusedAssets(this.session.storage);
  }

  private markDirty(): void {
    if (!this.loading) this.session.markDirty();
  }

  /** Runs an export action: "json", "csv" or "copy-array" (the split button's options). */
  runExport(action: string): void {
    if (action === "csv") this.exportCsv();
    else if (action === "png") void this.exportPng(false);
    else if (action === "png-layer") void this.exportPng(true);
    else if (action === "copy-array") void this.copyActiveLayer();
    else this.exportJson();
  }

  /** PNG of the level's visible layers, or of the active layer only. */
  async exportPng(activeLayerOnly: boolean): Promise<void> {
    const level = this.exportLevel();
    const layer = activeLayerOnly ? level.doc.getActiveLayer() : null;
    if (activeLayerOnly && !layer) return;
    try {
      const blob = await renderLevelPng(this.project, level, { layerId: layer?.id });
      const suffix = layer ? `-${layer.name}` : "";
      downloadBlob(blob, `${this.exportBaseName(level)}${suffix}.png`);
      this.showMessage(
        layer
          ? `Exported layer "${layer.name}" of ${level.identifier} as PNG`
          : `Exported ${level.identifier} as PNG`
      );
    } catch (error) {
      this.showMessage(`PNG export failed: ${(error as Error).message}`, 5000);
      console.error(error);
    }
  }

  /** The level being edited, or the one selected in the world view. */
  private exportLevel(): Level {
    return (this.view === "world" ? this.selectedLevel() : undefined) ?? this.level;
  }

  private exportBaseName(level: Level): string {
    const suffix = this.project.levels.length > 1 ? `-${level.identifier}` : "";
    return `${this.project.name}${suffix}`;
  }

  /** Game JSON of one level: only data a game needs (no editor state). */
  exportJson(): void {
    const level = this.exportLevel();
    const json = JSON.stringify(toGameFormat(this.project, level), null, 2);
    downloadBlob(
      new Blob([json], { type: "application/json" }),
      `${this.exportBaseName(level)}.json`
    );
    this.showMessage(`Exported ${level.identifier} as JSON`);
  }

  /** One CSV per layer; zipped when there is more than one. */
  exportCsv(): void {
    const level = this.exportLevel();
    const files = toCsvFiles(this.project, level);
    const base = this.exportBaseName(level);
    if (files.length === 1) {
      downloadBlob(new Blob([files[0].text], { type: "text/csv" }), `${base}-${files[0].name}`);
    } else {
      const encoder = new TextEncoder();
      const zip = createZip(files.map((f) => ({ name: f.name, data: encoder.encode(f.text) })));
      downloadBlob(
        new Blob([zip as Uint8Array<ArrayBuffer>], { type: "application/zip" }),
        `${base}-csv.zip`
      );
    }
    this.showMessage(
      `Exported ${level.identifier} as CSV (${files.length} layer${files.length === 1 ? "" : "s"})`
    );
  }

  async copyActiveLayer(): Promise<void> {
    const layer = this.level.doc.getActiveLayer();
    if (!layer) return;
    const def = this.activeDef();
    const text =
      def?.type === "Entities"
        ? JSON.stringify(entitiesForLayer(this.project, this.level, def.uid), null, 2)
        : formatLayerAsArray(layer.data, layer.width, layer.height);
    try {
      await navigator.clipboard.writeText(text);
      this.showMessage(`Copied "${layer.name}" as array`);
    } catch (error) {
      this.showMessage("Clipboard access was denied.", 4000);
      console.error(error);
    }
  }

  /**
   * Grows (+) or shrinks (−) the level on each edge, as one undo step. The
   * level also moves in the world so untouched edges stay where they were.
   */
  resizeLevel(edges: { top: number; right: number; bottom: number; left: number }): boolean {
    const { doc } = this.level;
    const width = doc.width + edges.left + edges.right;
    const height = doc.height + edges.top + edges.bottom;
    if (width < 1 || height < 1 || width > 1024 || height > 1024) {
      this.showMessage("The level must stay between 1 and 1024 cells per side.", 4000);
      return false;
    }
    if (width === doc.width && height === doc.height && edges.left === 0 && edges.top === 0) {
      return false;
    }
    const steps: ICommand[] = [
      new ResizeCommand(doc, { width, height }, { x: edges.left, y: edges.top }),
    ];
    if ((edges.left !== 0 || edges.top !== 0) && this.level.entities.length > 0) {
      steps.push(new ShiftEntitiesCommand(this.project, this.level, edges.left, edges.top));
    }
    if ((edges.left !== 0 || edges.top !== 0) && this.project.canDragLevels) {
      const { gridSize } = this.project;
      const from = { x: this.level.worldX, y: this.level.worldY };
      const to = { x: from.x - edges.left * gridSize, y: from.y - edges.top * gridSize };
      steps.push(new MoveLevelCommand(this.project, this.level.uid, from, to));
    }
    this.history.execute(new CompositeCommand(steps, "Resize level"));
    void this.workspace.fitToView(200);
    return true;
  }

  // ------------------------------------------------------------------ values

  /** Alt held in the level view: pick values until released. */
  beginTemporaryEyedropper(): void {
    if (this.view !== "level") return;
    this.altHeld = true;
    levelStore.dispatch(LevelActions.SetTool, "eyedropper");
  }

  endTemporaryEyedropper(): void {
    if (!this.altHeld) return;
    this.altHeld = false;
    const { currentTool, previousTool } = levelStore.getState();
    if (currentTool === "eyedropper") levelStore.dispatch(LevelActions.SetTool, previousTool);
  }

  activeDef(): LayerDef | undefined {
    return this.project.getLayerDefForLayer(this.level.doc.activeLayerId ?? "");
  }

  /** Selected value for the active layer, defaulting to its first value. */
  currentValue(): number {
    const def = this.activeDef();
    if (!def) return 0;
    if (def.type === "Tiles") return this.currentPattern()?.values[0] ?? 0;
    const selected = levelStore.getState().selectedValues[String(def.uid)];
    if (selected !== undefined && def.intGridValues.some((v) => v.value === selected)) {
      return selected;
    }
    return def.intGridValues[0]?.value ?? 0;
  }

  /** Tileset and selected tile rectangle for the active Tiles layer. */
  private tileContext() {
    const def = this.activeDef();
    const tileset = def?.type === "Tiles" ? this.project.getTileset(def.tilesetUid) : undefined;
    if (!tileset) return null;
    const { columns, rows } = tilesetGrid(tileset);
    if (columns === 0 || rows === 0) return null;
    const stored = levelStore.getState().tileSelections[String(tileset.uid)];
    // Drop selections that no longer fit (tileset resliced or replaced).
    const selection =
      stored && stored.x + stored.width <= columns && stored.y + stored.height <= rows
        ? stored
        : { x: 0, y: 0, width: 1, height: 1 };
    return { tileset, selection };
  }

  /** Stamp pattern for the active Tiles layer, with the current flips applied. */
  currentPattern(): StampPattern | null {
    const context = this.tileContext();
    if (!context) return null;
    const { x, y } = levelStore.getState().tileFlip;
    return selectionToPattern(context.tileset, context.selection, x, y);
  }

  /**
   * The engine tool follows the store tool, except that the pen paints a
   * stamp when a multi-tile selection is active on a Tiles layer.
   */
  private syncEngineTool(): void {
    const { currentTool } = levelStore.getState();
    const selection = this.tileContext()?.selection;
    const multi = selection !== undefined && selection.width * selection.height > 1;
    this.tools.setTool(currentTool === "pen" && multi ? "stamp" : currentTool);
    this.workspace.refreshCursor();
  }

  selectValue(value: number): void {
    const def = this.activeDef();
    if (!def || !def.intGridValues.some((v) => v.value === value)) return;
    levelStore.dispatch(LevelActions.SelectValue, { defUid: def.uid, value });
    const { currentTool } = levelStore.getState();
    if (currentTool === "eraser" || currentTool === "eyedropper") {
      levelStore.dispatch(LevelActions.SetTool, "pen");
    }
  }

  private pickValue(value: number): void {
    const context = this.tileContext();
    const tile = decodeTile(value);
    if (context && tile) {
      const { columns } = tilesetGrid(context.tileset);
      levelStore.dispatch(LevelActions.SelectTiles, {
        tilesetUid: context.tileset.uid,
        x: tile.tileId % columns,
        y: Math.floor(tile.tileId / columns),
        width: 1,
        height: 1,
      });
      levelStore.dispatch(LevelActions.SetTileFlip, { x: tile.flipX, y: tile.flipY });
    } else if (value !== 0 && !context) {
      this.selectValue(value);
    }
    if (!this.altHeld) {
      levelStore.dispatch(LevelActions.SetTool, levelStore.getState().previousTool);
    }
  }

  // ------------------------------------------------------------------ bindings

  private bindStore(): void {
    this.tools.setTool(levelStore.getState().currentTool);
    levelStore.select(
      (s) => s.currentTool,
      () => {
        this.syncEngineTool();
        this.renderTools();
      }
    );
    levelStore.select(
      (s) => s.tileSelections,
      () => {
        this.syncEngineTool();
        this.renderPalette();
        this.levelScene.invalidate();
      }
    );
    levelStore.select(
      (s) => s.tileFlip,
      (flip) => {
        $<HTMLInputElement>("#flipX").checked = flip.x;
        $<HTMLInputElement>("#flipY").checked = flip.y;
        this.levelScene.invalidate();
      }
    );
    levelStore.select(
      (s) => s.selectedValues,
      () => {
        this.renderPalette();
        this.levelScene.invalidate();
      }
    );
    levelStore.select(
      (s) => s.grid.enabled,
      (enabled) => {
        const toggle = $<HTMLInputElement>("#gridToggle");
        if (toggle.checked !== enabled) toggle.checked = enabled;
        this.levelScene.invalidate();
      }
    );
    levelStore.select(
      (s) => s.selectedLevelUid,
      () => {
        this.renderLevelsList();
        this.worldScene.invalidate();
      }
    );
    this.renderTools();
  }

  private bindDom(): void {
    this.exportButton.addEventListener(SplitButtonEvents.Action, (ev) =>
      this.runExport(ev.detail.value)
    );
    $<SplitButton>("#saveAsButton").addEventListener(SplitButtonEvents.Action, (ev) => {
      if (ev.detail.value === "browser") void this.files.saveCopyInBrowser(this.project.name);
      else void this.files.saveAs();
    });
    for (const button of document.querySelectorAll<HTMLButtonElement>("[data-tool]")) {
      button.addEventListener("click", () =>
        levelStore.dispatch(LevelActions.SetTool, button.dataset.tool as LevelTool)
      );
    }
    for (const button of document.querySelectorAll<HTMLButtonElement>("[data-command]")) {
      button.addEventListener("click", () => this.runCommand(button.dataset.command ?? ""));
    }
    for (const tab of document.querySelectorAll<HTMLButtonElement>("button[data-view]")) {
      tab.addEventListener("click", () => {
        if (tab.dataset.view === "world") void this.showWorld();
        else void this.enterLevel(this.selectedLevel()?.uid ?? this.level.uid);
      });
    }

    const flipX = $<HTMLInputElement>("#flipX");
    const flipY = $<HTMLInputElement>("#flipY");
    const setFlip = () =>
      levelStore.dispatch(LevelActions.SetTileFlip, { x: flipX.checked, y: flipY.checked });
    flipX.addEventListener("change", setFlip);
    flipY.addEventListener("change", setFlip);

    $<HTMLInputElement>("#gridToggle").addEventListener("change", (ev) =>
      levelStore.dispatch(LevelActions.ToggleGrid, {
        enabled: (ev.target as HTMLInputElement).checked,
      })
    );

    const projectName = $<HTMLInputElement>("#projectName");
    projectName.addEventListener("change", () => {
      const name = projectName.value.trim();
      if (name) this.project.setName(name);
      else projectName.value = this.project.name;
    });

    const levelBg = $<HTMLInputElement>("#levelBg");
    levelBg.addEventListener("change", () =>
      this.setLevelProperties({ bgColor: levelBg.value }, "Change level background")
    );
    $("#levelBgDefault").addEventListener("click", () =>
      this.setLevelProperties({ bgColor: null }, "Use default level background")
    );

    const levelName = $<HTMLInputElement>("#levelName");
    levelName.addEventListener("change", () => {
      this.levelOps.rename(this.level.uid, levelName.value);
      levelName.value = this.level.identifier;
    });

    const layoutSelect = $<HTMLSelectElement>("#worldLayoutSelect");
    layoutSelect.addEventListener("change", () => {
      const layout = layoutSelect.value as WorldLayout;
      if (WORLD_LAYOUTS.includes(layout)) this.project.setWorldLayout(layout);
      void this.workspace.fitToView(250);
    });
    const gridW = $<HTMLInputElement>("#worldGridWidth");
    const gridH = $<HTMLInputElement>("#worldGridHeight");
    const applyWorldGrid = () => {
      const w = Number(gridW.value);
      const h = Number(gridH.value);
      if (Number.isInteger(w) && Number.isInteger(h) && w > 0 && h > 0) {
        this.project.setWorldGrid(w, h);
      } else {
        this.renderWorldSettings();
      }
    };
    gridW.addEventListener("change", applyWorldGrid);
    gridH.addEventListener("change", applyWorldGrid);

    $("#applyResize").addEventListener("click", () => {
      const inputs = [...document.querySelectorAll<HTMLInputElement>("[data-edge]")];
      const edges = { top: 0, right: 0, bottom: 0, left: 0 };
      for (const input of inputs) {
        const edge = input.dataset.edge as keyof typeof edges;
        edges[edge] = Math.trunc(Number(input.value) || 0);
      }
      if (this.resizeLevel(edges)) inputs.forEach((input) => (input.value = "0"));
    });
  }

  runCommand(command: string): void {
    switch (command) {
      case "new":
      case "open":
        void this.files.showBrowser();
        break;
      case "save":
        void this.files.save();
        break;
      case "save-as":
        void this.files.saveAs();
        break;
      case "export":
        this.runExport(this.exportButton.value);
        break;
      case "undo":
        this.history.undo();
        break;
      case "redo":
        this.history.redo();
        break;
      case "settings":
        this.settings.open(this.project, this.activeDef()?.uid ?? null);
        break;
      case "fit":
        void this.workspace.fitToView(200);
        break;
      case "open-level": {
        const uid = this.selectedLevel()?.uid;
        if (uid !== undefined) void this.enterLevel(uid);
        break;
      }
    }
  }

  // ------------------------------------------------------------------ rendering

  private renderView(): void {
    const view = this.view;
    document.body.dataset.view = view;
    // `button`: <body> carries data-view too.
    for (const tab of document.querySelectorAll<HTMLButtonElement>("button[data-view]")) {
      tab.setAttribute("aria-selected", String(tab.dataset.view === view));
    }
    $("#currentLevelName").textContent = this.level.identifier;
    this.workspace.refreshCursor();
  }

  private renderTools(): void {
    const { currentTool } = levelStore.getState();
    for (const button of document.querySelectorAll<HTMLButtonElement>("[data-tool]")) {
      const active = button.dataset.tool === currentTool;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    }
  }

  private renderEntityPanel(): void {
    if (!this.entities.isActive) return;
    this.entityPanel.render(this.project, this.level);
  }

  private renderPalette(): void {
    const def = this.activeDef();
    const isTiles = def?.type === "Tiles";
    const isEntities = def?.type === "Entities";
    $("#palette").hidden = isTiles || isEntities;
    $("#paletteHint").hidden = isTiles || isEntities;
    $("#tilePicker").hidden = !isTiles;
    $("#entityPanel").hidden = !isEntities;
    if (isEntities) {
      $("#paletteLayer").textContent = `${def.identifier} · entities`;
      this.renderEntityPanel();
      return;
    }
    if (!isTiles) {
      this.palette.render(def, this.currentValue());
      return;
    }
    const context = this.tileContext();
    const tileset = this.project.getTileset(def.tilesetUid);
    $("#paletteLayer").textContent = `${def.identifier} · ${tileset?.identifier ?? "no tileset"}`;
    const source = this.project.autoSourceOf(def);
    $("#autoLayerInfo").hidden = !source;
    $("#tilesetCanvasHost").hidden = !!source;
    $<HTMLElement>(".tile-flip").hidden = !!source;
    if (source) {
      const count = def.autoRules?.length ?? 0;
      $("#autoLayerText").textContent =
        `Generated from "${source.identifier}" by ${count} rule${count === 1 ? "" : "s"}. Paint on "${source.identifier}" and the tiles follow.`;
      $("#tilePickerHint").textContent = "";
      return;
    }
    this.tilePicker.render(this.project, tileset, context?.selection ?? null);
    $("#tilePickerHint").textContent = tileset
      ? "Click a tile, or drag to pick a stamp. X / Y flip. Right mouse erases."
      : "This layer has no tileset. Import one in Project settings.";
  }

  private renderLevelsList(): void {
    this.levelsList.render(this.project, levelStore.getState().selectedLevelUid);
  }

  private renderProjectInfo(): void {
    const name = $<HTMLInputElement>("#projectName");
    if (name.value !== this.project.name) name.value = this.project.name;
    // The active layer's grid in the level view (layers can have their own).
    const grid =
      this.view === "level" ? this.project.layerGridSize(this.activeDef()) : this.project.gridSize;
    $("#statGrid").textContent = `${grid}×${grid} px`;
  }

  private renderWorldSettings(): void {
    const { worldLayout, worldGrid } = this.project;
    const select = $<HTMLSelectElement>("#worldLayoutSelect");
    if (select.value !== worldLayout) select.value = worldLayout;
    $<HTMLInputElement>("#worldGridWidth").value = String(worldGrid.width);
    $<HTMLInputElement>("#worldGridHeight").value = String(worldGrid.height);
    $("#worldGridFields").hidden = worldLayout !== "gridvania";
  }

  private renderLevelInfo(): void {
    const levelName = $<HTMLInputElement>("#levelName");
    if (levelName.value !== this.level.identifier) levelName.value = this.level.identifier;
    $("#levelSize").textContent = `${this.level.width} × ${this.level.height} cells`;
    $("#currentLevelName").textContent = this.level.identifier;

    const level = this.level;
    const project = this.project;
    $<HTMLInputElement>("#levelBg").value = project.levelBackground(level);
    const useDefault = $<HTMLButtonElement>("#levelBgDefault");
    useDefault.disabled = level.bgColor === null;
    useDefault.title =
      level.bgColor === null
        ? "This level uses the project's default background"
        : "Use the project's default background";
    const editFields = Object.assign(document.createElement("button"), {
      className: "btn btn-small level-fields-link",
      textContent: project.defs.levelFields.length ? "Edit level fields…" : "Add level fields…",
      title: "Level fields are defined in Project settings → Levels",
    });
    editFields.addEventListener("click", () => this.settings.open(project, null, "levels"));
    $("#levelFields").replaceChildren(
      editFields,
      ...project.defs.levelFields.map((field) =>
        fieldInput({
          project,
          field,
          level,
          value: fieldValue(level, field, project.defs.enums),
          set: (next) =>
            this.setLevelProperties(
              { fields: { ...level.fields, [field.uid]: next } },
              `Set level ${field.identifier}`
            ),
        })
      )
    );
  }

  /** Picks a game JSON file and adds it as a new level of this project. */
  private importGameLevel(): void {
    const input = Object.assign(document.createElement("input"), {
      type: "file",
      accept: ".json,application/json",
    });
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) return;
      void file.text().then((text) => {
        let json: unknown;
        try {
          json = JSON.parse(text);
        } catch {
          this.showMessage(`${file.name} is not valid JSON.`, 4000);
          return;
        }
        this.levelOps.importFromGame(json, file.name);
      });
    });
    input.click();
  }

  /** Changes the open level's background or field values as one undo step. */
  private setLevelProperties(props: Partial<LevelProperties>, label: string): void {
    this.history.execute(new SetLevelPropertiesCommand(this.project, this.level, props, label));
  }

  private showMessage(text: string, timeout = 2500): void {
    const el = $("#statMessage");
    el.textContent = text;
    if (this.messageTimer) clearTimeout(this.messageTimer);
    this.messageTimer = setTimeout(() => (el.textContent = ""), timeout);
  }
}
