import type LayerItem from "./layer-item";

export const LayerEvents = {
  /** Used by LayersManager internally to update the selected layer */
  Select: "layer:select",

  /** Used by external context to get notified when the selected layer changes */
  Selected: "layer:selected",

  VisibilityChange: "layer:visibility-change",
  Reorder: "layers:reordered",
} as const;

export type LayerEventPayloads = {
  [LayerEvents.Select]: LayerItem;
  [LayerEvents.Selected]: {
    id: string;
    name: string;
  };
  [LayerEvents.Reorder]: void;
  [LayerEvents.VisibilityChange]: {
    id: string;
    visible: boolean;
  };
};

export type LayerEventName = (typeof LayerEvents)[keyof typeof LayerEvents];
export type LayerEventPayload<T extends LayerEventName> = LayerEventPayloads[T];

export type LayersManagerEventMap<T extends LayerEventName = LayerEventName> =
  HTMLElementEventMap & {
    [EventName in T]: CustomEvent<LayerEventPayload<EventName>>;
  };
