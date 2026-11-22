import { isImagePath, isSpritePath, type ImportFile } from "./images";

/** The parts of `FileSystemDirectoryHandle` used (not all of it is in lib.dom yet). */
export interface DirectoryLike {
  readonly kind: "directory";
  readonly name: string;
  values(): AsyncIterable<DirectoryLike | { kind: "file"; name: string; getFile(): Promise<File> }>;
}

interface PickerWindow {
  showDirectoryPicker?(): Promise<DirectoryLike>;
}

export const supportsLiveFolders = () => "showDirectoryPicker" in window;

/** Asks for a folder to watch; `null` when cancelled. */
export async function pickLiveFolder(): Promise<DirectoryLike | null> {
  try {
    return (await (window as PickerWindow).showDirectoryPicker?.()) ?? null;
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return null;
    throw error;
  }
}

export interface FolderChanges {
  /** New and changed images and sprites, under the folder's name. */
  changed: ImportFile[];
  /** Paths that are gone. */
  removed: string[];
}

/**
 * A folder kept in sync: each `scan` reports what changed since the last
 * one, by file date and size. Data files aren't watched (an atlas belongs to
 * two files that change one after the other).
 */
export class LiveFolder {
  private stamps = new Map<string, string>();

  constructor(private readonly handle: DirectoryLike) {}

  get name(): string {
    return this.handle.name;
  }

  async scan(): Promise<FolderChanges> {
    const stamps = new Map<string, string>();
    const changed: ImportFile[] = [];
    const walk = async (folder: DirectoryLike, prefix: string): Promise<void> => {
      for await (const entry of folder.values()) {
        const path = `${prefix}/${entry.name}`;
        if (entry.kind === "directory") {
          await walk(entry, path);
        } else if (isImagePath(path) || isSpritePath(path)) {
          const file = await entry.getFile();
          const stamp = `${file.lastModified}:${file.size}`;
          stamps.set(path, stamp);
          if (this.stamps.get(path) !== stamp) changed.push({ file, path });
        }
      }
    };
    await walk(this.handle, this.handle.name);
    const removed = [...this.stamps.keys()].filter((path) => !stamps.has(path));
    this.stamps = stamps;
    return { changed, removed };
  }
}
