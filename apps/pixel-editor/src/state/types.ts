import type { Position, ToolType } from "@foundry2d/core";

export enum ApplicationStateActions {
  SetTool = "store:tool:set",
  SetColor = "store:color:set",
  EditPen = "store:pen:edit",
  ToggleGrid = "store:grid:toggle",
  ResizeDocument = "store:document:resize",
}

export type ApplicationStateActionsMap = {
  [ApplicationStateActions.SetTool]: ToolType;
  [ApplicationStateActions.SetColor]: { color: string };
  [ApplicationStateActions.EditPen]: { size: number };
  [ApplicationStateActions.ToggleGrid]: { enabled: boolean };
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
  };
}
