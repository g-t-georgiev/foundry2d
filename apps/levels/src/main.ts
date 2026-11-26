/// <reference types="vite/client" />
import { registerAppUpdates } from "@gs2d/ui";
import { assertPixelByteOrder, openStorage } from "@gs2d/core";
import Application from "./Application";
import { setupHelp } from "./help";

assertPixelByteOrder();
registerAppUpdates({ enabled: import.meta.env.PROD, appName: "Levels" });

const app = new Application(await openStorage());

setupHelp(app.ready);

// Exposed for debugging from devtools.
Object.assign(window, { foundry: app });
