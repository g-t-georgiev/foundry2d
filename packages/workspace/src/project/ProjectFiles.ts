import type { ProjectMeta, RecentFileRecord } from "@gs2d/core";
import type { OpenedProject, ProjectSession } from "./ProjectSession";
import type { FileHandleLike } from "./files";

/** What the start screen shows (structurally the `<project-browser>` data). */
export interface StartScreenData {
  title: string;
  templates: { id: string; label: string; description?: string }[];
  library: ProjectMeta[];
  recent: RecentFileRecord[];
  warning?: string;
  currentId?: string | null;
  /** Storage use shown next to the library, e.g. "1.2 MB used of 2 GB". */
  usage?: string;
}

/** The start screen / Open dialog, e.g. `<project-browser>`. */
export interface StartScreen {
  show(data: StartScreenData): void;
  close(): void;
}

export interface ProjectFilesOptions<Project> {
  session: ProjectSession;
  startScreen: StartScreen;
  /** Words used in messages, e.g. `{ one: "sprite", title: "Sprites" }`. */
  noun: { one: string; title: string };
  /** Builds a project from file, library or recovery JSON. Throws on bad input. */
  parse(opened: OpenedProject): Project;
  /** Makes `project` the open project (replacing the current one). */
  load(project: Project): void;
  /** Start-screen templates and what "New" creates from them. */
  templates(): StartScreenData["templates"];
  createFromTemplate(id: string): { project: Project; message: string } | null;
  /** Errors whose message is safe to show as is (format errors). */
  isUserFacingError(error: unknown): boolean;
  /** Status bar messages. */
  notify(message: string, timeout?: number): void;
  /** Confirmation prompts (default `window.confirm`). */
  confirm?(message: string): boolean;
  /** Extra clean-up after a library project is deleted (e.g. pruning assets). */
  afterDelete?(id: string): Promise<void>;
  /** Renames the open project (used by "Save a copy in this browser"). */
  setName?(name: string): void;
  /** Asks for a name (default `window.prompt`); `null` cancels. */
  promptName?(message: string, initial: string): string | null;
}

const formatBytes = (bytes: number): string => {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
};

/** "1.2 MB used of 2 GB" from the browser's storage estimate, if available. */
async function storageUsage(): Promise<string | undefined> {
  try {
    const estimate = await navigator.storage?.estimate?.();
    if (estimate?.usage === undefined) return undefined;
    const quota = estimate.quota ? ` of ${formatBytes(estimate.quota)}` : "";
    return `${formatBytes(estimate.usage)} used${quota}`;
  } catch {
    return undefined;
  }
}

/**
 * The file workflow both apps share on top of `ProjectSession`: New from a
 * template, Open (file, recent file, library), Save, Save as, the start
 * screen, and restoring unsaved work at startup. Every action that would
 * replace the open project asks first when it has unsaved changes.
 *
 * Its handler names match `bindProjectBrowser` in `@gs2d/ui`, so the
 * start screen's events can be bound to it directly.
 */
export class ProjectFiles<Project> {
  /** Set once `startup` is done; files launched before that wait for it. */
  private started = false;
  private launched: FileHandleLike | null = null;

  constructor(private readonly options: ProjectFilesOptions<Project>) {}

  private get session(): ProjectSession {
    return this.options.session;
  }

  private confirm(message: string): boolean {
    return (this.options.confirm ?? ((m) => window.confirm(m)))(message);
  }

  /** True when there is nothing to lose, or the user agreed to lose it. */
  confirmDiscard(action: string): boolean {
    return !this.session.state.dirty || this.confirm(`${action}? Unsaved changes will be lost.`);
  }

  private get openAction(): string {
    return `Open another ${this.options.noun.one}`;
  }

  // ------------------------------------------------------------------ new / open

  newFromTemplate(id: string): void {
    const created = this.options.createFromTemplate(id);
    if (!created || !this.confirmDiscard(`Start a new ${this.options.noun.one}`)) return;
    this.options.load(created.project);
    this.session.resetIdentity();
    this.options.notify(created.message);
  }

  async openFile(): Promise<void> {
    if (!this.confirmDiscard(this.openAction)) return;
    await this.attempt(async () => {
      const picked = await this.session.pickFile();
      if (!picked) return;
      this.options.load(this.options.parse(picked));
      await this.session.adoptFile(picked.name, picked.handle);
      this.options.notify(`Opened ${picked.handle?.name ?? picked.name}`);
    });
  }

  /** Opens a file handed over by the OS (an installed app's file handler). */
  async openHandle(handle: FileHandleLike): Promise<void> {
    if (!this.confirmDiscard(this.openAction)) return;
    await this.attempt(async () => {
      const opened = await this.session.readHandle(handle);
      this.options.load(this.options.parse(opened));
      await this.session.adoptFile(opened.name, opened.handle);
      // Nobody picked this file there, so the start screen may still be open.
      this.options.startScreen.close();
      this.options.notify(`Opened ${opened.handle.name}`);
    });
  }

  /**
   * Opens the files the OS launches an installed app with (double-clicking a
   * work file, "Open with"). Uses the Launch Handler API where the browser
   * has it (Chromium on desktop); elsewhere this does nothing. Call before
   * `startup()`, which opens a file launched by then instead of showing the
   * start screen.
   */
  bindLaunchQueue(): void {
    const queue = (
      globalThis as {
        launchQueue?: {
          setConsumer(consumer: (params: { files: readonly FileHandleLike[] }) => void): void;
        };
      }
    ).launchQueue;
    queue?.setConsumer((params) => {
      const [first] = params.files;
      if (!first) return;
      if (this.started) void this.openHandle(first);
      else this.launched = first;
    });
  }

  async openRecent(id: string): Promise<void> {
    if (!this.confirmDiscard(this.openAction)) return;
    await this.attempt(async () => {
      const opened = await this.session.openRecent(id);
      if (!opened) {
        this.options.notify("That file is no longer available.", 4000);
        return;
      }
      this.options.load(this.options.parse(opened));
      await this.session.adoptFile(opened.name, opened.handle);
      this.options.notify(`Opened ${opened.handle.name}`);
    });
  }

  async openLibrary(id: string): Promise<void> {
    if (!this.confirmDiscard(this.openAction)) return;
    await this.attempt(async () => {
      const opened = await this.session.openFromLibrary(id);
      if (!opened) {
        this.options.notify(`That ${this.options.noun.one} is no longer in this browser.`, 4000);
        return;
      }
      this.options.load(this.options.parse(opened));
      this.session.adoptLibrary(id);
      this.options.notify(`Opened ${opened.name}`);
    });
  }

  /** Removes a project from the browser library (files on disk are untouched). */
  async deleteLibrary(id: string): Promise<void> {
    const projects = await this.session.listLibrary();
    const name = projects.find((p) => p.id === id)?.name ?? `this ${this.options.noun.one}`;
    if (!this.confirm(`Delete "${name}" from this browser? Files on disk are not affected.`)) {
      return;
    }
    await this.session.deleteFromLibrary(id);
    await this.options.afterDelete?.(id);
    await this.showBrowser();
  }

  /** Copies a library project to a new entry named "... copy". */
  async duplicateLibrary(id: string): Promise<void> {
    const storage = this.session.storage;
    const stored = await storage.projects.get(id);
    if (!stored) return;
    // The copy is its own work, not another copy of the file.
    const { file: _file, ...record } = stored;
    const taken = new Set((await this.session.listLibrary()).map((p) => p.name));
    let name = `${record.name} copy`;
    for (let n = 2; taken.has(name); n++) name = `${record.name} copy ${n}`;
    const now = Date.now();
    const newId =
      globalThis.crypto?.randomUUID?.() ??
      `${now.toString(36)}-${Math.random().toString(36).slice(2)}`;
    await storage.projects.put({ ...record, id: newId, name, createdAt: now, updatedAt: now });
    this.options.notify(`Duplicated as "${name}"`);
    await this.showBrowser();
  }

  async removeRecent(id: string): Promise<void> {
    await this.session.removeRecent(id);
    await this.showBrowser();
  }

  // ------------------------------------------------------------------ save

  /** Ctrl+S: saves to the browser library and, if bound, back to the file. */
  async save(): Promise<void> {
    try {
      await this.session.save();
      const { fileName } = this.session.state;
      this.options.notify(
        fileName ? `Saved to ${fileName} and the browser library` : "Saved in this browser"
      );
    } catch (error) {
      this.reportSaveError(error);
    }
  }

  /**
   * "Save as" into the browser library: asks for a name, then saves the open
   * project as a new library entry and continues working on that copy (the
   * original entry or file stays as it was).
   */
  async saveCopyInBrowser(currentName: string): Promise<void> {
    const ask = this.options.promptName ?? ((message, initial) => window.prompt(message, initial));
    const name = ask("Save a copy in this browser as:", `${currentName} copy`)?.trim();
    if (!name) return;
    this.options.setName?.(name);
    this.session.detachForCopy();
    this.session.markDirty();
    try {
      await this.session.save();
      this.options.notify(`Saved a copy as "${name}" in this browser`);
    } catch (error) {
      this.reportSaveError(error);
    }
  }

  /** Ctrl+Shift+S: writes a file (picker where supported, download otherwise). */
  async saveAs(): Promise<void> {
    try {
      if (await this.session.saveAsFile()) {
        this.options.notify(`Saved ${this.session.state.fileName ?? "a copy to Downloads"}`);
      }
    } catch (error) {
      this.reportSaveError(error);
    }
  }

  // ------------------------------------------------------------------ start screen

  /** Opens the start screen / Open dialog. */
  async showBrowser(): Promise<void> {
    const [library, recent, usage] = await Promise.all([
      this.session.listLibrary(),
      this.session.listRecent(),
      storageUsage(),
    ]);
    const { noun } = this.options;
    this.options.startScreen.show({
      title: noun.title,
      templates: this.options.templates(),
      library,
      recent,
      currentId: this.session.state.libraryId,
      usage,
      warning:
        this.session.storage.kind === "memory"
          ? `Browser storage is unavailable (private mode?). ${noun.title} saved here are lost on reload; use Save as file.`
          : undefined,
    });
  }

  /**
   * Restores unsaved work from the last session, or shows the start screen
   * when there is saved work to pick from. Work started before storage
   * answered is never replaced. A file the app was launched with comes last,
   * asking first when there is unsaved work.
   */
  async startup(): Promise<void> {
    try {
      await this.restoreOrAsk();
    } finally {
      this.started = true;
      const launched = this.launched;
      this.launched = null;
      if (launched) await this.openHandle(launched);
    }
  }

  private async restoreOrAsk(): Promise<void> {
    const recovered = await this.session.loadRecovery();
    if (recovered && !this.session.state.dirty) {
      try {
        this.options.load(this.options.parse(recovered));
        await this.session.adoptRecovered(recovered.snapshot);
        this.options.notify("Restored unsaved work from the last session");
        return;
      } catch (error) {
        console.warn("Ignoring unreadable recovery snapshot", error);
      }
    }
    const [library, recent] = await Promise.all([
      this.session.listLibrary(),
      this.session.listRecent(),
    ]);
    const choice = library.length > 0 || recent.length > 0;
    if (choice && !this.launched && !this.session.state.dirty) {
      await this.showBrowser();
    }
  }

  // ------------------------------------------------------------------ errors

  private async attempt(run: () => Promise<void>): Promise<void> {
    try {
      await run();
    } catch (error) {
      this.reportOpenError(error);
    }
  }

  private reportOpenError(error: unknown): void {
    const message = this.options.isUserFacingError(error)
      ? (error as Error).message
      : error instanceof SyntaxError
        ? "File is not valid JSON."
        : error instanceof Error
          ? error.message
          : `Could not open the ${this.options.noun.one}.`;
    this.options.notify(message, 5000);
    console.error(error);
  }

  private reportSaveError(error: unknown): void {
    this.options.notify(`Save failed: ${(error as Error).message}`, 5000);
    console.error(error);
  }
}
