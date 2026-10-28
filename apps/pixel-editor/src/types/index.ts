export interface ApplicationContext {
  isPreviewMode: boolean;
  clearDocument(): void;
  resizeDocument(width: number, height: number): void;
  zoomBy(factor: number): void;
  fitToView(): void;
  exportPNG(): void;
}
