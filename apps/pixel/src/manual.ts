import { CANVAS_NAVIGATION, inert, Keymap, shortcutsArticle } from "@gs2d/workspace";
import type Application from "./Application";
import { bindKeys } from "./keys";

/** The generated shortcuts article, from the repository root. */
export const SHORTCUTS_ARTICLE = "docs/manual/02-pixel/08-shortcuts.md";

/** Pixel's shortcuts article, made from its real key bindings. */
export function shortcutsMarkdown(): string {
  const keymap = new Keymap();
  bindKeys(keymap, inert<Application>());
  return shortcutsArticle("Pixel", [...keymap.shortcuts(), ...CANVAS_NAVIGATION]);
}
