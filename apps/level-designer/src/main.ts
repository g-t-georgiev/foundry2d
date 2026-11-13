import "@foundry2d/ui";
import Application from "./Application";

const app = new Application();

// Exposed for debugging from devtools.
Object.assign(window, { foundry: app });
