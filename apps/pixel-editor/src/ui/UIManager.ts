import { type Position, type ToolType } from "@foundry2d/core";
import type { ColorPickerButton } from "@foundry2d/ui";
import type { ApplicationContext } from "../types";
import { ApplicationStateActions, applicationStore } from "../state";

export default class UIManager {
  private elements = {
    documentSizeSelect: document.querySelector<HTMLSelectElement>("#documentSizeSelect"),
    penSizeSelect: document.querySelector<HTMLSelectElement>("#penSizeSelect"),
    colorPicker: document.querySelector<ColorPickerButton>("#colorPicker"),
    gridToggleBtn: document.querySelector<HTMLInputElement>("#gridToggleBtn"),
    coordsDisplay: document.querySelector("#coordsDisplay"),
    zoomDisplay: document.querySelector("#zoomDisplay"),
    btnZoomIn: document.querySelector("#btnZoomIn"),
    btnZoomOut: document.querySelector("#btnZoomOut"),
    btnZoomFit: document.querySelector("#btnZoomFit"),
    btnClear: document.querySelector("#btnClear"),
    btnExport: document.querySelector("#btnExport"),
    previewToggleBtn: document.querySelector<HTMLInputElement>("#previewToggleBtn"),
    tools: {
      pen: document.querySelector("#toolPen"),
      bucket: document.querySelector("#toolBucket"),
      eraser: document.querySelector("#toolEraser"),
      eyedropper: document.querySelector("#toolEyedropper"),
    } as Record<ToolType, HTMLElement | null>,
  } as const;

  constructor(private app: ApplicationContext) {
    this.attachDOMEventListeners();
    this.attachStateChangeListeners();
  }

  private attachDOMEventListeners() {
    const { btnExport, previewToggleBtn } = this.elements;

    this.attachToolHandlers();
    this.attachColorChangeHandlers();
    this.attachDocumentHandlers();
    this.attachZoomButtonHandlers();

    btnExport?.addEventListener("click", () => this.app.exportPNG());

    previewToggleBtn?.addEventListener("change", (ev) => {
      const target = ev.target as HTMLInputElement;
      this.app.isPreviewMode = target.checked;
    });
  }

  private attachZoomButtonHandlers() {
    const { btnZoomIn, btnZoomOut, btnZoomFit } = this.elements;

    // Zoom Buttons
    btnZoomIn?.addEventListener("click", () => this.app.zoomBy(1.2));
    btnZoomOut?.addEventListener("click", () => this.app.zoomBy(0.8));
    btnZoomFit?.addEventListener("click", () => this.app.fitToView());
  }

  private attachColorChangeHandlers() {
    const { colorPicker } = this.elements;

    // Color Picker
    colorPicker?.addEventListener("color-changed", (ev) => {
      applicationStore.dispatch(ApplicationStateActions.SetColor, {
        color: ev.detail.hex,
      });
    });

    // Palette Swatches
    const colorSwatches = document.querySelectorAll<HTMLElement>(".palette-swatch");
    colorSwatches.forEach((swatch) => {
      swatch.addEventListener("click", () => {
        const color = swatch.dataset.color;

        if (!color) return;

        applicationStore.dispatch(ApplicationStateActions.SetColor, { color });
      });
    });
  }

  private attachDocumentHandlers() {
    const { gridToggleBtn, documentSizeSelect, btnClear } = this.elements;

    gridToggleBtn?.addEventListener("change", (ev) => {
      const target = ev.target as HTMLInputElement;
      applicationStore.dispatch(ApplicationStateActions.ToggleGrid, { enabled: target.checked });
    });

    documentSizeSelect?.addEventListener("change", (ev) => {
      const target = ev.target as HTMLInputElement;
      const [w, h] = target.value.split("x").map(Number);
      this.app.resizeDocument(w, h);
    });

    btnClear?.addEventListener("click", () => this.app.clearDocument());
  }

  private attachToolHandlers() {
    const { tools, penSizeSelect } = this.elements;

    const toolBtnKeys = Object.keys(tools) as ToolType[];
    toolBtnKeys.forEach((name) => {
      const toolBtn = tools[name];
      toolBtn?.addEventListener("click", () =>
        applicationStore.dispatch(ApplicationStateActions.SetTool, name)
      );
    });

    penSizeSelect?.addEventListener("change", (ev) => {
      const target = ev.target as HTMLInputElement;
      const size = parseInt(target.value, 10);
      applicationStore.dispatch(ApplicationStateActions.EditPen, { size });
    });
  }

  private attachStateChangeListeners() {
    applicationStore.select(
      (state) => state.currentColor,
      (color) => this.updateColorUI(color)
    );

    applicationStore.select(
      (state) => state.currentTool,
      (tool) => this.setActiveTool(tool)
    );

    applicationStore.select(
      (state) => state.doc.size,
      ({ width, height }) => this.updateDocumentSizeUI(width, height)
    );
  }

  private setActiveTool(name: ToolType) {
    const { tools } = this.elements;
    Object.entries(tools).forEach(([toolName, button]) => {
      button?.classList.toggle("active", toolName === name);
    });
  }

  private updateColorUI(color: string) {
    const picker = this.elements.colorPicker;
    if (!picker) return;

    if (picker.value.toLowerCase() === color.toLowerCase()) return;

    picker.value = color;
  }

  private updateDocumentSizeUI(width: number, height: number) {
    const select = this.elements.documentSizeSelect;
    if (!select) return;

    const targetValue = `${width}x${height}`;
    if (select.value === targetValue) return;

    select.value = targetValue;
  }

  public updateStatus(coords: Position, zoom: number) {
    if (this.elements.coordsDisplay) {
      this.elements.coordsDisplay.textContent = `X: ${coords.x}, Y: ${coords.y}`;
    }

    if (this.elements.zoomDisplay) {
      this.elements.zoomDisplay.textContent = `Zoom: ${Math.round((zoom / 24) * 100)}%`;
    }
  }
}
