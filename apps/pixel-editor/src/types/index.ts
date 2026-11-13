/** Commands the UI layer may invoke on the application. */
export interface ApplicationContext {
  newDocument(): void;
  openProject(file: File): Promise<void>;
  saveProject(): void;
  exportPNG(scale: number): Promise<void>;
  clearLayer(): void;
  resizeDocument(width: number, height: number): void;
  undo(): void;
  redo(): void;
  zoomBy(factor: number): void;
  fitToView(): void;
}
