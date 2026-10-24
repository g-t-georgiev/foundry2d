import {
  type LayerEventPayloads as AllLayerEventPayloads,
  type LayerEventName as AllLayerEventName,
  type LayersManagerEventMap as LayersManagerAllEventMap,
  LayerEvents as AllLayerEvents,
} from "./types";

import "./layer-item";
import type { default as _LayerItem } from "./layer-item";

import "./layers-manager";
import type { default as _LayersManager } from "./layers-manager";

declare global {
  interface HTMLElementTagNameMap {
    "layer-manager": _LayersManager;
    "layer-item": _LayerItem;
  }
}

/* !!!IMPORTANT!!!
 * Exports listed below are public and modify some directory scoped types, such as
 * map objects, sets and enums, so that they reflect and dictate the public API shape and usage.
 *
 * Outer context should refrain from bypassing these and import directly from the modules instead.
 */

export type LayerEventName = Exclude<AllLayerEventName, "layer:select">;

export const LayerEvents = {
  Selected: AllLayerEvents.Selected,
  Reorder: AllLayerEvents.Reorder,
  VisibilityChange: AllLayerEvents.VisibilityChange,
} as const;

export type LayerEventPayloads = Pick<AllLayerEventPayloads, LayerEventName>;
export type LayerEventPayload<T extends LayerEventName> = LayerEventPayloads[T];

export type LayersManagerEventMap = LayersManagerAllEventMap<LayerEventName>;

// Enforce Public Interfaces by omitting and replacing the event methods
export interface LayersManager extends Omit<
  _LayersManager,
  "addEventListener" | "removeEventListener"
> {
  addEventListener<K extends keyof LayersManagerEventMap>(
    type: K,
    listener: (this: LayersManager, ev: LayersManagerEventMap[K]) => void,
    options?: boolean | AddEventListenerOptions
  ): void;
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions
  ): void;
  removeEventListener<K extends keyof LayersManagerEventMap>(
    type: K,
    listener: (this: LayersManager, ev: LayersManagerEventMap[K]) => void,
    options?: boolean | EventListenerOptions
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions
  ): void;
}

export interface LayerItem extends Omit<_LayerItem, "addEventListener" | "removeEventListener"> {
  addEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions
  ): void;
  removeEventListener(
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | EventListenerOptions
  ): void;
}
