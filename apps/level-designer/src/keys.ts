import type { Keymap } from "@foundry2d/workspace";
import { LevelActions, levelStore, type LevelTool } from "./state";
import type Application from "./Application";

/**
 * The level designer's keyboard shortcuts, in one place so they read as a
 * reference; their labels and groups make the manual's hotkey table
 * (`vp run docs`), so the docs can't drift from the code.
 *
 * Handlers returning `false` let the key fall through to the next binding,
 * which is how one key (Escape, Delete, Ctrl+D) does different things in the
 * world view, the level view and on an Entities layer.
 */
export function bindKeys(keymap: Keymap, app: Application): void {
  const inLevel = (fn: () => void) => () => {
    if (app.view === "level") fn();
    else return false;
  };
  const inWorld = (fn: () => void) => () => {
    if (app.view === "world") fn();
    else return false;
  };
  const tool = (name: LevelTool) =>
    inLevel(() => void levelStore.dispatch(LevelActions.SetTool, name));
  const repeat = true;
  const whileTyping = true;

  let group = "History and files";
  keymap.bind("mod+z", () => void app.history.undo(), { repeat, label: "Undo", group });
  keymap.bind("mod+shift+z", () => void app.history.redo(), { repeat, label: "Redo", group });
  keymap.bind("mod+y", () => void app.history.redo(), { repeat, label: "Redo", group });
  keymap.bind("mod+s", () => void app.files.save(), { whileTyping, label: "Save", group });
  keymap.bind("mod+shift+s", () => void app.files.saveAs(), {
    whileTyping,
    label: "Save as file",
    group,
  });
  keymap.bind("mod+o", () => void app.files.showBrowser(), {
    whileTyping,
    label: "New or open (start screen)",
    group,
  });
  keymap.bind("mod+e", () => app.runCommand("export"), {
    whileTyping,
    label: "Export in the format the Export button shows",
    group,
  });
  keymap.bind(
    "mod+shift+c",
    inLevel(() => void app.copyActiveLayer()),
    { label: "Copy the active layer as an array", group }
  );

  group = "Painting (level view)";
  keymap.bind("b", tool("pen"), { label: "Pen", group });
  keymap.bind("e", tool("eraser"), {
    label: "Eraser (or paint with the right mouse button)",
    group,
  });
  keymap.bind("r", tool("rect"), { label: "Rectangle fill", group });
  keymap.bind("g", tool("bucket"), { label: "Bucket fill", group });
  keymap.bind("i", tool("eyedropper"), { label: "Pick value or tile", group });
  keymap.hold(
    "alt",
    () => app.beginTemporaryEyedropper(),
    () => app.endTemporaryEyedropper(),
    { label: "Pick value or tile while held", group }
  );
  const toggleFlip = (axis: "x" | "y") =>
    inLevel(() => {
      if (app.activeDef()?.type !== "Tiles") return;
      const flip = { ...levelStore.getState().tileFlip };
      flip[axis] = !flip[axis];
      levelStore.dispatch(LevelActions.SetTileFlip, flip);
    });
  keymap.bind("x", toggleFlip("x"), { label: "Flip painted tiles horizontally", group });
  keymap.bind("y", toggleFlip("y"), { label: "Flip painted tiles vertically", group });
  for (let i = 1; i <= 9; i++) {
    keymap.bind(
      String(i),
      inLevel(() => {
        if (app.entities.isActive) {
          const def = app.project.defs.entities[i - 1];
          if (def) app.entities.setPlaceDef(def.uid);
          return;
        }
        const entry = app.activeDef()?.intGridValues[i - 1];
        if (entry) app.selectValue(entry.value);
      }),
      { label: "Choose the IntGrid value, or the entity type to place", group }
    );
  }

  group = "View";
  keymap.bind("f", () => void app.workspace.fitToView(200), { label: "Fit to view", group });
  keymap.bind(
    "#",
    () => {
      levelStore.dispatch(LevelActions.ToggleGrid, {
        enabled: !levelStore.getState().grid.enabled,
      });
    },
    { label: "Grid on/off", group }
  );
  keymap.bind("+", () => app.workspace.zoomBy(1.25), { repeat, label: "Zoom in", group });
  keymap.bind("=", () => app.workspace.zoomBy(1.25), { repeat, label: "Zoom in", group });
  keymap.bind("-", () => app.workspace.zoomBy(0.8), { repeat, label: "Zoom out", group });

  // Entities (only while an Entities layer is active in the level view).
  group = "Entities (on an Entities layer)";
  const onEntities = (fn: () => boolean) => () =>
    app.view === "level" && app.entities.isActive ? fn() : false;
  keymap.bind(
    "delete",
    onEntities(() => app.entities.deleteSelected()),
    { label: "Delete the selected entity", group }
  );
  keymap.bind(
    "backspace",
    onEntities(() => app.entities.deleteSelected()),
    { label: "Delete the selected entity", group }
  );
  keymap.bind(
    "mod+d",
    onEntities(() => app.entities.duplicateSelected()),
    { label: "Duplicate the selected entity", group }
  );
  const arrows: [string, number, number][] = [
    ["arrowleft", -1, 0],
    ["arrowright", 1, 0],
    ["arrowup", 0, -1],
    ["arrowdown", 0, 1],
  ];
  for (const [key, dx, dy] of arrows) {
    keymap.bind(
      key,
      onEntities(() => app.entities.nudge(dx, dy, false)),
      { repeat, label: "Nudge the selected entity by a cell", group }
    );
  }
  for (const [key, dx, dy] of arrows) {
    keymap.bind(
      `shift+${key}`,
      onEntities(() => app.entities.nudge(dx, dy, true)),
      { repeat, label: "Nudge the selected entity by a pixel", group }
    );
  }

  // View navigation. Escape first cancels entity picking or selection.
  keymap.bind(
    "escape",
    onEntities(() => app.entities.escape()),
    { label: "Cancel picking, then deselect", group }
  );
  group = "World and levels";
  keymap.bind(
    "escape",
    inLevel(() => void app.showWorld()),
    { label: "Back to the world view", group }
  );
  keymap.bind(
    "enter",
    inWorld(() => {
      const uid = app.selectedLevel()?.uid;
      if (uid !== undefined) void app.enterLevel(uid);
    }),
    { label: "Open the selected level", group }
  );
  keymap.bind(
    "delete",
    inWorld(() => {
      const uid = app.selectedLevel()?.uid;
      if (uid !== undefined) app.levelOps.remove(uid);
    }),
    { label: "Delete the selected level (world view)", group }
  );
  keymap.bind(
    "mod+d",
    inWorld(() => {
      const uid = app.selectedLevel()?.uid;
      if (uid !== undefined) app.levelOps.duplicate(uid);
    }),
    { label: "Duplicate the selected level (world view)", group }
  );
  keymap.describe("f2", { label: "Rename the selected level (in the Levels list)", group });
}
