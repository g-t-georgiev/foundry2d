import { CANVAS_NAVIGATION, inert, Keymap, shortcutsArticle } from "@gs2d/workspace";
import { bindKeys, type PackerCommands } from "./keys";

/** The generated shortcuts article, from the repository root. */
export const SHORTCUTS_ARTICLE = "docs/manual/04-packer/07-shortcuts.md";

/** Packer's shortcuts article, made from its real key bindings. */
export function shortcutsMarkdown(): string {
  const keymap = new Keymap();
  bindKeys(keymap, inert<PackerCommands>());
  return shortcutsArticle("Packer", [...keymap.shortcuts(), ...CANVAS_NAVIGATION]);
}
