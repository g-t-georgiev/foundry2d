import {
  HistoryManager,
  JsonRecovery,
  RectangleTool,
  ResizeCommand,
  ToolManager,
  type Unsubscribe,
} from "@foundry2d/core";
import { GridDocumentScene, Workspace } from "@foundry2d/workspace";
import type { LayersPanel } from "@foundry2d/ui";
import type { Level, LevelProject } from "./model/LevelProject";
import type { LayerDef } from "./model/types";
import { createProjectFromPreset, presets, DEFAULT_PRESET_ID } from "./model/presets";
import { LevelActions, levelStore, type LevelTool } from "./state";
import PaletteView from "./ui/PaletteView";
import LevelLayersController from "./ui/LevelLayersController";
import SettingsDialog from "./ui/SettingsDialog";
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

function download(text: string, filename: string): void {
  const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/**
 * Composition root of the level designer.
 *
 * The workspace, tools, store bindings and static DOM wiring live for the
 * whole session. Everything tied to a particular project (scene, layer
 * controller, model subscriptions) lives in `session` and is rebuilt when a
 * project is opened or created.
 */
export default class Application {
  readonly history = new HistoryManager();
  readonly tools = new ToolManager<Int32Array>();
  readonly workspace: Workspace;
  project: LevelProject;
  level: Level;
  scene!: GridDocumentScene<Int32Array>;

  private session: { layers: LevelLayersController; unsubscribe: Unsubscribe[] } | null = null;
  private readonly palette: PaletteView;
  private readonly settings: SettingsDialog;
  private readonly recovery: JsonRecovery;
  private readonly layersPanel: LayersPanel;
  private altHeld = false;
  private messageTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.tools.registerTool(new RectangleTool<Int32Array>("rect", true));

    this.project = createProjectFromPreset(DEFAULT_PRESET_ID);
    this.level = this.project.levels[0];

    this.workspace = new Workspace($("#viewport"), {
      canvas: $<HTMLCanvasElement>("#levelCanvas"),
      rulers: { unitScale: () => this.project.gridSize, unitLabel: () => "t" },
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
    this.settings = new SettingsDialog($<HTMLDialogElement>("#settingsDialog"), {
      confirm: (message) => window.confirm(message),
      onDestructiveChange: () => this.history.clear(),
    });
    this.recovery = new JsonRecovery(
      "level-designer:autosave",
      () => serializeProject(this.project),
      {
        onSaved: () => this.showMessage("Autosaved", 1200),
        onError: (error) => console.warn("Autosave failed", error),
      }
    );

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

  // ------------------------------------------------------------------ project lifecycle

  loadProject(project: LevelProject, levelUid?: number): void {
    this.workspace.input.cancelStroke();
    this.session?.layers.destroy();
    this.session?.unsubscribe.forEach((unsubscribe) => unsubscribe());

    this.project = project;
    this.level =
      (levelUid !== undefined ? project.getLevel(levelUid) : undefined) ?? project.levels[0];
    this.history.clear();

    const { doc } = this.level;
    const refreshLayerUi = () => {
      this.renderPalette();
      this.workspace.refreshCursor();
    };
    const persist = () => this.recovery.schedule();

    this.session = {
      layers: new LevelLayersController(this.layersPanel, project, this.level, this.history),
      unsubscribe: [
        doc.events.on("layer:activated", refreshLayerUi),
        doc.events.on("layer:activated", persist),
        doc.events.on("resized", () => this.renderLevelInfo()),
        project.events.on("defs:changed", () => {
          refreshLayerUi();
          this.scene.invalidate();
          persist();
        }),
        project.events.on("settings:changed", () => {
          this.rebuildScene(false);
          this.renderProjectInfo();
          persist();
        }),
        project.events.on("levels:changed", persist),
      ],
    };

    this.rebuildScene(true);
    this.renderProjectInfo();
    this.renderLevelInfo();
    refreshLayerUi();
  }

  /** The scene's cell size is fixed, so a grid size change needs a new scene. */
  private rebuildScene(fit: boolean): void {
    const project = this.project;
    const { gridSize } = project;
    this.scene = new GridDocumentScene<Int32Array>({
      doc: this.level.doc,
      tools: this.tools,
      history: this.history,
      cellSize: { width: gridSize, height: gridSize },
      getValue: () => this.currentValue(),
      getColorizer: (layer) => project.colorizerFor(layer.id),
      getPaletteVersion: () => project.paletteVersion,
      getCursorFill: () => {
        const entry = this.activeDef()?.intGridValues.find((v) => v.value === this.currentValue());
        return entry ? `${entry.color}88` : null;
      },
      onPickValue: (value) => this.pickValue(value),
      showGrid: () => levelStore.getState().grid.enabled,
      majorGridEvery: 4,
      checkerboard: true,
    });
    const camera = fit ? undefined : this.workspace.camera.getState();
    void this.workspace.setScene(this.scene, { fit, camera });
  }

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

  exportGame(): void {
    const json = JSON.stringify(toGameFormat(this.project, this.level), null, 2);
    download(json, `${this.project.name}.json`);
    this.showMessage("Exported game JSON");
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

  /** Grows (+) or shrinks (−) the level on each edge, as one undo step. */
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
    this.history.execute(
      new ResizeCommand(doc, { width, height }, { x: edges.left, y: edges.top })
    );
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
    const selected = levelStore.getState().selectedValues[String(def.uid)];
    if (selected !== undefined && def.intGridValues.some((v) => v.value === selected))
      return selected;
    return def.intGridValues[0]?.value ?? 0;
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
    if (value !== 0) this.selectValue(value);
    if (!this.altHeld) {
      levelStore.dispatch(LevelActions.SetTool, levelStore.getState().previousTool);
    }
  }

  // ------------------------------------------------------------------ bindings

  private bindStore(): void {
    this.tools.setTool(levelStore.getState().currentTool);
    levelStore.select(
      (s) => s.currentTool,
      (tool) => {
        this.tools.setTool(tool);
        this.renderTools();
      }
    );
    levelStore.select(
      (s) => s.selectedValues,
      () => {
        this.renderPalette();
        this.scene.invalidate();
      }
    );
    levelStore.select(
      (s) => s.grid.enabled,
      (enabled) => {
        const toggle = $<HTMLInputElement>("#gridToggle");
        if (toggle.checked !== enabled) toggle.checked = enabled;
        this.scene.invalidate();
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
      const name = levelName.value.trim();
      if (name) {
        this.level.identifier = name;
        this.project.events.emit("levels:changed");
      } else {
        levelName.value = this.level.identifier;
      }
    });

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
    }
  }

  private bindKeys(): void {
    const { keymap } = this.workspace;
    const tool = (name: LevelTool) => () => void levelStore.dispatch(LevelActions.SetTool, name);

    keymap.bind("mod+z", () => void this.history.undo(), { repeat: true });
    keymap.bind("mod+shift+z", () => void this.history.redo(), { repeat: true });
    keymap.bind("mod+y", () => void this.history.redo(), { repeat: true });
    keymap.bind("mod+s", () => this.saveProject());
    keymap.bind("mod+o", () => this.runCommand("open"));
    keymap.bind("mod+e", () => this.exportGame());
    keymap.bind("mod+shift+c", () => void this.copyActiveLayer());
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
    for (let i = 1; i <= 9; i++) {
      keymap.bind(String(i), () => {
        const entry = this.activeDef()?.intGridValues[i - 1];
        if (entry) this.selectValue(entry.value);
      });
    }
    keymap.hold(
      "alt",
      () => {
        this.altHeld = true;
        levelStore.dispatch(LevelActions.SetTool, "eyedropper");
      },
      () => {
        this.altHeld = false;
        const { currentTool, previousTool } = levelStore.getState();
        if (currentTool === "eyedropper") levelStore.dispatch(LevelActions.SetTool, previousTool);
      }
    );
  }

  private bindStatus(): void {
    const cell = $("#statCell");
    const value = $("#statValue");
    this.workspace.events.on("pointer:move", ({ grid, inside }) => {
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

  private renderTools(): void {
    const { currentTool } = levelStore.getState();
    for (const button of document.querySelectorAll<HTMLButtonElement>("[data-tool]")) {
      const active = button.dataset.tool === currentTool;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    }
  }

  private renderPalette(): void {
    this.palette.render(this.activeDef(), this.currentValue());
  }

  private renderProjectInfo(): void {
    const name = $<HTMLInputElement>("#projectName");
    if (name.value !== this.project.name) name.value = this.project.name;
    $("#statGrid").textContent = `${this.project.gridSize}×${this.project.gridSize} px`;
  }

  private renderLevelInfo(): void {
    const levelName = $<HTMLInputElement>("#levelName");
    if (levelName.value !== this.level.identifier) levelName.value = this.level.identifier;
    $("#levelSize").textContent = `${this.level.width} × ${this.level.height} cells`;
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
