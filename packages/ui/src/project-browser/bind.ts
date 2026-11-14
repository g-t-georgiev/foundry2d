import type ProjectBrowser from "./project-browser";
import { ProjectBrowserEvents } from "./types";

/** What each start-screen action calls (e.g. `ProjectFiles` from `@foundry2d/workspace`). */
export interface ProjectBrowserHandlers {
  newFromTemplate(templateId: string): void;
  openFile(): unknown;
  openRecent(id: string): unknown;
  removeRecent(id: string): unknown;
  openLibrary(id: string): unknown;
  deleteLibrary(id: string): unknown;
}

/**
 * Routes `<project-browser>` intent events to `handlers`. Returns a function
 * that removes the listeners.
 */
export function bindProjectBrowser(
  browser: ProjectBrowser,
  handlers: ProjectBrowserHandlers
): () => void {
  const abort = new AbortController();
  const options = { signal: abort.signal };
  browser.addEventListener(
    ProjectBrowserEvents.New,
    (ev) => handlers.newFromTemplate(ev.detail.templateId),
    options
  );
  browser.addEventListener(ProjectBrowserEvents.OpenFile, () => void handlers.openFile(), options);
  browser.addEventListener(
    ProjectBrowserEvents.OpenRecent,
    (ev) => void handlers.openRecent(ev.detail.id),
    options
  );
  browser.addEventListener(
    ProjectBrowserEvents.RemoveRecent,
    (ev) => void handlers.removeRecent(ev.detail.id),
    options
  );
  browser.addEventListener(
    ProjectBrowserEvents.OpenLibrary,
    (ev) => void handlers.openLibrary(ev.detail.id),
    options
  );
  browser.addEventListener(
    ProjectBrowserEvents.DeleteLibrary,
    (ev) => void handlers.deleteLibrary(ev.detail.id),
    options
  );
  return () => abort.abort();
}
