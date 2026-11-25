/// <reference types="vite/client" />
import { registerAppUpdates } from "@foundry2d/ui";
import { assertPixelByteOrder, openStorage } from "@foundry2d/core";
import Application from "./Application";
import { setupHelp } from "./help";

assertPixelByteOrder();
registerAppUpdates({ enabled: import.meta.env.PROD, appName: "Sprite Packer" });

const app = new Application(await openStorage());

setupHelp(app.ready);

// Exposed for debugging from devtools.
Object.assign(window, { foundry: app });
