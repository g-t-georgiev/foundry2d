/** Commands the UI layer may invoke on the application. */
export interface ApplicationContext {
  /** Opens the start screen (new / open / library). */
  showBrowser(): Promise<void>;
  save(): Promise<void>;
  /** Renames the sprite (used for the library, file names and exports). */
  rename(name: string): void;
  saveAs(): Promise<void>;
  exportPNG(scale: number): Promise<void>;
  clearLayer(): void;
  resizeDocument(width: number, height: number): void;
  undo(): void;
  redo(): void;
  zoomBy(factor: number): void;
  fitToView(): void;
}
