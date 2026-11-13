export type Position = { x: number; y: number };
export type Dimensions = { width: number; height: number };
export type Rect = Position & Dimensions;
export type ResizeData = { oldSize: Dimensions; newSize: Dimensions };
export type PointerAction = "up" | "down" | "move";
