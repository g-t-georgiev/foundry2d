export interface ProjectBrowserTemplate {
  id: string;
  label: string;
  description?: string;
}

export interface ProjectBrowserLibraryItem {
  id: string;
  name: string;
  /** Epoch milliseconds. */
  updatedAt: number;
  /** Data URL. */
  thumbnail?: string;
}

export interface ProjectBrowserRecentItem {
  id: string;
  name: string;
  openedAt: number;
}

export interface ProjectBrowserData {
  title: string;
  templates: ProjectBrowserTemplate[];
  library: ProjectBrowserLibraryItem[];
  recent: ProjectBrowserRecentItem[];
  /** Shows a warning banner, e.g. when only in-memory storage is available. */
  warning?: string;
  /** Library id of the project currently open (highlighted). */
  currentId?: string | null;
  /** Storage use shown next to the library heading, e.g. "1.2 MB used of 2 GB". */
  usage?: string;
}

export const ProjectBrowserEvents = {
  New: "browser-new",
  OpenFile: "browser-open-file",
  OpenRecent: "browser-open-recent",
  RemoveRecent: "browser-remove-recent",
  OpenLibrary: "browser-open-library",
  DeleteLibrary: "browser-delete-library",
  DuplicateLibrary: "browser-duplicate-library",
} as const;

export type ProjectBrowserEventPayloads = {
  [ProjectBrowserEvents.New]: { templateId: string };
  [ProjectBrowserEvents.OpenFile]: void;
  [ProjectBrowserEvents.OpenRecent]: { id: string };
  [ProjectBrowserEvents.RemoveRecent]: { id: string };
  [ProjectBrowserEvents.OpenLibrary]: { id: string };
  [ProjectBrowserEvents.DeleteLibrary]: { id: string };
  [ProjectBrowserEvents.DuplicateLibrary]: { id: string };
};

export type ProjectBrowserEventName = keyof ProjectBrowserEventPayloads;

export type ProjectBrowserEventMap = HTMLElementEventMap & {
  [K in ProjectBrowserEventName]: CustomEvent<ProjectBrowserEventPayloads[K]>;
};
