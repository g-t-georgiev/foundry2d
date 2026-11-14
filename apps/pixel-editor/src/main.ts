import "@foundry2d/ui";
import { openStorage } from "@foundry2d/core";
import Application from "./Application";

const app = new Application(
  {
    viewport: document.querySelector<HTMLElement>("#viewport")!,
    canvas: document.querySelector<HTMLCanvasElement>("#paintCanvas")!,
    layersPanel: document.querySelector("layers-panel")!,
    projectBrowser: document.querySelector("project-browser")!,
  },
  await openStorage()
);

// Exposed for debugging from devtools.
Object.assign(window, { foundry: app });
