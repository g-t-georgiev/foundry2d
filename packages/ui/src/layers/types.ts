/** Plain description of one layer, as the panel displays it. */
export interface LayerView {
  id: string;
  name: string;
  visible: boolean;
  /** 0..1 */
  opacity: number;
  /**
   * Locked layers can't be drawn on. Leave `undefined` to hide the lock
   * toggle (hosts that don't support locking).
   */
  locked?: boolean;
  /** `false` shows the lock but disables it (e.g. generated layers). Defaults to `true`. */
  lockable?: boolean;
  /** Tooltip for a disabled lock. */
  lockReason?: string;
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
  Lock: "layer-lock",
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
  [LayerPanelEvents.Lock]: { id: string; locked: boolean };
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
