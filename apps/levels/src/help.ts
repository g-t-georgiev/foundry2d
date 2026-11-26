/// <reference types="vite/client" />
import {
  setupAppHelp,
  type GuidedTour,
  type HelpButton,
  type ProjectBrowser,
  type Tour,
} from "@gs2d/ui";

/** The manual: next to the app on the studio's site (`VITE_DOCS_URL` overrides). */
const DOCS = (import.meta.env.VITE_DOCS_URL as string | undefined) ?? "../docs/";
const manual = (article: string) => `${DOCS}#${article}`;
const more = (article: string) => ({ label: "More in the manual", href: manual(article) });

/**
 * The tours of Levels, as data. "intro" runs on the first start; add a
 * "what's new" tour (any other id) when a release adds something worth showing.
 */
export const TOURS: Tour[] = [
  {
    id: "intro",
    title: "A tour of Levels",
    steps: [
      {
        title: "Welcome to Levels",
        text: "Build levels from grids of values, tiles and placed entities, laid out in a world. This tour shows where everything is. Use the arrow keys or the buttons, and Esc to leave.",
        link: more("levels/tour"),
      },
      {
        target: ".view-switch",
        title: "World and level",
        text: "The world shows all levels, to arrange them; a level is where you paint. Enter opens the selected level, Esc goes back to the world.",
        link: more("levels/world-and-levels"),
      },
      {
        target: ".tools-grid",
        title: "Painting tools",
        text: "Pen, eraser, rectangle fill, bucket and value picker (B, E, R, G, I). The right mouse button erases with any tool.",
        link: more("levels/layers-and-painting"),
      },
      {
        target: "layers-panel",
        title: "Layers",
        text: "IntGrid layers hold values like walls, Tiles layers hold pictures from a tileset, Entities layers hold placed objects. The active layer gets the paint; + adds a layer.",
        link: more("levels/layers-and-painting"),
      },
      {
        target: ".right-sidebar",
        title: "Palette",
        text: "What the active layer paints: its values (keys 1–9), the tile picker, or the entity types with an inspector for the selected one.",
      },
      {
        target: "#viewport",
        title: "The canvas",
        text: "The wheel zooms, the middle button or Space+drag pans, F fits the level, # turns the grid on and off.",
        link: more("getting-started/canvas"),
      },
      {
        target: '.toolbar-actions [data-command="settings"]',
        title: "Project settings",
        text: "Layers, tilesets, entity types, enums and level fields are defined here, once for the whole project. Edits are undoable.",
        link: more("levels/entities"),
      },
      {
        target: "#exportButton",
        title: "Export",
        text: "Game JSON, CSV, PNG pictures, or a layer as an array for code. The arrow picks the format.",
        link: more("levels/exporting"),
      },
      {
        target: "help-button",
        title: "Help",
        text: "The tour, the manual and the keyboard shortcuts are here. The presets under Open → New are a good place to start, Pac-Man among them.",
      },
    ],
  },
];

/** The Help menu, and the tours on first start (after any start screen is closed). */
export function setupHelp(ready: Promise<unknown>): void {
  const browser = document.querySelector<ProjectBrowser>("project-browser");
  setupAppHelp({
    app: "levels",
    tours: TOURS,
    tourElement: document.querySelector<GuidedTour>("guided-tour")!,
    helpButton: document.querySelector<HelpButton>("help-button")!,
    manual: { home: manual("levels/tour"), shortcuts: manual("levels/shortcuts") },
    ready,
    whenFree: () =>
      new Promise<void>((resolve) => {
        if (!browser?.isOpen) resolve();
        else browser.addEventListener("close", () => resolve(), { once: true });
      }),
  });
}
