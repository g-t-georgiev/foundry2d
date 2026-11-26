/// <reference types="vite/client" />
import {
  setupAppHelp,
  type GuidedTour,
  type HelpButton,
  type ProjectBrowser,
  type Tour,
} from "@gs2d/ui";

/** The manual site: next to the built app, or the docs dev server (`VITE_DOCS_URL` overrides). */
const DOCS =
  (import.meta.env.VITE_DOCS_URL as string | undefined) ??
  (import.meta.env.DEV ? "http://localhost:3003/" : "../docs/");
const manual = (article: string) => `${DOCS}#${article}`;
const more = (article: string) => ({ label: "More in the manual", href: manual(article) });

/**
 * Packer's tours, as data. "intro" runs on the first start; add a
 * "what's new" tour (any other id) when a release adds something worth showing.
 */
export const TOURS: Tour[] = [
  {
    id: "intro",
    title: "A tour of Packer",
    steps: [
      {
        title: "Welcome to Packer",
        text: "Pack many images into spritesheets with data for your game engine. This tour shows where everything is. Use the arrow keys or the buttons, and Esc to leave.",
      },
      {
        target: ".sprites-section .button-row",
        title: "Adding sprites",
        text: "Add images or whole folders, or drop them on the window. Pixel sprites come in frame by frame, and a sheet added with its data is unpacked. A live folder follows changes on disk.",
        link: more("packer/adding-sprites"),
      },
      {
        target: "#spriteList",
        title: "Sprites",
        text: "Named after their files. Numbered names (walk_1, walk_2…) become animations. F2 renames, Delete removes.",
        link: more("packer/animations-and-pivots"),
      },
      {
        target: "#viewport",
        title: "The sheets",
        text: "Repacked as you change anything. Click a sprite to select it; the wheel zooms and F fits.",
      },
      {
        target: "#settings",
        title: "Settings",
        text: "Packing algorithm, trimming, padding, sheet size, the data format and image output. The Result section shows how full the sheets are.",
        link: more("packer/settings"),
      },
      {
        target: '[data-setting="dataFormat"]',
        title: "Data format",
        text: "Choose the engine's format here: TexturePacker JSON for Phaser and PixiJS, Godot, LibGDX, Starling, or CSS.",
        link: more("file-formats/spritesheet-data"),
      },
      {
        target: "#exportButton",
        title: "Export",
        text: "Writes the sheets and their data as one ZIP, or file by file.",
        link: more("packer/exporting"),
      },
      {
        target: "help-button",
        title: "Help",
        text: "The tour, the manual and the keyboard shortcuts are here whenever you need them.",
      },
    ],
  },
];

/** The Help menu, and the tours on first start (after any start screen is closed). */
export function setupHelp(ready: Promise<unknown>): void {
  const browser = document.querySelector<ProjectBrowser>("project-browser");
  setupAppHelp({
    app: "packer",
    tours: TOURS,
    tourElement: document.querySelector<GuidedTour>("guided-tour")!,
    helpButton: document.querySelector<HelpButton>("help-button")!,
    manual: { home: manual("packer/tour"), shortcuts: manual("packer/shortcuts") },
    ready,
    whenFree: () =>
      new Promise<void>((resolve) => {
        if (!browser?.isOpen) resolve();
        else browser.addEventListener("close", () => resolve(), { once: true });
      }),
  });
}
