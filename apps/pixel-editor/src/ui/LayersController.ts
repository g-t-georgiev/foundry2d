import {
  AddLayerCommand,
  DeleteLayerCommand,
  MoveLayerCommand,
  SetLayerPropertyCommand,
  type GridDocument,
  type HistoryManager,
  type Unsubscribe,
} from "@foundry2d/core";
import { LayerPanelEvents, type LayersPanel } from "@foundry2d/ui";

/**
 * Mediator between the `<layers-panel>` (plain data + DOM events) and the
 * document (commands + document events). The panel never mutates itself:
 * every change round-trips through a command and comes back as a re-sync.
 */
export default class LayersController {
  private subscriptions: Unsubscribe[] = [];
  private readonly abort = new AbortController();
  /** Opacity at the start of a slider drag, so one undo step restores it. */
  private opacityDrag: { id: string; start: number } | null = null;

  constructor(
    private readonly panel: LayersPanel,
    private readonly doc: GridDocument<Uint32Array>,
    private readonly history: HistoryManager
  ) {
    const sync = () => this.sync();
    this.subscriptions = [
      doc.events.on("layers:changed", sync),
      doc.events.on("layer:updated", sync),
      doc.events.on("layer:activated", sync),
    ];
    this.attachPanelListeners();
    this.sync();
  }

  sync(): void {
    this.panel.layers = this.doc.layers.map(({ id, name, visible, opacity }) => ({
      id,
      name,
      visible,
      opacity,
    }));
    this.panel.activeId = this.doc.activeLayerId;
  }

  destroy(): void {
    this.subscriptions.forEach((unsubscribe) => unsubscribe());
    this.abort.abort();
  }

  /** Adds an empty layer above the active one. */
  addLayer(afterId: string | null = this.doc.activeLayerId): void {
    const index = afterId ? this.doc.indexOfLayer(afterId) + 1 : this.doc.layers.length;
    this.history.execute(new AddLayerCommand(this.doc, { index }));
  }

  duplicateLayer(id: string): void {
    const source = this.doc.getLayer(id);
    if (!source) return;
    this.history.execute(
      new AddLayerCommand(this.doc, {
        name: `${source.name} copy`,
        index: this.doc.indexOfLayer(id) + 1,
        visible: source.visible,
        opacity: source.opacity,
        data: source.data,
      })
    );
  }

  deleteLayer(id: string): void {
    if (!this.doc.getPolicy(id).canDelete) return;
    const command = new DeleteLayerCommand(this.doc, id);
    command.execute();
    if (command.succeeded) this.history.record(command);
  }

  moveLayer(id: string, direction: "up" | "down"): void {
    const from = this.doc.indexOfLayer(id);
    const to = direction === "up" ? from + 1 : from - 1;
    if (from === -1 || to < 0 || to >= this.doc.layers.length) return;
    this.history.execute(new MoveLayerCommand(this.doc, from, to));
  }

  private attachPanelListeners(): void {
    const { panel, doc, history } = this;
    const signal = this.abort.signal;

    panel.addEventListener(LayerPanelEvents.Select, (ev) => doc.setActiveLayer(ev.detail.id), {
      signal,
    });
    panel.addEventListener(LayerPanelEvents.Add, (ev) => this.addLayer(ev.detail.afterId), {
      signal,
    });
    panel.addEventListener(LayerPanelEvents.Duplicate, (ev) => this.duplicateLayer(ev.detail.id), {
      signal,
    });
    panel.addEventListener(LayerPanelEvents.Delete, (ev) => this.deleteLayer(ev.detail.id), {
      signal,
    });
    panel.addEventListener(
      LayerPanelEvents.Move,
      (ev) => this.moveLayer(ev.detail.id, ev.detail.direction),
      { signal }
    );
    panel.addEventListener(
      LayerPanelEvents.Rename,
      (ev) =>
        history.execute(new SetLayerPropertyCommand(doc, ev.detail.id, "name", ev.detail.name)),
      { signal }
    );
    panel.addEventListener(
      LayerPanelEvents.Visibility,
      (ev) =>
        history.execute(
          new SetLayerPropertyCommand(doc, ev.detail.id, "visible", ev.detail.visible)
        ),
      { signal }
    );
    panel.addEventListener(
      LayerPanelEvents.Opacity,
      (ev) => {
        const { id, opacity, final } = ev.detail;
        const layer = doc.getLayer(id);
        if (!layer) return;
        if (!this.opacityDrag || this.opacityDrag.id !== id) {
          this.opacityDrag = { id, start: layer.opacity };
        }
        if (!final) {
          // Live preview without polluting the undo history.
          doc.setLayerProperty(id, "opacity", opacity);
          return;
        }
        const start = this.opacityDrag.start;
        this.opacityDrag = null;
        if (start === opacity) return;
        history.execute(new SetLayerPropertyCommand(doc, id, "opacity", opacity, start));
      },
      { signal }
    );
  }
}
