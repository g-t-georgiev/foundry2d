import { Store, defineAction } from "@foundry2d/store";

export const LEVEL_TOOLS = ["pen", "eraser", "rect", "bucket", "eyedropper"] as const;
export type LevelTool = (typeof LEVEL_TOOLS)[number];

export interface LevelEditorState {
  currentTool: LevelTool;
  /** Tool to return to after a one-shot pick with the eyedropper. */
  previousTool: LevelTool;
  /** Selected IntGrid value per layer definition uid (as string key). */
  selectedValues: Record<string, number>;
  grid: { enabled: boolean };
}

export enum LevelActions {
  SetTool = "level:tool:set",
  SelectValue = "level:value:select",
  ToggleGrid = "level:grid:toggle",
}

export type LevelActionsMap = {
  [LevelActions.SetTool]: LevelTool;
  [LevelActions.SelectValue]: { defUid: number; value: number };
  [LevelActions.ToggleGrid]: { enabled: boolean };
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
    currentTool: "pen",
    previousTool: "pen",
    selectedValues: {},
    grid: { enabled: true },
  },
  actions: [setTool, selectValue, toggleGrid],
});
