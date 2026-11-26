import type { Keymap } from "@gs2d/workspace";

/** What the shortcuts act on (`Application`). */
export interface PackerCommands {
  undo(): void;
  redo(): void;
  save(): void;
  saveAs(): void;
  open(): void;
  export(): void;
  fit(): void;
  removeSelected(): void;
  deselect(): void;
}

/**
 * Packer's keyboard shortcuts, in one place so they read as a
 * reference; their labels and groups make the manual's hotkey table
 * (`vp run docs`), so the docs can't drift from the code.
 */
export function bindKeys(keymap: Keymap, app: PackerCommands): void {
  const repeat = true;
  const whileTyping = true;

  let group = "History and files";
  keymap.bind("mod+z", () => app.undo(), { repeat, label: "Undo", group });
  keymap.bind("mod+shift+z", () => app.redo(), { repeat, label: "Redo", group });
  keymap.bind("mod+y", () => app.redo(), { repeat, label: "Redo", group });
  keymap.bind("mod+s", () => app.save(), { whileTyping, label: "Save", group });
  keymap.bind("mod+shift+s", () => app.saveAs(), { whileTyping, label: "Save as file", group });
  keymap.bind("mod+o", () => app.open(), {
    whileTyping,
    label: "New or open (start screen)",
    group,
  });
  keymap.bind("mod+e", () => app.export(), {
    whileTyping,
    label: "Export the way the Export button shows",
    group,
  });

  group = "Sprites";
  keymap.bind("delete", () => app.removeSelected(), {
    label: "Remove the selected sprites",
    group,
  });
  keymap.bind("escape", () => app.deselect(), { label: "Deselect", group });
  keymap.describe("f2", { label: "Rename the selected sprite (in the list)", group });
  keymap.describe("arrowup", { label: "Previous or next sprite (in the list)", group });
  keymap.describe("arrowdown", { label: "Previous or next sprite (in the list)", group });
  keymap.describe("mod+a", { label: "Select all sprites (in the list)", group });

  group = "View";
  keymap.bind("f", () => app.fit(), { label: "Fit to view", group });
}
