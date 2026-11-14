import "@foundry2d/ui";
import { assertPixelByteOrder, openStorage } from "@foundry2d/core";
import Application from "./Application";

assertPixelByteOrder();

const $ = <T extends Element>(selector: string) => document.querySelector<T>(selector)!;

const app = new Application(
  {
    viewport: $<HTMLElement>("#viewport"),
    canvas: $<HTMLCanvasElement>("#paintCanvas"),
    layersPanel: $("layers-panel"),
    projectBrowser: $("project-browser"),
    timeline: $<HTMLElement>("#timeline"),
    previewCanvas: $<HTMLCanvasElement>("#previewCanvas"),
    previewToggle: document.querySelector<HTMLButtonElement>("#previewPlay"),
    exportDialog: $<HTMLDialogElement>("#exportDialog"),
    paletteRoot: $<HTMLElement>(".palette").parentElement!,
  },
  await openStorage()
);

// Exposed for debugging from devtools.
Object.assign(window, { foundry: app });
