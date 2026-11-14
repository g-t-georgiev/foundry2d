import "@foundry2d/ui";
import { openStorage } from "@foundry2d/core";
import Application from "./Application";

const app = new Application(await openStorage());

// Exposed for debugging from devtools.
Object.assign(window, { foundry: app });
