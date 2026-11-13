import "./layers-panel";
import type { default as LayersPanel } from "./layers-panel";

declare global {
  interface HTMLElementTagNameMap {
    "layers-panel": LayersPanel;
  }
}

export type { LayersPanel };
export * from "./types";
