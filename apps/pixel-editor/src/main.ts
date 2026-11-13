import "@foundry2d/ui";
import Application from "./Application";

const app = new Application({
  viewport: document.querySelector<HTMLElement>("#viewport")!,
  canvas: document.querySelector<HTMLCanvasElement>("#paintCanvas")!,
  layersPanel: document.querySelector("layers-panel")!,
});

// Exposed for debugging from devtools.
Object.assign(window, { foundry: app });
