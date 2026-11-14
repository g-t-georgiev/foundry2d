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
import { Store, defineAction } from "@foundry2d/store";

export const LEVEL_TOOLS = ["pen", "eraser", "rect", "bucket", "eyedropper"] as const;
export type LevelTool = (typeof LEVEL_TOOLS)[number];

export type EditorView = "world" | "level";

export interface LevelEditorState {
  /** World overview or single-level editing. */
  view: EditorView;
  /** Level selected in the world (and edited in the level view). */
  selectedLevelUid: number | null;
  currentTool: LevelTool;
  /** Tool to return to after a one-shot pick with the eyedropper. */
  previousTool: LevelTool;
  /** Selected IntGrid value per layer definition uid (as string key). */
  selectedValues: Record<string, number>;
  grid: { enabled: boolean };
  /** Selected tile rectangle per tileset uid (in tiles). */
  tileSelections: Record<string, { x: number; y: number; width: number; height: number }>;
  /** Flip applied to painted tiles. */
  tileFlip: { x: boolean; y: boolean };
}

export enum LevelActions {
  SetTool = "level:tool:set",
  SelectValue = "level:value:select",
  ToggleGrid = "level:grid:toggle",
  SetView = "level:view:set",
  SelectLevel = "level:level:select",
  SelectTiles = "level:tiles:select",
  SetTileFlip = "level:tiles:flip",
}

export type LevelActionsMap = {
  [LevelActions.SetTool]: LevelTool;
  [LevelActions.SelectValue]: { defUid: number; value: number };
  [LevelActions.ToggleGrid]: { enabled: boolean };
  [LevelActions.SetView]: EditorView;
  [LevelActions.SelectLevel]: { uid: number | null };
  [LevelActions.SelectTiles]: {
    tilesetUid: number;
    x: number;
    y: number;
    width: number;
    height: number;
  };
  [LevelActions.SetTileFlip]: { x: boolean; y: boolean };
};

const setToolSchema = { type: "string", enum: [...LEVEL_TOOLS] } as const;

const selectValueSchema = {
  type: "object",
  properties: {
    defUid: { type: "integer", minimum: 0 },
    value: { type: "integer", minimum: 0 },
  },
  required: ["defUid", "value"],
  additionalProperties: false,
} as const;

const toggleSchema = {
  type: "object",
  properties: { enabled: { type: "boolean" } },
  required: ["enabled"],
  additionalProperties: false,
} as const;

const setViewSchema = { type: "string", enum: ["world", "level"] } as const;

const selectLevelSchema = {
  type: "object",
  properties: { uid: { type: ["integer", "null"] } },
  required: ["uid"],
  additionalProperties: false,
} as const;

const setView = defineAction<LevelEditorState, LevelActions.SetView, typeof setViewSchema>(
  LevelActions.SetView,
  {
    schema: setViewSchema,
    reducer(state, view) {
      state.view = view;
    },
  }
);

const selectLevel = defineAction<
  LevelEditorState,
  LevelActions.SelectLevel,
  typeof selectLevelSchema
>(LevelActions.SelectLevel, {
  schema: selectLevelSchema,
  reducer(state, { uid }) {
    state.selectedLevelUid = uid;
  },
});

const selectTilesSchema = {
  type: "object",
  properties: {
    tilesetUid: { type: "integer", minimum: 0 },
    x: { type: "integer", minimum: 0 },
    y: { type: "integer", minimum: 0 },
    width: { type: "integer", minimum: 1 },
    height: { type: "integer", minimum: 1 },
  },
  required: ["tilesetUid", "x", "y", "width", "height"],
  additionalProperties: false,
} as const;

const tileFlipSchema = {
  type: "object",
  properties: { x: { type: "boolean" }, y: { type: "boolean" } },
  required: ["x", "y"],
  additionalProperties: false,
} as const;

const selectTiles = defineAction<
  LevelEditorState,
  LevelActions.SelectTiles,
  typeof selectTilesSchema
>(LevelActions.SelectTiles, {
  schema: selectTilesSchema,
  reducer(state, { tilesetUid, ...rect }) {
    state.tileSelections[String(tilesetUid)] = rect;
  },
});

const setTileFlip = defineAction<LevelEditorState, LevelActions.SetTileFlip, typeof tileFlipSchema>(
  LevelActions.SetTileFlip,
  {
    schema: tileFlipSchema,
    reducer(state, flip) {
      state.tileFlip = flip;
    },
  }
);

const setTool = defineAction<LevelEditorState, LevelActions.SetTool, typeof setToolSchema>(
  LevelActions.SetTool,
  {
    schema: setToolSchema,
    reducer(state, tool) {
      if (tool === state.currentTool) return;
      if (state.currentTool !== "eyedropper") state.previousTool = state.currentTool;
      state.currentTool = tool;
    },
  }
);

const selectValue = defineAction<
  LevelEditorState,
  LevelActions.SelectValue,
  typeof selectValueSchema
>(LevelActions.SelectValue, {
  schema: selectValueSchema,
  reducer(state, { defUid, value }) {
    state.selectedValues[String(defUid)] = value;
  },
});

const toggleGrid = defineAction<LevelEditorState, LevelActions.ToggleGrid, typeof toggleSchema>(
  LevelActions.ToggleGrid,
  {
    schema: toggleSchema,
    reducer(state, { enabled }) {
      state.grid.enabled = enabled;
    },
  }
);

export const levelStore = new Store<LevelEditorState, LevelActionsMap>({
  initialState: {
    view: "level",
    selectedLevelUid: null,
    currentTool: "pen",
    previousTool: "pen",
    selectedValues: {},
    grid: { enabled: true },
    tileSelections: {},
    tileFlip: { x: false, y: false },
  },
  actions: [setTool, selectValue, toggleGrid, setView, selectLevel, selectTiles, setTileFlip],
});
