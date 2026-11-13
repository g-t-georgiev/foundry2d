export type CellBuffer = Uint32Array | Int32Array;
export type CellBufferCtor<Buffer extends CellBuffer> = new (size: number) => Buffer;

export interface CellChange<TCell = number> {
  x: number;
  y: number;
  oldValue: TCell;
  newValue: TCell;
}

/** Cell changes grouped per layer, e.g. the result of clearing several layers at once. */
export type LayerChanges = [layerId: string, changes: CellChange<number>[]][];

export type EditableLayerProperties = "opacity" | "visible" | "name" | "locked";
export type AllowedLayerKeys<T> = Extract<keyof T, EditableLayerProperties>;

/** Events emitted by a `GridDocument` whenever its structure or contents change. */
export type DocumentEventMap = {
  /** Layer list changed: added, removed, reordered. */
  "layers:changed": () => void;
  /** A layer property (name, visibility, opacity, lock) changed. */
  "layer:updated": (payload: { layerId: string; property: EditableLayerProperties }) => void;
  /** The active layer changed. */
  "layer:activated": (payload: { layerId: string | null }) => void;
  /** Cell data of a layer changed. */
  "cells:changed": (payload: { layerId: string }) => void;
  /** Document dimensions changed. */
  resized: (payload: { width: number; height: number }) => void;
};
