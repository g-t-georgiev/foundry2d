import type { ApplicationState, ApplicationStateActionsMap } from "./types";
import { Store } from "@foundry2d/store";
import { PixelUtils } from "@foundry2d/core";
import {
  setToolAction,
  setColorAction,
  setPenSizeAction,
  gridToggleAction,
  documentResizeAction,
} from "./actions";

const defaultColor = "#ffee00";

const initialState: ApplicationState = {
  currentColor: defaultColor,
  activeColorInt: PixelUtils.hexToUint32(defaultColor),
  currentTool: "pen",
  previousTool: "pen",
  penSize: 1,
  camera: {
    zoom: 24,
    position: { x: 0, y: 0 },
  },
  doc: {
    size: { width: 16, height: 16 },
  },
  preferences: {
    grid: { enabled: true },
  },
};

export const applicationStore = new Store<ApplicationState, ApplicationStateActionsMap>({
  initialState,
  actions: [
    setToolAction,
    setColorAction,
    setPenSizeAction,
    gridToggleAction,
    documentResizeAction,
  ],
});

export * from "./types";
export * from "./actions";
