import { CANVAS_NAVIGATION, inert, Keymap, shortcutsArticle } from "@foundry2d/workspace";
import type Application from "./Application";
import { bindKeys } from "./keys";

/** The generated shortcuts article, from the repository root. */
export const SHORTCUTS_ARTICLE = "docs/manual/03-level-designer/10-shortcuts.md";

/** The level designer's shortcuts article, made from its real key bindings. */
export function shortcutsMarkdown(): string {
  const keymap = new Keymap();
  bindKeys(keymap, inert<Application>());
  return shortcutsArticle("level designer", [...keymap.shortcuts(), ...CANVAS_NAVIGATION]);
}
