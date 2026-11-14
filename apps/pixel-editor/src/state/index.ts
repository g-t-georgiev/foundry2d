/**
 * UI state store (Ajv-validated actions, Immer updates).
 *
 * Rule for both apps: the store holds UI state only — the current tool,
 * colours or values, toggles, selections in panels, the active view. Model
 * data (cells, layers, frames, levels, entities, definitions) lives in the
 * model objects and changes through commands, so undo/redo and saving have
 * one source of truth. Mirrors of model facts (like the document size shown
 * in a size picker) are allowed when the model stays authoritative and the
 * app keeps them in sync.
 */
import type { ApplicationState, ApplicationStateActionsMap } from "./types";
import { Store } from "@foundry2d/store";
import { PixelUtils } from "@foundry2d/core";
import {
  setToolAction,
  setColorAction,
  setPenSizeAction,
  gridToggleAction,
  previewToggleAction,
  onionToggleAction,
  setMirrorAction,
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
    size: { width: 32, height: 32 },
  },
  preferences: {
    grid: { enabled: true },
    preview: { enabled: false },
    onionSkin: { enabled: true },
    mirror: { x: false, y: false },
  },
};

export const applicationStore = new Store<ApplicationState, ApplicationStateActionsMap>({
  initialState,
  actions: [
    setToolAction,
    setColorAction,
    setPenSizeAction,
    gridToggleAction,
    previewToggleAction,
    onionToggleAction,
    setMirrorAction,
    documentResizeAction,
  ],
});

export * from "./types";
export * from "./actions";
