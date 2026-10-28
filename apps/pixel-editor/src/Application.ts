import { HistoryManager, ToolManager } from "@foundry2d/core";
import { Camera, GridDocument } from "@foundry2d/core";
import type { ApplicationContext } from "./types";
import UIManager from "./ui/UIManager";

export default class Application implements ApplicationContext {
  isDrawing = false;
  isPanning = false;
  isQuickColorPicking = false;
  isPreviewMode = false;

  private camera: Camera;
  private toolManager: ToolManager<Uint32Array>;
  private historyManager: HistoryManager;
  private documentManager: GridDocument<Uint32Array>;
  private uiManager: UIManager;

  readonly canvasContainer: HTMLElement;

  constructor(readonly canvas: HTMLCanvasElement) {
    this.canvasContainer = canvas.parentElement!;

    this.camera = new Camera({ cellSize: { width: 1, height: 1 } });
    this.documentManager = new GridDocument<Uint32Array>({
      width: 16,
      height: 16,
      emptyValue: 0x00000000,
      bufferCtor: Uint32Array,
    });
    this.historyManager = new HistoryManager();
    this.toolManager = new ToolManager<Uint32Array>();
    this.uiManager = new UIManager(this);
  }

  clearDocument(): void {
    //
  }

  resizeDocument(width: number, height: number): void {
    //
  }

  fitToView(): void {
    //
  }

  zoomBy(factor: number): void {
    //
  }

  exportPNG(): void {
    //
  }
}
