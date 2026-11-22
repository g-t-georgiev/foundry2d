import "@foundry2d/ui";
import { assertPixelByteOrder, openStorage } from "@foundry2d/core";
import Application from "./Application";

assertPixelByteOrder();

const app = new Application(await openStorage());

// Exposed for debugging from devtools.
Object.assign(window, { foundry: app });
