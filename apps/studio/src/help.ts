import type { Tour } from "@gs2d/ui";

const more = (article: string) => ({ label: "More in the manual", href: `./docs/#${article}` });

/** The hub's tours, as data ("intro" runs on the first visit). */
export const TOURS: Tour[] = [
  {
    id: "intro",
    title: "A tour of Game Studio 2D",
    steps: [
      {
        title: "Welcome to Game Studio 2D",
        text: "Tools for 2D games: Pixel for sprites, Levels for maps, Packer for spritesheets. This page is where you start and come back to.",
      },
      {
        target: "#newSection",
        title: "Start something new",
        text: "Each tool's templates: sprite sizes, level presets like Pac-Man, packs set up for an engine. A click opens the tool with it.",
      },
      {
        target: "#librarySection",
        title: "In this browser",
        text: "Everything you saved with Ctrl+S, from every tool, with search. Saving to a file keeps a copy here too.",
        link: more("getting-started/projects-and-files"),
      },
      {
        target: "#storageSection",
        title: "Storage",
        text: "How much this browser keeps for the studio, and clean-up. Unsaved work (Continue) and recent files appear above once there are some.",
      },
      {
        target: "#toolLinks",
        title: "The tools",
        text: "Open a tool directly from here. Each tool has its own tour the first time you open it.",
      },
      {
        target: "help-button",
        title: "Help",
        text: "The tour and the manual are always here.",
      },
    ],
  },
];
