import type { HistoryState, Position, ToolType } from "@foundry2d/core";
import type { ColorPickerButton } from "@foundry2d/ui";
import type { ApplicationContext } from "../types";
import { ApplicationStateActions, applicationStore } from "../state";

const $ = <T extends Element = HTMLElement>(selector: string) =>
  document.querySelector<T>(selector);
const $$ = <T extends Element = HTMLElement>(selector: string) => [
  ...document.querySelectorAll<T>(selector),
];

/**
 * View mediator: turns DOM events into store actions / app commands and
 * reflects store state back into the DOM. Every reflection is idempotent
 * (it compares before touching the DOM) so there are no feedback loops.
 */
export default class UIManager {
  private readonly elements = {
    documentSizeSelect: $<HTMLSelectElement>("#documentSizeSelect"),
    exportScale: $<HTMLSelectElement>("#exportScale"),
    colorPicker: $<ColorPickerButton>("#colorPicker"),
    gridToggle: $<HTMLInputElement>("#gridToggle"),
    previewToggle: $<HTMLInputElement>("#previewToggle"),
    openFileInput: $<HTMLInputElement>("#openFileInput"),
    coordsDisplay: $("#coordsDisplay"),
    sizeDisplay: $("#sizeDisplay"),
    layerDisplay: $("#layerDisplay"),
    zoomDisplay: $("#zoomDisplay"),
    messageDisplay: $("#messageDisplay"),
    tools: $$<HTMLButtonElement>("[data-tool]"),
    sizes: $$<HTMLButtonElement>("[data-size]"),
    swatches: $$<HTMLButtonElement>("[data-color]"),
    commands: $$<HTMLButtonElement>("[data-command]"),
  };
  private messageTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly app: ApplicationContext) {
    this.attachDOMEventListeners();
    this.attachStateChangeListeners();
    this.reflectAll();
  }

  // ------------------------------------------------------------------ DOM → app

  private attachDOMEventListeners(): void {
    const el = this.elements;

    for (const button of el.tools) {
      button.addEventListener("click", () =>
        applicationStore.dispatch(ApplicationStateActions.SetTool, button.dataset.tool as ToolType)
      );
    }

    for (const button of el.sizes) {
      button.addEventListener("click", () =>
        applicationStore.dispatch(ApplicationStateActions.EditPen, {
          size: Number(button.dataset.size),
        })
      );
    }

    el.colorPicker?.addEventListener("color-changed", (ev) => {
      applicationStore.dispatch(ApplicationStateActions.SetColor, { color: ev.detail.hex });
    });

    for (const swatch of el.swatches) {
      swatch.addEventListener("click", () => {
        const color = swatch.dataset.color;
        if (color) applicationStore.dispatch(ApplicationStateActions.SetColor, { color });
      });
    }

    el.gridToggle?.addEventListener("change", () =>
      applicationStore.dispatch(ApplicationStateActions.ToggleGrid, {
        enabled: el.gridToggle!.checked,
      })
    );
    el.previewToggle?.addEventListener("change", () =>
      applicationStore.dispatch(ApplicationStateActions.TogglePreview, {
        enabled: el.previewToggle!.checked,
      })
    );

    el.documentSizeSelect?.addEventListener("change", () => {
      const [w, h] = el.documentSizeSelect!.value.split("x").map(Number);
      if (w > 0 && h > 0) this.app.resizeDocument(w, h);
    });

    el.openFileInput?.addEventListener("change", () => {
      const file = el.openFileInput!.files?.[0];
      el.openFileInput!.value = "";
      if (file) void this.app.openProject(file);
    });

    for (const button of el.commands) {
      button.addEventListener("click", () => this.runCommand(button.dataset.command ?? ""));
    }
  }

  /** Runs a toolbar command by name. Also used by keyboard shortcuts. */
  runCommand(command: string): void {
    const { app } = this;
    switch (command) {
      case "new":
        app.newDocument();
        break;
      case "open":
        this.elements.openFileInput?.click();
        break;
      case "save":
        app.saveProject();
        break;
      case "export":
        void app.exportPNG(Number(this.elements.exportScale?.value ?? 1));
        break;
      case "undo":
        app.undo();
        break;
      case "redo":
        app.redo();
        break;
      case "clear":
        app.clearLayer();
        break;
      case "zoom-in":
        app.zoomBy(1.25);
        break;
      case "zoom-out":
        app.zoomBy(0.8);
        break;
      case "fit":
        app.fitToView();
        break;
    }
  }

  // ------------------------------------------------------------------ store → DOM

  private attachStateChangeListeners(): void {
    applicationStore.select(
      (s) => s.currentColor,
      (color) => this.updateColor(color)
    );
    applicationStore.select(
      (s) => s.currentTool,
      (tool) => this.updateTool(tool)
    );
    applicationStore.select(
      (s) => s.penSize,
      (size) => this.updatePenSize(size)
    );
    applicationStore.select(
      (s) => s.doc.size,
      ({ width, height }) => this.updateSize(width, height)
    );
    applicationStore.select(
      (s) => s.preferences.grid.enabled,
      (enabled) => this.setChecked(this.elements.gridToggle, enabled)
    );
    applicationStore.select(
      (s) => s.preferences.preview.enabled,
      (enabled) => this.setChecked(this.elements.previewToggle, enabled)
    );
  }

  private reflectAll(): void {
    const state = applicationStore.getState();
    this.updateColor(state.currentColor);
    this.updateTool(state.currentTool);
    this.updatePenSize(state.penSize);
    this.updateSize(state.doc.size.width, state.doc.size.height);
    this.setChecked(this.elements.gridToggle, state.preferences.grid.enabled);
    this.setChecked(this.elements.previewToggle, state.preferences.preview.enabled);
  }

  private setChecked(input: HTMLInputElement | null, checked: boolean): void {
    if (input && input.checked !== checked) input.checked = checked;
  }

  private updateTool(name: ToolType): void {
    for (const button of this.elements.tools) {
      const active = button.dataset.tool === name;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    }
  }

  private updatePenSize(size: number): void {
    for (const button of this.elements.sizes) {
      const active = Number(button.dataset.size) === size;
      button.classList.toggle("active", active);
      button.setAttribute("aria-checked", String(active));
    }
  }

  private updateColor(color: string): void {
    const picker = this.elements.colorPicker;
    if (picker && picker.value.toLowerCase() !== color.toLowerCase()) picker.value = color;
    for (const swatch of this.elements.swatches) {
      swatch.classList.toggle(
        "active",
        swatch.dataset.color?.toLowerCase() === color.toLowerCase()
      );
    }
  }

  private updateSize(width: number, height: number): void {
    const select = this.elements.documentSizeSelect;
    const value = `${width}x${height}`;
    if (select && select.value !== value) {
      // Projects may use sizes that aren't presets: add them on the fly.
      if (![...select.options].some((o) => o.value === value)) {
        select.add(new Option(`${width} × ${height}`, value));
      }
      select.value = value;
    }
    if (this.elements.sizeDisplay) this.elements.sizeDisplay.textContent = `${width} × ${height}`;
  }

  // ------------------------------------------------------------------ status

  updatePointer(grid: Position | null): void {
    const el = this.elements.coordsDisplay;
    if (el) el.textContent = grid ? `X: ${grid.x}, Y: ${grid.y}` : "—";
  }

  updateZoom(zoom: number): void {
    const el = this.elements.zoomDisplay;
    if (el) el.textContent = `Zoom: ${Math.round(zoom * 100)}%`;
  }

  updateLayer(name: string): void {
    const el = this.elements.layerDisplay;
    if (el) el.textContent = `Layer: ${name}`;
  }

  updateHistory(state: HistoryState): void {
    for (const button of this.elements.commands) {
      const command = button.dataset.command;
      if (command === "undo") {
        button.disabled = !state.canUndo;
        button.title = state.undoLabel ? `Undo ${state.undoLabel} (Ctrl+Z)` : "Undo (Ctrl+Z)";
      } else if (command === "redo") {
        button.disabled = !state.canRedo;
        button.title = state.redoLabel
          ? `Redo ${state.redoLabel} (Ctrl+Shift+Z)`
          : "Redo (Ctrl+Shift+Z)";
      }
    }
  }

  /** Shows a transient status message. */
  showMessage(text: string, timeout = 2500): void {
    const el = this.elements.messageDisplay;
    if (!el) return;
    el.textContent = text;
    if (this.messageTimer) clearTimeout(this.messageTimer);
    this.messageTimer = setTimeout(() => (el.textContent = ""), timeout);
  }
}
