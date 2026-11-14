import type { HistoryManager, ICommand, Unsubscribe } from "@foundry2d/core";
import { LayerPanelEvents, type LayersPanel } from "@foundry2d/ui";
import type { Sprite } from "../model/Sprite";
import {
  addLayerToAllFrames,
  deleteLayerFromAllFrames,
  duplicateLayerInAllFrames,
  moveLayerInAllFrames,
  setLayerPropertyInAllFrames,
} from "../model/commands";

/**
 * Mediator between `<layers-panel>` and the sprite. The panel shows the
 * current frame's layers; every structural edit goes through a sprite-wide
 * command so all frames keep the same layers. The panel never mutates itself:
 * changes come back as document events and a re-sync.
 */
export default class LayersController {
  private docSubscriptions: Unsubscribe[] = [];
  private readonly abort = new AbortController();
  /** Opacity at the start of a slider drag, so one undo step restores it. */
  private opacityDrag: { id: string; start: number } | null = null;

  constructor(
    private readonly panel: LayersPanel,
    private readonly sprite: Sprite,
    private readonly history: HistoryManager
  ) {
    sprite.events.on("frame:selected", () => this.bindDocument());
    sprite.events.on("replaced", () => this.bindDocument());
    this.attachPanelListeners();
    this.bindDocument();
  }

  /** Follows the current frame's document. */
  private bindDocument(): void {
    this.docSubscriptions.forEach((unsubscribe) => unsubscribe());
    const sync = () => this.sync();
    const { events } = this.sprite.doc;
    this.docSubscriptions = [
      events.on("layers:changed", sync),
      events.on("layer:updated", sync),
      events.on("layer:activated", sync),
    ];
    this.sync();
  }

  sync(): void {
    const doc = this.sprite.doc;
    this.panel.layers = doc.layers.map(({ id, name, visible, opacity, locked }) => ({
      id,
      name,
      visible,
      opacity,
      locked,
    }));
    this.panel.activeId = doc.activeLayerId;
  }

  destroy(): void {
    this.docSubscriptions.forEach((unsubscribe) => unsubscribe());
    this.abort.abort();
  }

  private run(command: ICommand | null): void {
    if (command) this.history.execute(command);
  }

  /** Adds an empty layer above the active one, in every frame. */
  addLayer(afterId: string | null = this.sprite.doc.activeLayerId): void {
    this.run(addLayerToAllFrames(this.sprite, afterId));
  }

  private attachPanelListeners(): void {
    const { panel, sprite } = this;
    const signal = this.abort.signal;
    panel.addEventListener(
      LayerPanelEvents.Select,
      (ev) => sprite.doc.setActiveLayer(ev.detail.id),
      {
        signal,
      }
    );
    panel.addEventListener(LayerPanelEvents.Add, (ev) => this.addLayer(ev.detail.afterId), {
      signal,
    });
    panel.addEventListener(
      LayerPanelEvents.Duplicate,
      (ev) => this.run(duplicateLayerInAllFrames(sprite, ev.detail.id)),
      { signal }
    );
    panel.addEventListener(
      LayerPanelEvents.Delete,
      (ev) => this.run(deleteLayerFromAllFrames(sprite, ev.detail.id)),
      { signal }
    );
    panel.addEventListener(
      LayerPanelEvents.Move,
      (ev) => this.run(moveLayerInAllFrames(sprite, ev.detail.id, ev.detail.direction)),
      { signal }
    );
    panel.addEventListener(
      LayerPanelEvents.Rename,
      (ev) => this.run(setLayerPropertyInAllFrames(sprite, ev.detail.id, "name", ev.detail.name)),
      { signal }
    );
    panel.addEventListener(
      LayerPanelEvents.Visibility,
      (ev) =>
        this.run(setLayerPropertyInAllFrames(sprite, ev.detail.id, "visible", ev.detail.visible)),
      { signal }
    );
    panel.addEventListener(
      LayerPanelEvents.Lock,
      (ev) =>
        this.run(setLayerPropertyInAllFrames(sprite, ev.detail.id, "locked", ev.detail.locked)),
      { signal }
    );
    panel.addEventListener(
      LayerPanelEvents.Opacity,
      (ev) => {
        const { id, opacity, final } = ev.detail;
        const layer = sprite.doc.getLayer(id);
        if (!layer) return;
        if (!this.opacityDrag || this.opacityDrag.id !== id) {
          this.opacityDrag = { id, start: layer.opacity };
        }
        if (!final) {
          // Live preview without polluting the undo history.
          for (const frame of sprite.frames) frame.doc.setLayerProperty(id, "opacity", opacity);
          return;
        }
        const start = this.opacityDrag.start;
        this.opacityDrag = null;
        if (start === opacity) return;
        this.run(setLayerPropertyInAllFrames(sprite, id, "opacity", opacity, start));
      },
      { signal }
    );
  }
}
