import type { ProjectMeta, ProjectRecord, RecentFileRecord, Storage } from "@gs2d/core";
import {
  downloadBlob,
  ensurePermission,
  isAbortError,
  pickFileToOpen,
  pickFileToSave,
  stripFileExtension,
  writeFileHandle,
  type FileHandleLike,
  type FileTypeSpec,
} from "./files";

export interface ProjectSessionOptions {
  /** Editor id used to partition the library, e.g. "pixel" or "level". */
  app: string;
  storage: Storage;
  fileType: FileTypeSpec;
  /** Shown after the project name in the window title. */
  titleSuffix: string;
  /** The project as a self-contained file (what Save to file writes). */
  serialize(): unknown;
  /**
   * The bytes or text written to a file for `serialize()`'s result. Defaults
   * to JSON text; Levels can write a packaged ZIP instead.
   */
  encodeFile?(json: unknown): Promise<Blob | string>;
  /** Reads a work file (`encodeFile`'s inverse). Defaults to parsing JSON. */
  decodeFile?(file: File): Promise<unknown>;
  /** Converts the file form for the library/recovery (e.g. moves images to the asset store). */
  toStored?(json: unknown): Promise<unknown>;
  /** Inverse of `toStored`. */
  fromStored?(json: unknown): Promise<unknown>;
  getName(): string;
  thumbnail?(): string | undefined;
  onChange?(state: SessionState): void;
  /** Debounce for crash-recovery writes, in ms (default 800). */
  recoveryDelay?: number;
}

export interface SessionState {
  /** Id in the local library, once saved there. */
  libraryId: string | null;
  /** Name of the bound file, if the project was opened from or saved to one. */
  fileName: string | null;
  /** Whether Save writes back to that file (File System Access API). */
  hasFileHandle: boolean;
  dirty: boolean;
  storageKind: Storage["kind"];
}

export interface OpenedProject {
  json: unknown;
  /** File name without extension (for files) or the library name. */
  name: string;
}

export interface RecoverySnapshot {
  libraryId: string | null;
  fileName: string | null;
  recentId: string | null;
  data: unknown;
}

/** How much older than its library copy a file may look, in ms: file systems round times. */
const FILE_TIME_SLACK = 3000;

const newId = (): string =>
  globalThis.crypto?.randomUUID?.() ??
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

/**
 * Where the open project lives and whether it has unsaved changes.
 *
 * - Save (Ctrl+S) always writes the local library, and also the bound file
 *   when one was opened or chosen with "Save as file".
 * - The library entry remembers that file, so opening the file again saves
 *   into the same entry instead of adding another one.
 * - "Save as file" asks for a location (Chromium) or downloads a copy.
 * - Unsaved work is snapshotted to the recovery store and restored on reload.
 */
export class ProjectSession {
  private libraryId: string | null = null;
  private handle: FileHandleLike | null = null;
  private fileName: string | null = null;
  private recentId: string | null = null;
  private dirty = false;
  private recoveryTimer: ReturnType<typeof setTimeout> | null = null;
  /** Bumped per snapshot and on clearing: a slow older snapshot must not land last. */
  private recoveryRun = 0;
  private readonly recoveryKey: string;
  private readonly encoder = new TextEncoder();
  private readonly decoder = new TextDecoder();

  constructor(private readonly options: ProjectSessionOptions) {
    this.recoveryKey = `${options.app}:session`;
  }

  get state(): SessionState {
    return {
      libraryId: this.libraryId,
      fileName: this.fileName,
      hasFileHandle: this.handle !== null,
      dirty: this.dirty,
      storageKind: this.options.storage.kind,
    };
  }

  get storage(): Storage {
    return this.options.storage;
  }

  // ------------------------------------------------------------------ identity

  /** Starts a fresh, unsaved project. */
  resetIdentity(): void {
    this.libraryId = null;
    this.handle = null;
    this.fileName = null;
    this.recentId = null;
    this.dirty = false;
    void this.clearRecovery();
    this.changed();
  }

  /**
   * Unbinds the open project from its file and library entry, keeping its
   * contents (for "Save a copy": the next save creates a new entry).
   */
  detachForCopy(): void {
    this.libraryId = null;
    this.handle = null;
    this.fileName = null;
    this.recentId = null;
    this.changed();
  }

  markDirty(): void {
    if (!this.dirty) {
      this.dirty = true;
      this.changed();
    }
    this.scheduleRecovery();
  }

  /** Re-renders the title, e.g. after the project was renamed. */
  refresh(): void {
    this.changed();
  }

  // ------------------------------------------------------------------ saving

  /** Saves to the library and, when bound, to the file. */
  async save(): Promise<void> {
    const json = this.options.serialize();
    await this.saveToLibrary(json);
    if (this.handle) {
      if (!(await ensurePermission(this.handle, "readwrite"))) {
        throw new Error("Permission to write the file was denied.");
      }
      await writeFileHandle(this.handle, await this.encode(json));
      await this.touchRecent(this.handle);
    }
    this.dirty = false;
    await this.clearRecovery();
    this.changed();
  }

  /**
   * Saves to a file the user picks (and binds it), or downloads a copy where
   * the File System Access API is missing. Returns false if cancelled.
   */
  async saveAsFile(): Promise<boolean> {
    const json = this.options.serialize();
    const content = await this.encode(json);
    const suggested = `${this.options.getName()}${this.options.fileType.extensions[0] ?? ".json"}`;
    let handle: FileHandleLike | null;
    try {
      handle = await pickFileToSave(suggested, [this.options.fileType]);
    } catch (error) {
      if (isAbortError(error)) return false;
      throw error;
    }
    if (handle) {
      await writeFileHandle(handle, content);
      this.handle = handle;
      this.fileName = handle.name;
      await this.touchRecent(handle);
    } else {
      const blob =
        typeof content === "string"
          ? new Blob([content], { type: this.options.fileType.mimeType })
          : content;
      downloadBlob(blob, suggested);
    }
    await this.saveToLibrary(json);
    this.dirty = false;
    await this.clearRecovery();
    this.changed();
    return true;
  }

  /** A work file's content (`encodeFile`, or JSON text). */
  private encode(json: unknown): Promise<Blob | string> {
    return this.options.encodeFile?.(json) ?? Promise.resolve(JSON.stringify(json));
  }

  /** Reads a work file (`decodeFile`, or JSON). */
  private async decode(file: File): Promise<unknown> {
    return this.options.decodeFile
      ? this.options.decodeFile(file)
      : (JSON.parse(await file.text()) as unknown);
  }

  private async saveToLibrary(json: unknown): Promise<void> {
    const { storage, app } = this.options;
    const now = Date.now();
    const id = this.libraryId ?? newId();
    const existing = this.libraryId ? await storage.projects.get(id) : null;
    const data = (await this.options.toStored?.(json)) ?? json;
    const record: ProjectRecord = {
      id,
      app,
      name: this.options.getName(),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      thumbnail: this.options.thumbnail?.(),
      data,
    };
    // Saved without its file, the entry goes its own way: the link is dropped.
    const file = this.handle;
    try {
      await storage.projects.put(file ? { ...record, file } : record);
    } catch (error) {
      if (!file) throw error;
      await storage.projects.put(record); // handles can't be stored everywhere
    }
    this.libraryId = id;
  }

  /**
   * The library entry that is this file's copy. One that is newer than the
   * file holds work the file doesn't (the file couldn't be written, or an
   * older version was put back), so it is left alone.
   */
  private async libraryCopyOf(handle: FileHandleLike): Promise<string | null> {
    try {
      for (const { id, file, updatedAt } of await this.listLibrary()) {
        if (!file || !(await handle.isSameEntry?.(file as FileHandleLike))) continue;
        const { lastModified } = await handle.getFile();
        return updatedAt <= lastModified + FILE_TIME_SLACK ? id : null;
      }
    } catch (error) {
      console.warn("Could not look up the file's copy in the library", error);
    }
    return null;
  }

  // ------------------------------------------------------------------ opening

  /** Lets the user pick a file. Call `adoptFile` once it loaded successfully. */
  async pickFile(): Promise<(OpenedProject & { handle: FileHandleLike | null }) | null> {
    const picked = await pickFileToOpen([this.options.fileType, ANY_JSON]);
    if (!picked) return null;
    const json = await this.decode(picked.file);
    return {
      json,
      name: stripFileExtension(picked.file.name, this.options.fileType),
      handle: picked.handle,
    };
  }

  /** Reads a file the OS handed to the installed app (see `ProjectFiles.bindLaunchQueue`). */
  async readHandle(handle: FileHandleLike): Promise<OpenedProject & { handle: FileHandleLike }> {
    const file = await handle.getFile();
    const json = await this.decode(file);
    return { json, name: stripFileExtension(file.name, this.options.fileType), handle };
  }

  /** Binds a successfully opened file (its handle, if any) as the save target. */
  async adoptFile(name: string, handle: FileHandleLike | null): Promise<void> {
    this.libraryId = null;
    this.handle = handle;
    this.fileName = handle?.name ?? name;
    this.recentId = null;
    this.dirty = false;
    if (handle) {
      const id = await this.libraryCopyOf(handle);
      // Unless something else was opened meanwhile.
      if (this.handle === handle) {
        this.libraryId = id;
        await this.touchRecent(handle);
      }
    }
    await this.clearRecovery();
    this.changed();
  }

  async openFromLibrary(id: string): Promise<OpenedProject | null> {
    const record = await this.options.storage.projects.get(id);
    if (!record) return null;
    const json = (await this.options.fromStored?.(record.data)) ?? record.data;
    return { json, name: record.name };
  }

  /** Call once a library project loaded successfully. */
  adoptLibrary(id: string): void {
    this.libraryId = id;
    this.handle = null;
    this.fileName = null;
    this.recentId = null;
    this.dirty = false;
    void this.clearRecovery();
    this.changed();
  }

  /** Reads a recent file (asking for permission again if needed; needs a user gesture). */
  async openRecent(id: string): Promise<(OpenedProject & { handle: FileHandleLike }) | null> {
    const records = await this.options.storage.recentFiles.list(this.options.app);
    const record = records.find((r) => r.id === id);
    const handle = record?.handle as FileHandleLike | undefined;
    if (!record || !handle?.getFile) return null;
    if (!(await ensurePermission(handle, "read"))) return null;
    const file = await handle.getFile();
    return {
      json: await this.decode(file),
      name: stripFileExtension(file.name, this.options.fileType),
      handle,
    };
  }

  // ------------------------------------------------------------------ listings

  listLibrary(): Promise<ProjectMeta[]> {
    return this.options.storage.projects.list(this.options.app);
  }

  listRecent(): Promise<RecentFileRecord[]> {
    return this.options.storage.recentFiles.list(this.options.app);
  }

  async deleteFromLibrary(id: string): Promise<void> {
    await this.options.storage.projects.delete(id);
    if (this.libraryId === id) {
      this.libraryId = null;
      this.changed();
    }
  }

  removeRecent(id: string): Promise<void> {
    return this.options.storage.recentFiles.delete(id);
  }

  private async touchRecent(handle: FileHandleLike): Promise<void> {
    const id = `${this.options.app}:${handle.name}`;
    this.recentId = id;
    try {
      await this.options.storage.recentFiles.put({
        id,
        app: this.options.app,
        name: handle.name,
        openedAt: Date.now(),
        handle,
      });
    } catch (error) {
      // Handles can't be stored everywhere; recents are a convenience.
      console.warn("Could not remember recent file", error);
    }
  }

  // ------------------------------------------------------------------ recovery

  private scheduleRecovery(): void {
    if (this.recoveryTimer) clearTimeout(this.recoveryTimer);
    this.recoveryTimer = setTimeout(() => {
      this.recoveryTimer = null;
      void this.flushRecovery();
    }, this.options.recoveryDelay ?? 800);
  }

  async flushRecovery(): Promise<void> {
    const run = ++this.recoveryRun;
    try {
      const json = this.options.serialize();
      const snapshot: RecoverySnapshot = {
        libraryId: this.libraryId,
        fileName: this.fileName,
        recentId: this.recentId,
        data: (await this.options.toStored?.(json)) ?? json,
      };
      if (run !== this.recoveryRun) return;
      const bytes = this.encoder.encode(JSON.stringify(snapshot));
      await this.options.storage.recovery.saveRecovery(this.recoveryKey, bytes);
    } catch (error) {
      console.warn("Recovery snapshot failed", error);
    }
  }

  /**
   * Returns unsaved work from a previous session (still marked dirty after
   * `adoptRecovered`), or `null` when there is none.
   */
  async loadRecovery(): Promise<(OpenedProject & { snapshot: RecoverySnapshot }) | null> {
    try {
      const bytes = await this.options.storage.recovery.loadRecovery(this.recoveryKey);
      if (!bytes) return null;
      const snapshot = JSON.parse(this.decoder.decode(bytes)) as RecoverySnapshot;
      const json = (await this.options.fromStored?.(snapshot.data)) ?? snapshot.data;
      return { json, name: snapshot.fileName ?? "recovered", snapshot };
    } catch (error) {
      console.warn("Ignoring unreadable recovery snapshot", error);
      return null;
    }
  }

  /** Restores the identity (library entry, bound file) of recovered work. */
  async adoptRecovered(snapshot: RecoverySnapshot): Promise<void> {
    this.libraryId = snapshot.libraryId;
    this.fileName = snapshot.fileName;
    this.recentId = snapshot.recentId;
    this.handle = null;
    if (snapshot.recentId) {
      const recent = (await this.listRecent()).find((r) => r.id === snapshot.recentId);
      this.handle = (recent?.handle as FileHandleLike | undefined) ?? null;
    }
    this.dirty = true;
    this.changed();
  }

  async clearRecovery(): Promise<void> {
    this.recoveryRun++;
    if (this.recoveryTimer) clearTimeout(this.recoveryTimer);
    this.recoveryTimer = null;
    try {
      await this.options.storage.recovery.clearRecovery(this.recoveryKey);
    } catch (error) {
      console.warn("Could not clear recovery snapshot", error);
    }
  }

  // ------------------------------------------------------------------ window

  /** Warns before closing the tab with unsaved changes. Returns a disposer. */
  installUnloadGuard(): () => void {
    const handler = (ev: BeforeUnloadEvent) => {
      if (!this.dirty) return;
      ev.preventDefault();
      // Legacy browsers need a returnValue to show the prompt.
      ev.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }

  private changed(): void {
    if (typeof document !== "undefined") {
      document.title = `${this.dirty ? "• " : ""}${this.options.getName()} — ${this.options.titleSuffix}`;
    }
    this.options.onChange?.(this.state);
  }
}

const ANY_JSON: FileTypeSpec = {
  description: "JSON",
  mimeType: "application/json",
  extensions: [".json"],
};
