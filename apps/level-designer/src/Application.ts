import {
  CompositeCommand,
  HistoryManager,
  JsonRecovery,
  RectangleTool,
  StampTool,
  type StampPattern,
  ResizeCommand,
  ToolManager,
  type CameraState,
  type ICommand,
  type Rect,
  type Unsubscribe,
} from "@foundry2d/core";
import { GridDocumentScene, Workspace } from "@foundry2d/workspace";
import type { LayersPanel } from "@foundry2d/ui";
import type { Level, LevelProject } from "./model/LevelProject";
import { WORLD_LAYOUTS, type LayerDef, type WorldLayout } from "./model/types";
import { createProjectFromPreset, presets, DEFAULT_PRESET_ID } from "./model/presets";
import {
  AddLevelCommand,
  MoveLevelCommand,
  RemoveLevelCommand,
  RenameLevelCommand,
  ReorderLevelCommand,
} from "./model/commands";
import { LevelActions, levelStore, type EditorView, type LevelTool } from "./state";
import PaletteView from "./ui/PaletteView";
import TilesetPickerView from "./ui/TilesetPickerView";
import { tileLayerRendererFor } from "./render/tileLayerRenderer";
import { decodeTile, selectionToPattern, tilesetGrid } from "./model/tiles";
import LevelLayersController from "./ui/LevelLayersController";
import LevelsListView from "./ui/LevelsListView";
import SettingsDialog from "./ui/SettingsDialog";
import { WorldScene } from "./world/WorldScene";
import {
  PROJECT_EXTENSION,
  ProjectFormatError,
  deserializeProject,
  isProjectFile,
  serializeProject,
} from "./io/projectFile";
import { formatLayerAsArray, fromGameFormat, isGameFormat, toGameFormat } from "./io/gameFormat";

const $ = <T extends Element = HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;

const TRANSITION_MS = 320;

function download(text: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Grows a rectangle by `amount` on every side. */
const inflate = (r: Rect, amount: number): Rect => ({
  x: r.x - amount,
  y: r.y - amount,
  width: r.width + amount * 2,
  height: r.height + amount * 2,
});

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
  private readonly recovery: JsonRecovery;
  private readonly layersPanel: LayersPanel;
  private altHeld = false;
  private transitioning = false;
  private messageTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.tools.registerTool(new RectangleTool<Int32Array>("rect", true));
    // Engine-only tool: the pen becomes a stamp when several tiles are selected.
    this.tools.registerTool(new StampTool<Int32Array>(() => this.currentPattern(), "stamp"));

    this.project = createProjectFromPreset(DEFAULT_PRESET_ID);
    this.level = this.project.levels[0];

    this.workspace = new Workspace($("#viewport"), {
      canvas: $<HTMLCanvasElement>("#levelCanvas"),
      rulers: {
        unitScale: () => (this.view === "level" ? this.project.gridSize : 1),
        unitLabel: () => (this.view === "level" ? "t" : "px"),
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
      add: () => this.addLevel(),
      duplicate: (uid) => this.duplicateLevel(uid),
      remove: (uid) => this.removeLevel(uid),
      move: (uid, direction) => this.reorderLevel(uid, direction),
      rename: (uid, identifier) => this.renameLevel(uid, identifier),
    });
    this.settings = new SettingsDialog($<HTMLDialogElement>("#settingsDialog"), {
      confirm: (message) => window.confirm(message),
      onDestructiveChange: () => this.history.clear(),
      notify: (message) => this.showMessage(message, 5000),
    });
    this.recovery = new JsonRecovery(
      "level-designer:autosave",
      () => serializeProject(this.project),
      {
        onSaved: () => this.showMessage("Autosaved", 1200),
        onError: (error) => console.warn("Autosave failed", error),
      }
    );

    this.tilePicker = new TilesetPickerView($("#tilesetCanvasHost"), (tileset, selection) => {
      levelStore.dispatch(LevelActions.SelectTiles, { tilesetUid: tileset.uid, ...selection });
      const { currentTool } = levelStore.getState();
      if (currentTool === "eraser" || currentTool === "eyedropper") {
        levelStore.dispatch(LevelActions.SetTool, "pen");
      }
    });

    this.renderPresets();
    this.bindStore();
    this.bindDom();
    this.bindKeys();
    this.bindStatus();
    this.history.onChange((state) => {
      $<HTMLButtonElement>('[data-command="undo"]').disabled = !state.canUndo;
      $<HTMLButtonElement>('[data-command="redo"]').disabled = !state.canRedo;
      this.recovery.schedule();
    });

    this.loadProject(this.project);
    void this.restoreAutosave();
  }

  get view(): EditorView {
    return levelStore.getState().view;
  }

  // ------------------------------------------------------------------ project lifecycle

  loadProject(project: LevelProject): void {
    this.workspace.input.cancelStroke();
    this.projectSession.forEach((unsubscribe) => unsubscribe());

    this.project = project;
    this.history.clear();
    this.worldScene = this.createWorldScene();

    const persist = () => this.recovery.schedule();
    this.projectSession = [
      project.events.on("tilesets:loaded", () => {
        this.workspace.requestRender();
        this.tilePicker.draw();
      }),
      project.events.on("defs:changed", () => {
        this.syncEngineTool();
        this.renderPalette();
        this.workspace.refreshCursor();
        this.levelScene.invalidate();
        persist();
      }),
      project.events.on("settings:changed", () => {
        this.refreshScenes();
        this.renderProjectInfo();
        this.renderWorldSettings();
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
    void this.workspace.setScene(view === "world" ? this.worldScene : this.levelScene, {
      fit: true,
    });
    this.renderView();
  }

  /** Binds the panels and the level scene to `level`. */
  private openLevelSession(level: Level): void {
    this.workspace.input.cancelStroke();
    this.levelSession?.layers.destroy();
    this.levelSession?.unsubscribe.forEach((unsubscribe) => unsubscribe());

    this.level = level;
    const { doc } = level;
    const refreshLayerUi = () => {
      this.renderPalette();
      this.workspace.refreshCursor();
    };
    this.levelSession = {
      layers: new LevelLayersController(this.layersPanel, this.project, level, this.history),
      unsubscribe: [
        doc.events.on("layer:activated", refreshLayerUi),
        doc.events.on("layer:activated", () => this.recovery.schedule()),
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
    return new GridDocumentScene<Int32Array>({
      doc: level.doc,
      tools: this.tools,
      history: this.history,
      cellSize: { width: gridSize, height: gridSize },
      getValue: () => this.currentValue(),
      getColorizer: (layer) => project.colorizerFor(layer.id),
      getLayerRenderer: tileLayerRendererFor(project),
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
    });
  }

  private createWorldScene(): WorldScene {
    return new WorldScene(this.project, {
      getSelectedUid: () => levelStore.getState().selectedLevelUid,
      select: (uid) => this.selectLevel(uid, false),
      open: (uid) => void this.enterLevel(uid),
      createAt: (x, y) => this.addLevel(x, y),
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

  /** Opens a level for editing, zooming in from its place in the world. */
  async enterLevel(uid: number, animate = true): Promise<void> {
    const level = this.project.getLevel(uid);
    if (!level || this.transitioning) return;
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
    this.transitioning = true;
    try {
      await this.workspace.setScene(this.levelScene, { camera: start });
      await this.workspace.fitToView(TRANSITION_MS);
    } finally {
      this.transitioning = false;
    }
  }

  /** Returns to the world, zooming out around the level that was open. */
  async showWorld(animate = true): Promise<void> {
    if (this.view === "world" || this.transitioning) return;
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
    this.transitioning = true;
    try {
      await this.workspace.setScene(this.worldScene, { camera: start });
      if (target) await this.workspace.animateTo(target, animate ? TRANSITION_MS : 0);
    } finally {
      this.transitioning = false;
    }
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

  // ------------------------------------------------------------------ world edits

  /** Adds a level the size of the selected one, at `x, y` or the next free spot. */
  addLevel(x?: number, y?: number): void {
    const template = this.selectedLevel() ?? this.level;
    const position =
      x !== undefined && y !== undefined
        ? this.project.snapPosition(x, y)
        : this.project.nextFreePosition();
    const level = this.project.createLevel("level_0", template.width, template.height, {
      worldX: position.x,
      worldY: position.y,
    });
    // Start on the same layer the user was working on.
    level.doc.setActiveLayer(template.doc.activeLayerId);
    // createLevel already inserted it; record the step for undo/redo.
    this.history.record(
      new AddLevelCommand(this.project, level, this.project.indexOfLevel(level.uid))
    );
    this.selectLevel(level.uid, x === undefined);
    this.showMessage(`Added ${level.identifier}`);
  }

  duplicateLevel(uid: number): void {
    const source = this.project.getLevel(uid);
    if (!source) return;
    const rect = source.worldRect(this.project.gridSize);
    const position = this.project.snapPosition(
      rect.x + rect.width + this.project.gridSize * 2,
      rect.y
    );
    const copy = this.project.cloneLevel(uid, position.x, position.y);
    if (!copy) return;
    this.history.execute(
      new AddLevelCommand(this.project, copy, this.project.indexOfLevel(uid) + 1)
    );
    this.selectLevel(copy.uid, true);
    this.showMessage(`Duplicated ${source.identifier}`);
  }

  removeLevel(uid: number): void {
    const level = this.project.getLevel(uid);
    if (!level) return;
    if (this.project.levels.length <= 1) {
      this.showMessage("A project needs at least one level.", 3000);
      return;
    }
    const index = this.project.indexOfLevel(uid);
    const command = new RemoveLevelCommand(this.project, level);
    command.execute();
    if (!command.succeeded) return;
    this.history.record(command);
    const next = this.project.levels[Math.min(index, this.project.levels.length - 1)];
    this.selectLevel(next?.uid ?? null, false);
    this.showMessage(`Deleted ${level.identifier} (Ctrl+Z to undo)`, 3500);
  }

  reorderLevel(uid: number, direction: "up" | "down"): void {
    const from = this.project.indexOfLevel(uid);
    const to = direction === "up" ? from - 1 : from + 1;
    if (from === -1 || to < 0 || to >= this.project.levels.length) return;
    this.history.execute(new ReorderLevelCommand(this.project, from, to));
  }

  renameLevel(uid: number, identifier: string): void {
    const level = this.project.getLevel(uid);
    if (!level || !identifier.trim() || identifier.trim() === level.identifier) return;
    this.history.execute(new RenameLevelCommand(this.project, level, identifier));
  }

  private selectedLevel(): Level | undefined {
    const uid = levelStore.getState().selectedLevelUid;
    return uid === null ? undefined : this.project.getLevel(uid);
  }

  // ------------------------------------------------------------------ files

  newProject(presetId: string = this.selectedPresetId()): void {
    const label = presets.find((p) => p.id === presetId)?.label ?? presetId;
    if (
      this.history.canUndo &&
      !confirm(`Start a new "${label}" project? Unsaved changes will be lost.`)
    ) {
      return;
    }
    this.loadProject(createProjectFromPreset(presetId));
    void this.recovery.clear();
    this.showMessage(`New project from "${label}"`);
  }

  private selectedPresetId(): string {
    return $<HTMLSelectElement>("#presetSelect").value || DEFAULT_PRESET_ID;
  }

  private renderPresets(): void {
    const select = $<HTMLSelectElement>("#presetSelect");
    select.replaceChildren(
      ...presets.map((preset) => {
        const option = new Option(preset.label, preset.id, false, preset.id === DEFAULT_PRESET_ID);
        option.title = preset.description;
        return option;
      })
    );
  }

  async openFile(file: File): Promise<void> {
    try {
      const json: unknown = JSON.parse(await file.text());
      let project: LevelProject;
      if (isProjectFile(json)) project = deserializeProject(json);
      else if (isGameFormat(json)) project = fromGameFormat(json);
      else
        throw new ProjectFormatError("Unrecognized file: expected a level project or game JSON.");
      this.loadProject(project);
      this.showMessage(`Opened ${file.name}`);
      this.recovery.schedule();
    } catch (error) {
      const message =
        error instanceof ProjectFormatError
          ? error.message
          : error instanceof SyntaxError
            ? "File is not valid JSON."
            : "Could not open file.";
      this.showMessage(message, 5000);
      console.error(error);
    }
  }

  saveProject(): void {
    download(
      JSON.stringify(serializeProject(this.project)),
      `${this.project.name}${PROJECT_EXTENSION}`
    );
    this.showMessage("Project saved");
  }

  /** Exports the level being edited (or the one selected in the world). */
  exportGame(): void {
    const level = (this.view === "world" ? this.selectedLevel() : undefined) ?? this.level;
    const json = JSON.stringify(toGameFormat(this.project, level), null, 2);
    const suffix = this.project.levels.length > 1 ? `-${level.identifier}` : "";
    download(json, `${this.project.name}${suffix}.json`);
    this.showMessage(`Exported ${level.identifier} as game JSON`);
  }

  async copyActiveLayer(): Promise<void> {
    const layer = this.level.doc.getActiveLayer();
    if (!layer) return;
    const text = formatLayerAsArray(layer.data, layer.width, layer.height);
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
    for (const button of document.querySelectorAll<HTMLButtonElement>("[data-tool]")) {
      button.addEventListener("click", () =>
        levelStore.dispatch(LevelActions.SetTool, button.dataset.tool as LevelTool)
      );
    }
    for (const button of document.querySelectorAll<HTMLButtonElement>("[data-command]")) {
      button.addEventListener("click", () => this.runCommand(button.dataset.command ?? ""));
    }
    for (const tab of document.querySelectorAll<HTMLButtonElement>("[data-view]")) {
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

    const fileInput = $<HTMLInputElement>("#openFileInput");
    fileInput.addEventListener("change", () => {
      const file = fileInput.files?.[0];
      fileInput.value = "";
      if (file) void this.openFile(file);
    });

    const projectName = $<HTMLInputElement>("#projectName");
    projectName.addEventListener("change", () => {
      const name = projectName.value.trim();
      if (name) this.project.setName(name);
      else projectName.value = this.project.name;
    });

    const levelName = $<HTMLInputElement>("#levelName");
    levelName.addEventListener("change", () => {
      this.renameLevel(this.level.uid, levelName.value);
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
        this.newProject();
        break;
      case "open":
        $<HTMLInputElement>("#openFileInput").click();
        break;
      case "save":
        this.saveProject();
        break;
      case "export":
        this.exportGame();
        break;
      case "copy-layer":
        void this.copyActiveLayer();
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

  private bindKeys(): void {
    const { keymap } = this.workspace;
    const inLevel = (fn: () => void) => () => {
      if (this.view === "level") fn();
      else return false;
    };
    const inWorld = (fn: () => void) => () => {
      if (this.view === "world") fn();
      else return false;
    };
    const tool = (name: LevelTool) =>
      inLevel(() => void levelStore.dispatch(LevelActions.SetTool, name));

    keymap.bind("mod+z", () => void this.history.undo(), { repeat: true });
    keymap.bind("mod+shift+z", () => void this.history.redo(), { repeat: true });
    keymap.bind("mod+y", () => void this.history.redo(), { repeat: true });
    keymap.bind("mod+s", () => this.saveProject());
    keymap.bind("mod+o", () => this.runCommand("open"));
    keymap.bind("mod+e", () => this.exportGame());
    keymap.bind(
      "mod+shift+c",
      inLevel(() => void this.copyActiveLayer())
    );
    keymap.bind("b", tool("pen"));
    keymap.bind("e", tool("eraser"));
    keymap.bind("r", tool("rect"));
    keymap.bind("g", tool("bucket"));
    keymap.bind("i", tool("eyedropper"));
    keymap.bind("f", () => void this.workspace.fitToView(200));
    keymap.bind("#", () => {
      levelStore.dispatch(LevelActions.ToggleGrid, {
        enabled: !levelStore.getState().grid.enabled,
      });
    });
    keymap.bind("+", () => this.workspace.zoomBy(1.25), { repeat: true });
    keymap.bind("=", () => this.workspace.zoomBy(1.25), { repeat: true });
    keymap.bind("-", () => this.workspace.zoomBy(0.8), { repeat: true });
    const toggleFlip = (axis: "x" | "y") =>
      inLevel(() => {
        if (this.activeDef()?.type !== "Tiles") return;
        const flip = { ...levelStore.getState().tileFlip };
        flip[axis] = !flip[axis];
        levelStore.dispatch(LevelActions.SetTileFlip, flip);
      });
    keymap.bind("x", toggleFlip("x"));
    keymap.bind("y", toggleFlip("y"));
    for (let i = 1; i <= 9; i++) {
      keymap.bind(
        String(i),
        inLevel(() => {
          const entry = this.activeDef()?.intGridValues[i - 1];
          if (entry) this.selectValue(entry.value);
        })
      );
    }

    // View navigation.
    keymap.bind(
      "escape",
      inLevel(() => void this.showWorld())
    );
    keymap.bind(
      "enter",
      inWorld(() => {
        const uid = this.selectedLevel()?.uid;
        if (uid !== undefined) void this.enterLevel(uid);
      })
    );
    keymap.bind(
      "delete",
      inWorld(() => {
        const uid = this.selectedLevel()?.uid;
        if (uid !== undefined) this.removeLevel(uid);
      })
    );
    keymap.bind(
      "mod+d",
      inWorld(() => {
        const uid = this.selectedLevel()?.uid;
        if (uid !== undefined) this.duplicateLevel(uid);
      })
    );

    keymap.hold(
      "alt",
      () => {
        if (this.view !== "level") return;
        this.altHeld = true;
        levelStore.dispatch(LevelActions.SetTool, "eyedropper");
      },
      () => {
        if (!this.altHeld) return;
        this.altHeld = false;
        const { currentTool, previousTool } = levelStore.getState();
        if (currentTool === "eyedropper") levelStore.dispatch(LevelActions.SetTool, previousTool);
      }
    );
  }

  private bindStatus(): void {
    const cell = $("#statCell");
    const value = $("#statValue");
    this.workspace.events.on("pointer:move", ({ grid, world, inside }) => {
      if (this.view === "world") {
        const level = inside ? this.project.levelAt(world.x, world.y) : undefined;
        cell.textContent = inside ? `${Math.floor(world.x)}, ${Math.floor(world.y)} px` : "—";
        value.textContent = level ? level.identifier : "—";
        return;
      }
      const { doc } = this.level;
      const onLevel =
        inside && grid.x >= 0 && grid.y >= 0 && grid.x < doc.width && grid.y < doc.height;
      if (!onLevel) {
        cell.textContent = "—";
        value.textContent = "—";
        return;
      }
      cell.textContent = `${grid.x}, ${grid.y}`;
      const layer = doc.getActiveLayer();
      const v = layer?.get(grid.x, grid.y) ?? 0;
      const def = layer ? this.project.getLayerDefForLayer(layer.id) : undefined;
      if (def?.type === "Tiles") {
        const tile = decodeTile(v);
        value.textContent = tile
          ? `tile #${tile.tileId}${tile.flipX ? " ↔" : ""}${tile.flipY ? " ↕" : ""}`
          : "empty";
        return;
      }
      value.textContent =
        v === 0
          ? "empty"
          : `${def?.intGridValues.find((e) => e.value === v)?.identifier ?? "?"} (${v})`;
    });
    const zoom = (z: number) => {
      const text = `${Math.round(z * 100)}%`;
      $("#statZoom").textContent = text;
      $("#zoomHud").textContent = text;
    };
    this.workspace.events.on("camera:changed", ({ zoom: z }) => zoom(z));
    zoom(this.workspace.zoom);
  }

  // ------------------------------------------------------------------ rendering

  private renderView(): void {
    const view = this.view;
    document.body.dataset.view = view;
    for (const tab of document.querySelectorAll<HTMLButtonElement>("[data-view]")) {
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

  private renderPalette(): void {
    const def = this.activeDef();
    const isTiles = def?.type === "Tiles";
    $("#palette").hidden = isTiles;
    $("#paletteHint").hidden = isTiles;
    $("#tilePicker").hidden = !isTiles;
    if (!isTiles) {
      this.palette.render(def, this.currentValue());
      return;
    }
    const context = this.tileContext();
    const tileset = this.project.getTileset(def.tilesetUid);
    $("#paletteLayer").textContent = `${def.identifier} · ${tileset?.identifier ?? "no tileset"}`;
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
    $("#statGrid").textContent = `${this.project.gridSize}×${this.project.gridSize} px`;
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
  }

  private showMessage(text: string, timeout = 2500): void {
    const el = $("#statMessage");
    el.textContent = text;
    if (this.messageTimer) clearTimeout(this.messageTimer);
    this.messageTimer = setTimeout(() => (el.textContent = ""), timeout);
  }

  private async restoreAutosave(): Promise<void> {
    const json = await this.recovery.load();
    if (json === null || this.history.canUndo) return;
    try {
      this.loadProject(deserializeProject(json));
      this.showMessage("Restored previous session");
    } catch (error) {
      console.warn("Ignoring unreadable autosave", error);
    }
  }
}
