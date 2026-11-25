/// <reference types="vite/client" />
import {
  setupAppHelp,
  type GuidedTour,
  type HelpButton,
  type ProjectBrowser,
  type Tour,
} from "@foundry2d/ui";

/** The manual site: next to the built app, or the docs dev server (`VITE_DOCS_URL` overrides). */
const DOCS =
  (import.meta.env.VITE_DOCS_URL as string | undefined) ??
  (import.meta.env.DEV ? "http://localhost:3003/" : "../docs/");
const manual = (article: string) => `${DOCS}#${article}`;
const more = (article: string) => ({ label: "More in the manual", href: manual(article) });

/**
 * The Pixel Editor's tours, as data. "intro" runs on the first start; add a
 * "what's new" tour (any other id) when a release adds something worth showing.
 */
export const TOURS: Tour[] = [
  {
    id: "intro",
    title: "A tour of the Pixel Editor",
    steps: [
      {
        title: "Welcome to the Pixel Editor",
        text: "Draw sprites and animations pixel by pixel. This tour shows where everything is; it takes a minute. Use the arrow keys or the buttons, and Esc to leave.",
      },
      {
        target: ".tool-grid",
        title: "Tools",
        text: "Pen, eraser, bucket, colour picker, shapes and three selection tools. Each has a key: B, E, G, I, L, R, C, M, Q and W. Hold Alt to pick a colour.",
        link: more("pixel-editor/drawing"),
      },
      {
        target: ".palette",
        title: "Colours",
        text: "Click the swatch above to choose a colour. The palette keeps the colours of this sprite; + adds the current one, and palettes can be imported from Lospec, GIMP or Aseprite.",
        link: more("pixel-editor/colours"),
      },
      {
        target: "#viewport",
        title: "The canvas",
        text: "Draw here. The wheel zooms at the pointer, the middle button or Space+drag pans, and F fits the sprite in view.",
        link: more("getting-started/canvas"),
      },
      {
        target: "#timeline",
        title: "Frames",
        text: "Each frame is one picture of an animation. Shift+N adds one, Shift+D duplicates, comma and full stop switch. Onion skin shows the neighbours faintly.",
        link: more("pixel-editor/layers-and-frames"),
      },
      {
        target: "layers-panel",
        title: "Layers",
        text: "Layers are shared by all frames. The eye hides a layer, the lock protects it, and the rail on top adds, copies, moves and deletes.",
        link: more("pixel-editor/layers-and-frames"),
      },
      {
        target: ".preview-panel",
        title: "Preview",
        text: "Your animation, playing at its frame durations while you draw.",
      },
      {
        target: '[data-command="save"]',
        title: "Saving",
        text: "Ctrl+S keeps the sprite in this browser and in its file once it has one; Save as file writes a .f2dsprite. Unsaved work survives a crash or a closed tab.",
        link: more("getting-started/projects-and-files"),
      },
      {
        target: '[data-command="export"]',
        title: "Export",
        text: "PNG and other images, GIFs, and spritesheets with data for Phaser, PixiJS, Godot, LibGDX and more.",
        link: more("pixel-editor/exporting"),
      },
      {
        target: "help-button",
        title: "Help",
        text: "The tour, the manual and the keyboard shortcuts are here whenever you need them. Have fun!",
      },
    ],
  },
];

/** The Help menu, and the tours on first start (after any start screen is closed). */
export function setupHelp(ready: Promise<unknown>): void {
  const browser = document.querySelector<ProjectBrowser>("project-browser");
  setupAppHelp({
    app: "pixel",
    tours: TOURS,
    tourElement: document.querySelector<GuidedTour>("guided-tour")!,
    helpButton: document.querySelector<HelpButton>("help-button")!,
    manual: { home: manual("pixel-editor/tour"), shortcuts: manual("pixel-editor/shortcuts") },
    ready,
    whenFree: () =>
      new Promise<void>((resolve) => {
        if (!browser?.isOpen) resolve();
        else browser.addEventListener("close", () => resolve(), { once: true });
      }),
  });
}
