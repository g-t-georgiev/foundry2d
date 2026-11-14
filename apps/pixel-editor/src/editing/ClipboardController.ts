import {
  ClearCommand,
  CompositeCommand,
  DrawCommand,
  SetSelectionCommand,
  clearRegionChanges,
  pasteRegionChanges,
  readRegion,
  transformRegion,
  type CellChange,
  type HistoryManager,
  type ICommand,
  type RegionTransform,
  type Region,
  type Selection,
} from "@foundry2d/core";
import type { PixelDocument } from "../model/Sprite";
import {
  imageFromPasteEvent,
  imageToRegion,
  regionToPng,
  writeImageToClipboard,
} from "./systemClipboard";

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
  /**
   * Whether the last copy also reached the system clipboard. If it did, an
   * image there is either ours or newer (copied in another app since), so
   * it wins over the internal copy on paste.
   */
  private systemHasLastCopy = false;

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

  /**
   * Copies the selection (or the whole layer) of the active layer, also to
   * the system clipboard as a PNG so other apps can paste it.
   */
  copy(): boolean {
    const layer = this.doc.getActiveLayer();
    if (!layer) return false;
    const rect = this.targetRect();
    const region = readRegion(layer, rect);
    this.clipboard = region;
    this.systemHasLastCopy = false;
    this.hooks.notify(`Copied ${rect.width}×${rect.height} px`, 1500);
    void regionToPng(region)
      .then(writeImageToClipboard)
      .then((ok) => {
        // Only if no newer copy happened while the PNG was being written.
        if (this.clipboard === region) this.systemHasLastCopy = ok;
      });
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

  /** Pastes the internal clipboard (pixels copied in this editor). */
  paste(): void {
    if (!this.clipboard) {
      this.hooks.notify("Nothing to paste.");
      return;
    }
    this.pasteRegion(this.clipboard);
  }

  /**
   * Handles the browser's paste event (Ctrl+V): an image on the system
   * clipboard is pasted when it's ours or newer than our last copy;
   * otherwise the internal clipboard is used.
   */
  async pasteFromEvent(ev: ClipboardEvent): Promise<void> {
    const image = imageFromPasteEvent(ev);
    if (image && (this.systemHasLastCopy || !this.clipboard)) {
      try {
        const region = await imageToRegion(image);
        const doc = this.doc;
        if (region.width > doc.width || region.height > doc.height) {
          this.hooks.notify(
            `Pasted a ${region.width}×${region.height} image; parts outside the ${doc.width}×${doc.height} sprite are cut off.`,
            4000
          );
        }
        this.pasteRegion(region);
        return;
      } catch (error) {
        console.error(error);
        this.hooks.notify("Could not read the pasted image.", 4000);
        if (!this.clipboard) return;
      }
    }
    this.paste();
  }

  /**
   * Pastes at the selection's top-left (or the top-left corner) and selects
   * the pasted block, as one undo step.
   */
  private pasteRegion(region: Region): void {
    const { selection, history } = this.hooks;
    const layer = this.doc.getActiveLayer();
    if (!layer) return;
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

  /**
   * Flips or rotates the selected pixels (or the whole active layer) as one
   * undo step. Rotation turns around the selection's centre and swaps its
   * width and height; the selection follows the pixels.
   */
  transform(kind: RegionTransform): void {
    const { selection, history } = this.hooks;
    const layer = this.doc.getActiveLayer();
    if (!layer || !this.doc.getPolicy(layer.id).canDraw) {
      this.hooks.notify("The active layer is hidden or locked.");
      return;
    }
    const rect = this.targetRect();
    const out = transformRegion(readRegion(layer, rect), kind);
    // Centre the turned block on the old one, then keep it on the canvas.
    const clamp = (v: number, size: number, max: number) =>
      Math.max(0, Math.min(v, Math.max(0, max - size)));
    const target = {
      x: clamp(rect.x + Math.floor((rect.width - out.width) / 2), out.width, this.doc.width),
      y: clamp(rect.y + Math.floor((rect.height - out.height) / 2), out.height, this.doc.height),
      width: out.width,
      height: out.height,
    };

    // One change per cell: clear the old block, then write the new one
    // (including its transparent cells, unlike a paste).
    const byIndex = new Map<number, CellChange<number>>();
    const put = (x: number, y: number, value: number) => {
      if (!layer.isWithinBounds(x, y)) return;
      const index = layer.getIndex(x, y);
      const existing = byIndex.get(index);
      if (existing) existing.newValue = value;
      else byIndex.set(index, { x, y, oldValue: layer.get(x, y), newValue: value });
    };
    for (let y = rect.y; y < rect.y + rect.height; y++) {
      for (let x = rect.x; x < rect.x + rect.width; x++) put(x, y, layer.emptyValue);
    }
    for (let y = 0; y < out.height; y++) {
      for (let x = 0; x < out.width; x++) {
        put(target.x + x, target.y + y, out.values[y * out.width + x]);
      }
    }
    const changes = [...byIndex.values()].filter((c) => c.oldValue !== c.newValue);
    const label =
      kind === "flipX" ? "Flip horizontally" : kind === "flipY" ? "Flip vertically" : "Rotate";
    const steps: ICommand[] = [new DrawCommand(this.doc, layer.id, changes, label)];
    if (selection.rect) steps.push(new SetSelectionCommand(selection, selection.rect, target));
    if (changes.length === 0 && !selection.rect) return;
    history.execute(new CompositeCommand(steps, label));
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
