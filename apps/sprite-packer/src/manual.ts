import { CANVAS_NAVIGATION, inert, Keymap, shortcutsArticle } from "@foundry2d/workspace";
import { bindKeys, type PackerCommands } from "./keys";

/** The generated shortcuts article, from the repository root. */
export const SHORTCUTS_ARTICLE = "docs/manual/04-sprite-packer/07-shortcuts.md";

/** The sprite packer's shortcuts article, made from its real key bindings. */
export function shortcutsMarkdown(): string {
  const keymap = new Keymap();
  bindKeys(keymap, inert<PackerCommands>());
  return shortcutsArticle("sprite packer", [...keymap.shortcuts(), ...CANVAS_NAVIGATION]);
}
