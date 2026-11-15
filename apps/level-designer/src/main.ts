/// <reference types="vite/client" />
import { registerAppUpdates } from "@foundry2d/ui";
import { assertPixelByteOrder, openStorage } from "@foundry2d/core";
import Application from "./Application";

assertPixelByteOrder();
registerAppUpdates({ enabled: import.meta.env.PROD, appName: "Level Designer" });

const app = new Application(await openStorage());

// Exposed for debugging from devtools.
Object.assign(window, { foundry: app });
