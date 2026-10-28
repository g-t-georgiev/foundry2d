import { PixelUtils } from "@foundry2d/core";
import { defineAction } from "@foundry2d/store";
import { type ApplicationState, ApplicationStateActions } from "../types";
import {
  setToolSchema,
  setColorSchema,
  setPenSizeSchema,
  gridToggleSchema,
  documentResizeSchema,
} from "../schemas";

export const setToolAction = defineAction<
  ApplicationState,
  ApplicationStateActions.SetTool,
  typeof setToolSchema
>(ApplicationStateActions.SetTool, {
  schema: setToolSchema,
  reducer(state, payload) {
    const { currentTool } = state;

    if (payload === currentTool) return;

    if (currentTool !== "eyedropper") {
      state.previousTool = currentTool;
    }

    state.currentTool = payload;
  },
});

export const setColorAction = defineAction<
  ApplicationState,
  ApplicationStateActions.SetColor,
  typeof setColorSchema
>(ApplicationStateActions.SetColor, {
  schema: setColorSchema,
  reducer(state, payload) {
    state.currentColor = payload.color;
    // Pre-calculate the 32-bit packed integer (0xAABBGGRR) once on change
    state.activeColorInt = PixelUtils.hexToUint32(payload.color);
  },
});

export const setPenSizeAction = defineAction<
  ApplicationState,
  ApplicationStateActions.EditPen,
  typeof setPenSizeSchema
>(ApplicationStateActions.EditPen, {
  schema: setPenSizeSchema,
  reducer(state, payload) {
    state.penSize = payload.size;
  },
});

export const gridToggleAction = defineAction<
  ApplicationState,
  ApplicationStateActions.ToggleGrid,
  typeof gridToggleSchema
>(ApplicationStateActions.ToggleGrid, {
  schema: gridToggleSchema,
  reducer(state, payload) {
    state.preferences.grid.enabled = payload.enabled;
  },
});

export const documentResizeAction = defineAction<
  ApplicationState,
  ApplicationStateActions.ResizeDocument,
  typeof documentResizeSchema
>(ApplicationStateActions.ResizeDocument, {
  schema: documentResizeSchema,
  reducer(state, payload) {
    state.doc.size.width = payload.width;
    state.doc.size.height = payload.height;
  },
});
