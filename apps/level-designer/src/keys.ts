import type { Keymap } from "@foundry2d/workspace";
import { LevelActions, levelStore, type LevelTool } from "./state";
import type Application from "./Application";

/**
 * The level designer's keyboard shortcuts, in one place so they read as a
 * reference (and so the manual's hotkey table can be generated from them).
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

  keymap.bind("mod+z", () => void app.history.undo(), { repeat: true });
  keymap.bind("mod+shift+z", () => void app.history.redo(), { repeat: true });
  keymap.bind("mod+y", () => void app.history.redo(), { repeat: true });
  keymap.bind("mod+s", () => void app.files.save());
  keymap.bind("mod+shift+s", () => void app.files.saveAs());
  keymap.bind("mod+o", () => void app.files.showBrowser());
  keymap.bind("mod+e", () => app.runCommand("export"));
  keymap.bind(
    "mod+shift+c",
    inLevel(() => void app.copyActiveLayer())
  );
  keymap.bind("b", tool("pen"));
  keymap.bind("e", tool("eraser"));
  keymap.bind("r", tool("rect"));
  keymap.bind("g", tool("bucket"));
  keymap.bind("i", tool("eyedropper"));
  keymap.bind("f", () => void app.workspace.fitToView(200));
  keymap.bind("#", () => {
    levelStore.dispatch(LevelActions.ToggleGrid, {
      enabled: !levelStore.getState().grid.enabled,
    });
  });
  keymap.bind("+", () => app.workspace.zoomBy(1.25), { repeat: true });
  keymap.bind("=", () => app.workspace.zoomBy(1.25), { repeat: true });
  keymap.bind("-", () => app.workspace.zoomBy(0.8), { repeat: true });
  const toggleFlip = (axis: "x" | "y") =>
    inLevel(() => {
      if (app.activeDef()?.type !== "Tiles") return;
      const flip = { ...levelStore.getState().tileFlip };
      flip[axis] = !flip[axis];
      levelStore.dispatch(LevelActions.SetTileFlip, flip);
    });
  keymap.bind("x", toggleFlip("x"));
  keymap.bind("y", toggleFlip("y"));
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
      })
    );
  }

  // Entities (only while an Entities layer is active in the level view).
  const onEntities = (fn: () => boolean) => () =>
    app.view === "level" && app.entities.isActive ? fn() : false;
  keymap.bind(
    "delete",
    onEntities(() => app.entities.deleteSelected())
  );
  keymap.bind(
    "backspace",
    onEntities(() => app.entities.deleteSelected())
  );
  keymap.bind(
    "mod+d",
    onEntities(() => app.entities.duplicateSelected())
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
      { repeat: true }
    );
    keymap.bind(
      `shift+${key}`,
      onEntities(() => app.entities.nudge(dx, dy, true)),
      { repeat: true }
    );
  }

  // View navigation. Escape first cancels entity picking or selection.
  keymap.bind(
    "escape",
    onEntities(() => app.entities.escape())
  );
  keymap.bind(
    "escape",
    inLevel(() => void app.showWorld())
  );
  keymap.bind(
    "enter",
    inWorld(() => {
      const uid = app.selectedLevel()?.uid;
      if (uid !== undefined) void app.enterLevel(uid);
    })
  );
  keymap.bind(
    "delete",
    inWorld(() => {
      const uid = app.selectedLevel()?.uid;
      if (uid !== undefined) app.levelOps.remove(uid);
    })
  );
  keymap.bind(
    "mod+d",
    inWorld(() => {
      const uid = app.selectedLevel()?.uid;
      if (uid !== undefined) app.levelOps.duplicate(uid);
    })
  );

  keymap.hold(
    "alt",
    () => app.beginTemporaryEyedropper(),
    () => app.endTemporaryEyedropper()
  );
}
