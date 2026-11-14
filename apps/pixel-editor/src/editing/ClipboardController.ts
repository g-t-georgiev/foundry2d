import {
  ClearCommand,
  CompositeCommand,
  DrawCommand,
  SetSelectionCommand,
  clearRegionChanges,
  pasteRegionChanges,
  readRegion,
  type HistoryManager,
  type Region,
  type Selection,
} from "@foundry2d/core";
import type { PixelDocument } from "../model/Sprite";

export interface ClipboardHooks {
  /** The frame document being edited. */
  getDoc(): PixelDocument;
  selection: Selection;
  history: HistoryManager;
  notify(message: string, timeout?: number): void;
  /** Called after a paste, so the pasted block can be dragged right away. */
  onPasted(): void;
}

/**
 * Selection and clipboard actions on the active layer: select all,
 * deselect, copy, cut, paste and clear. The clipboard is internal (pixel
 * values of one layer); system clipboard images are a Phase 8.5 item.
 */
export class ClipboardController {
  private clipboard: Region | null = null;

  constructor(private readonly hooks: ClipboardHooks) {}

  private get doc(): PixelDocument {
    return this.hooks.getDoc();
  }

  selectAll(): void {
    this.hooks.selection.set({ x: 0, y: 0, width: this.doc.width, height: this.doc.height });
  }

  deselect(): boolean {
    if (!this.hooks.selection.rect) return false;
    this.hooks.selection.set(null);
    return true;
  }

  /** The selection, or the whole layer when nothing is selected. */
  private targetRect() {
    return (
      this.hooks.selection.rect ?? { x: 0, y: 0, width: this.doc.width, height: this.doc.height }
    );
  }

  /** Copies the selection (or the whole layer) of the active layer. */
  copy(): boolean {
    const layer = this.doc.getActiveLayer();
    if (!layer) return false;
    const rect = this.targetRect();
    this.clipboard = readRegion(layer, rect);
    this.hooks.notify(`Copied ${rect.width}×${rect.height} px`, 1500);
    return true;
  }

  cut(): void {
    const layer = this.doc.getActiveLayer();
    if (!layer || !this.copy()) return;
    if (!this.doc.getPolicy(layer.id).canDraw) return;
    const changes = clearRegionChanges(layer, this.targetRect());
    if (changes.length) {
      this.hooks.history.execute(new DrawCommand(this.doc, layer.id, changes, "Cut"));
    }
  }

  /**
   * Pastes at the selection's top-left (or the top-left corner) and selects
   * the pasted block, as one undo step.
   */
  paste(): void {
    const { selection, history } = this.hooks;
    const layer = this.doc.getActiveLayer();
    const region = this.clipboard;
    if (!layer || !region) {
      this.hooks.notify("Nothing to paste.");
      return;
    }
    if (!this.doc.getPolicy(layer.id).canDraw) {
      this.hooks.notify("The active layer is hidden or locked.");
      return;
    }
    const at = selection.rect ? { x: selection.rect.x, y: selection.rect.y } : { x: 0, y: 0 };
    const target = { ...at, width: region.width, height: region.height };
    history.execute(
      new CompositeCommand(
        [
          new DrawCommand(this.doc, layer.id, pasteRegionChanges(layer, region, at), "Paste"),
          new SetSelectionCommand(selection, selection.rect, target),
        ],
        "Paste"
      )
    );
    this.hooks.onPasted();
  }

  /** Clears the selection, or the whole active layer, in the current frame. */
  clearLayer(): void {
    const layer = this.doc.getActiveLayer();
    if (!layer || !this.doc.getPolicy(layer.id).canDraw) {
      this.hooks.notify("The active layer is hidden or locked.");
      return;
    }
    const rect = this.hooks.selection.rect;
    if (rect) {
      const changes = clearRegionChanges(layer, rect);
      if (changes.length) {
        this.hooks.history.execute(new DrawCommand(this.doc, layer.id, changes, "Clear selection"));
      }
      return;
    }
    const command = new ClearCommand(this.doc, layer.id);
    command.execute();
    if (!command.isNoop) this.hooks.history.record(command);
  }
}
