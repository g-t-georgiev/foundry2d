import "./split-button";
import type { default as SplitButton } from "./split-button";

declare global {
  interface HTMLElementTagNameMap {
    "split-button": SplitButton;
  }
}

export type { SplitButton };
export * from "./types";
