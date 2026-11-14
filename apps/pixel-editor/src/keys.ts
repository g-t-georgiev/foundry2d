import type { Keymap } from "@foundry2d/workspace";
import { ApplicationStateActions, applicationStore } from "./state";
import type Application from "./Application";

type Toggle =
  | ApplicationStateActions.ToggleGrid
  | ApplicationStateActions.TogglePreview
  | ApplicationStateActions.ToggleOnionSkin;

/**
 * The pixel editor's keyboard shortcuts. Kept in one place so they read as a
 * reference (and so the manual's hotkey table can be generated from them).
 */
export function bindKeys(keymap: Keymap, app: Application): void {
  const dispatch = applicationStore.dispatch.bind(applicationStore);
  const state = () => applicationStore.getState();
  const setTool = (tool: string) => () => void dispatch(ApplicationStateActions.SetTool, tool);
  const penSize = (delta: number) => () => {
    const size = Math.max(1, Math.min(32, state().penSize + delta));
    dispatch(ApplicationStateActions.EditPen, { size });
  };
  const toggle = (action: Toggle) => () => {
    const { preferences } = state();
    const enabled =
      action === ApplicationStateActions.ToggleGrid
        ? preferences.grid.enabled
        : action === ApplicationStateActions.TogglePreview
          ? preferences.preview.enabled
          : preferences.onionSkin.enabled;
    dispatch(action, { enabled: !enabled });
  };
  const toggleMirror = (axis: "x" | "y") => () => {
    const mirror = { ...state().preferences.mirror };
    mirror[axis] = !mirror[axis];
    dispatch(ApplicationStateActions.SetMirror, mirror);
  };
  const { clipboard, files, sprite } = app;

  // History and files.
  keymap.bind("mod+z", () => app.undo(), { repeat: true });
  keymap.bind("mod+shift+z", () => app.redo(), { repeat: true });
  keymap.bind("mod+y", () => app.redo(), { repeat: true });
  keymap.bind("mod+s", () => void files.save());
  keymap.bind("mod+shift+s", () => void files.saveAs());
  keymap.bind("mod+o", () => void files.showBrowser());
  keymap.bind("mod+e", () => app.openExport());

  // Tools.
  keymap.bind("b", setTool("pen"));
  keymap.bind("p", setTool("pen"));
  keymap.bind("e", setTool("eraser"));
  keymap.bind("g", setTool("bucket"));
  keymap.bind("i", setTool("eyedropper"));
  keymap.bind("l", setTool("line"));
  keymap.bind("r", setTool("rect"));
  keymap.bind("c", setTool("ellipse"));
  keymap.bind("m", setTool("select"));
  keymap.bind("q", setTool("lasso"));
  keymap.bind("w", setTool("wand"));
  keymap.bind("[", penSize(-1), { repeat: true });
  keymap.bind("]", penSize(1), { repeat: true });
  keymap.hold(
    "alt",
    () => app.beginTemporaryEyedropper(),
    () => app.endTemporaryEyedropper()
  );

  // Selection and clipboard.
  keymap.bind("mod+a", () => clipboard.selectAll());
  keymap.bind("mod+d", () => void clipboard.deselect());
  keymap.bind("mod+c", () => void clipboard.copy());
  keymap.bind("mod+x", () => clipboard.cut());
  // Ctrl+V is handled by the document "paste" event (Application), so
  // images copied in other apps arrive with it; a keymap binding would
  // cancel the key press and with it the paste event.
  keymap.bind("escape", () => clipboard.deselect());
  keymap.bind("delete", () => clipboard.clearLayer());
  keymap.bind("shift+h", () => clipboard.transform("flipX"));
  keymap.bind("shift+v", () => clipboard.transform("flipY"));
  keymap.bind("shift+r", () => clipboard.transform("rotateCW"));

  // View.
  keymap.bind("shift+x", toggleMirror("x"));
  keymap.bind("shift+y", toggleMirror("y"));
  keymap.bind("#", toggle(ApplicationStateActions.ToggleGrid));
  keymap.bind("alt+p", toggle(ApplicationStateActions.TogglePreview));
  keymap.bind("alt+o", toggle(ApplicationStateActions.ToggleOnionSkin));
  keymap.bind("f", () => app.fitToView());
  keymap.bind("+", () => app.zoomBy(1.25), { repeat: true });
  keymap.bind("=", () => app.zoomBy(1.25), { repeat: true });
  keymap.bind("-", () => app.zoomBy(0.8), { repeat: true });

  // Layers and frames.
  keymap.bind("n", () => app.layers.addLayer());
  keymap.bind(",", () => sprite.selectFrame(sprite.currentIndex - 1), { repeat: true });
  keymap.bind(".", () => sprite.selectFrame(sprite.currentIndex + 1), { repeat: true });
  keymap.bind("shift+n", () => app.addFrame(false));
  keymap.bind("shift+d", () => app.addFrame(true));
}
