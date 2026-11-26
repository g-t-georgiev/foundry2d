import { CANVAS_NAVIGATION, inert, Keymap, shortcutsArticle } from "@gs2d/workspace";
import type Application from "./Application";
import { bindKeys } from "./keys";

/** The generated shortcuts article, from the repository root. */
export const SHORTCUTS_ARTICLE = "docs/manual/03-levels/10-shortcuts.md";

/** Levels' shortcuts article, made from its real key bindings. */
export function shortcutsMarkdown(): string {
  const keymap = new Keymap();
  bindKeys(keymap, inert<Application>());
  return shortcutsArticle("Levels", [...keymap.shortcuts(), ...CANVAS_NAVIGATION]);
}
