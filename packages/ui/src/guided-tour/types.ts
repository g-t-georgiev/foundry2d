/** One stop of a tour: a message, pointing at part of the page or centred. */
export interface TourStep {
  /** CSS selector of what to point at. Left out, or not on screen: the card is centred. */
  target?: string;
  title: string;
  text: string;
  /** "Read more" link, e.g. into the manual. */
  link?: { label: string; href: string };
}

/** A tour of an app, as data. */
export interface Tour {
  /**
   * Stored once seen. "intro" is the first-run tour; others (e.g.
   * "whats-new-2026-12") are shown once to people who saw the intro before.
   */
  id: string;
  title: string;
  steps: TourStep[];
}

/** How a tour ended. */
export type TourResult = "done" | "skipped";
