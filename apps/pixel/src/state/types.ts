import type { Position, ToolType } from "@gs2d/core";

export enum ApplicationStateActions {
  SetTool = "store:tool:set",
  SetColor = "store:color:set",
  EditPen = "store:pen:edit",
  ToggleGrid = "store:grid:toggle",
  TogglePreview = "store:preview:toggle",
  ToggleOnionSkin = "store:onion:toggle",
  SetMirror = "store:mirror:set",
  ResizeDocument = "store:document:resize",
}

export type ApplicationStateActionsMap = {
  [ApplicationStateActions.SetTool]: ToolType;
  [ApplicationStateActions.SetColor]: { color: string };
  [ApplicationStateActions.EditPen]: { size: number };
  [ApplicationStateActions.ToggleGrid]: { enabled: boolean };
  [ApplicationStateActions.TogglePreview]: { enabled: boolean };
  [ApplicationStateActions.ToggleOnionSkin]: { enabled: boolean };
  [ApplicationStateActions.SetMirror]: { x: boolean; y: boolean };
  [ApplicationStateActions.ResizeDocument]: { width: number; height: number };
};

export interface ApplicationState {
  /** CSS Hex String for UI (e.g. "#ffee00") */
  currentColor: string;
  /** Precalculated 32-bit integer for fast TypedArray buffer drawing (0xAABBGGRR) */
  activeColorInt: number;
  currentTool: ToolType;
  previousTool: ToolType;
  penSize: number;
  camera: {
    zoom: number;
    position: Position;
  };
  doc: {
    size: { width: number; height: number };
  };
  preferences: {
    grid: {
      enabled: boolean;
    };
    /** Read-only composite view: no grid, no dimming, no editing. */
    /** Mirror pen and eraser strokes across the vertical (x) / horizontal (y) centre. */
    mirror: { x: boolean; y: boolean };
    /** Show the previous and next frames faintly under the current one. */
    onionSkin: {
      enabled: boolean;
    };
    preview: {
      enabled: boolean;
    };
  };
}
