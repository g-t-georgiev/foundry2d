import "./guided-tour";
import "./help-button";
import type { default as GuidedTour } from "./guided-tour";
import type { default as HelpButton } from "./help-button";
import { TourProgress, toursToShow } from "./progress";
import type { HelpItem } from "./help-button";
import type { Tour } from "./types";

declare global {
  interface HTMLElementTagNameMap {
    "guided-tour": GuidedTour;
    "help-button": HelpButton;
  }
}

export type { GuidedTour, HelpButton, HelpItem };
export * from "./types";
export * from "./progress";

export interface AppHelpOptions {
  /** Per-app key for remembering seen tours, e.g. "pixel". */
  app: string;
  /** The first-run tour (id "intro") and any "what's new" tours. */
  tours: readonly Tour[];
  /** Where the tour shows. */
  tourElement: GuidedTour;
  /** The toolbar's Help button. */
  helpButton: HelpButton;
  /** The manual's home and the app's shortcuts article. */
  manual: { home: string; shortcuts: string };
  /** Resolves when the app has finished starting (recovery, start screen). */
  ready: Promise<unknown>;
  /** Waits until nothing covers the app (e.g. the start screen was closed). */
  whenFree?: () => Promise<void>;
}

/**
 * Wires an app's Help menu and starts its tours: the intro on the first run,
 * later the "what's new" tours not seen yet. Every tour can be replayed from
 * the menu, and finishing or skipping one counts as seen.
 */
export function setupAppHelp(options: AppHelpOptions): void {
  const progress = new TourProgress(options.app);
  const intro = options.tours.find((t) => t.id === "intro");
  const run = async (tour: Tour) => {
    await options.tourElement.start(tour);
    // The intro covers everything that came before it.
    progress.markSeen(tour === intro ? options.tours.map((t) => t.id) : [tour.id]);
  };
  options.helpButton.items = [
    ...options.tours.map((tour) => ({
      label: tour.id === "intro" ? "Take the tour" : tour.title,
      action: () => void run(tour),
    })),
    { label: "Manual", hint: "↗", href: options.manual.home },
    { label: "Keyboard shortcuts", hint: "↗", href: options.manual.shortcuts },
  ];
  void options.ready.then(async () => {
    await options.whenFree?.();
    for (const tour of toursToShow(options.tours, progress.seen())) await run(tour);
  });
}
