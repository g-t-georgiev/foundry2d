export interface CellChange<TCell> {
  x: number;
  y: number;
  oldValue: TCell;
  newValue: TCell;
}

export type EditableLayerProperties = "opacity" | "visible" | "name";
export type AllowedLayerKeys<T> = Extract<keyof T, EditableLayerProperties>;
