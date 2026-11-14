import "./project-browser";
import type { default as ProjectBrowser } from "./project-browser";

declare global {
  interface HTMLElementTagNameMap {
    "project-browser": ProjectBrowser;
  }
}

export type { ProjectBrowser };
export * from "./types";
export * from "./bind";
