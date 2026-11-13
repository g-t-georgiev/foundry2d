/** Plain description of one layer, as the panel displays it. */
export interface LayerView {
  id: string;
  name: string;
  visible: boolean;
  /** 0..1 */
  opacity: number;
}

export const LayerPanelEvents = {
  Select: "layer-select",
  Add: "layer-add",
  Duplicate: "layer-duplicate",
  Delete: "layer-delete",
  Move: "layer-move",
  Rename: "layer-rename",
  Visibility: "layer-visibility",
  Opacity: "layer-opacity",
} as const;

export type LayerPanelEventPayloads = {
  [LayerPanelEvents.Select]: { id: string };
  [LayerPanelEvents.Add]: { afterId: string | null };
  [LayerPanelEvents.Duplicate]: { id: string };
  [LayerPanelEvents.Delete]: { id: string };
  /** "up" = towards the top of the stack (drawn above). */
  [LayerPanelEvents.Move]: { id: string; direction: "up" | "down" };
  [LayerPanelEvents.Rename]: { id: string; name: string };
  [LayerPanelEvents.Visibility]: { id: string; visible: boolean };
  /**
   * Fired continuously while the slider moves (`final: false`) and once when
   * released (`final: true`), so apps can preview live and record one undo step.
   */
  [LayerPanelEvents.Opacity]: { id: string; opacity: number; final: boolean };
};

export type LayerPanelEventName = keyof LayerPanelEventPayloads;

export type LayersPanelEventMap = HTMLElementEventMap & {
  [K in LayerPanelEventName]: CustomEvent<LayerPanelEventPayloads[K]>;
};
