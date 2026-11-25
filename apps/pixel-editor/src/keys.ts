import type { Keymap } from "@foundry2d/workspace";
import { ApplicationStateActions, applicationStore } from "./state";
import type Application from "./Application";

type Toggle =
  | ApplicationStateActions.ToggleGrid
  | ApplicationStateActions.TogglePreview
  | ApplicationStateActions.ToggleOnionSkin;

/**
 * The pixel editor's keyboard shortcuts. Kept in one place so they read as a
 * reference; their labels and groups make the manual's hotkey table
 * (`vp run docs`), so the docs can't drift from the code.
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
  const repeat = true;
  const whileTyping = true;

  let group = "History and files";
  keymap.bind("mod+z", () => app.undo(), { repeat, label: "Undo", group });
  keymap.bind("mod+shift+z", () => app.redo(), { repeat, label: "Redo", group });
  keymap.bind("mod+y", () => app.redo(), { repeat, label: "Redo", group });
  keymap.bind("mod+s", () => void files.save(), { whileTyping, label: "Save", group });
  keymap.bind("mod+shift+s", () => void files.saveAs(), {
    whileTyping,
    label: "Save as file",
    group,
  });
  keymap.bind("mod+o", () => void files.showBrowser(), {
    whileTyping,
    label: "New or open (start screen)",
    group,
  });
  keymap.bind("mod+e", () => app.openExport(), { whileTyping, label: "Export…", group });

  group = "Tools";
  keymap.bind("b", setTool("pen"), { label: "Pen", group });
  keymap.bind("p", setTool("pen"), { label: "Pen", group });
  keymap.bind("e", setTool("eraser"), { label: "Eraser", group });
  keymap.bind("g", setTool("bucket"), { label: "Paint bucket", group });
  keymap.bind("i", setTool("eyedropper"), { label: "Colour picker", group });
  keymap.bind("l", setTool("line"), { label: "Line", group });
  keymap.bind("r", setTool("rect"), { label: "Rectangle (Shift: filled)", group });
  keymap.bind("c", setTool("ellipse"), { label: "Ellipse (Shift: filled)", group });
  keymap.bind("m", setTool("select"), { label: "Select and move", group });
  keymap.bind("q", setTool("lasso"), { label: "Lasso select", group });
  keymap.bind("w", setTool("wand"), { label: "Magic wand", group });
  keymap.bind("[", penSize(-1), { repeat, label: "Smaller pen", group });
  keymap.bind("]", penSize(1), { repeat, label: "Bigger pen", group });
  keymap.hold(
    "alt",
    () => app.beginTemporaryEyedropper(),
    () => app.endTemporaryEyedropper(),
    { label: "Colour picker while held (not with a selection tool)", group }
  );

  group = "Selection and clipboard";
  keymap.bind("mod+a", () => clipboard.selectAll(), { label: "Select all", group });
  keymap.bind("mod+d", () => void clipboard.deselect(), { label: "Deselect", group });
  keymap.bind("escape", () => clipboard.deselect(), { label: "Deselect", group });
  keymap.bind("mod+c", () => void clipboard.copy(), {
    label: "Copy (also as an image for other apps)",
    group,
  });
  keymap.bind("mod+x", () => clipboard.cut(), { label: "Cut", group });
  // Ctrl+V is handled by the document "paste" event (Application), so
  // images copied in other apps arrive with it; a keymap binding would
  // cancel the key press and with it the paste event.
  keymap.describe("mod+v", { label: "Paste (also images from other apps)", group });
  keymap.bind("delete", () => clipboard.clearLayer(), {
    label: "Clear the selection, or the whole layer",
    group,
  });
  keymap.bind("shift+h", () => clipboard.transform("flipX"), {
    label: "Flip horizontally (selection or layer)",
    group,
  });
  keymap.bind("shift+v", () => clipboard.transform("flipY"), {
    label: "Flip vertically (selection or layer)",
    group,
  });
  keymap.bind("shift+r", () => clipboard.transform("rotateCW"), {
    label: "Rotate 90° clockwise (selection or layer)",
    group,
  });

  group = "View";
  keymap.bind("shift+x", toggleMirror("x"), { label: "Mirror drawing left/right", group });
  keymap.bind("shift+y", toggleMirror("y"), { label: "Mirror drawing top/bottom", group });
  keymap.bind("#", toggle(ApplicationStateActions.ToggleGrid), { label: "Grid on/off", group });
  keymap.bind("alt+p", toggle(ApplicationStateActions.TogglePreview), {
    label: "Preview mode on/off",
    group,
  });
  keymap.bind("alt+o", toggle(ApplicationStateActions.ToggleOnionSkin), {
    label: "Onion skin on/off",
    group,
  });
  keymap.bind("f", () => app.fitToView(), { label: "Fit to view", group });
  keymap.bind("+", () => app.zoomBy(1.25), { repeat, label: "Zoom in", group });
  keymap.bind("=", () => app.zoomBy(1.25), { repeat, label: "Zoom in", group });
  keymap.bind("-", () => app.zoomBy(0.8), { repeat, label: "Zoom out", group });

  group = "Layers and frames";
  keymap.bind("n", () => app.layers.addLayer(), { label: "New layer", group });
  keymap.bind(",", () => sprite.selectFrame(sprite.currentIndex - 1), {
    repeat,
    label: "Previous frame",
    group,
  });
  keymap.bind(".", () => sprite.selectFrame(sprite.currentIndex + 1), {
    repeat,
    label: "Next frame",
    group,
  });
  keymap.bind("shift+n", () => app.addFrame(false), { label: "New frame", group });
  keymap.bind("shift+d", () => app.addFrame(true), { label: "Duplicate frame", group });
}
