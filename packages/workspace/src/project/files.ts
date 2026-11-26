/**
 * File open/save with the File System Access API where available (Chromium),
 * falling back to an `<input type=file>` and a download link elsewhere.
 */

export interface FileTypeSpec {
  description: string;
  mimeType: string;
  /** Extensions including the dot, e.g. [".gs2dsprite"]. The first one is used when saving. */
  extensions: string[];
  /** Older extensions that still open (never written), e.g. [".f2d.json"]. */
  legacyExtensions?: string[];
}

/** The file name without any of the type's extensions (or a plain `.json`). */
export function stripFileExtension(name: string, type: FileTypeSpec): string {
  const known = [...type.extensions, ...(type.legacyExtensions ?? []), ".json"].sort(
    (a, b) => b.length - a.length
  );
  const lower = name.toLowerCase();
  const match = known.find((ext) => lower.endsWith(ext.toLowerCase()));
  return match ? name.slice(0, -match.length) : name;
}

/** The subset of `FileSystemFileHandle` we rely on (not all of it is in lib.dom yet). */
export interface FileHandleLike {
  readonly kind: "file";
  readonly name: string;
  getFile(): Promise<File>;
  isSameEntry?(other: FileHandleLike): Promise<boolean>;
  createWritable(): Promise<{ write(data: Blob | string): Promise<void>; close(): Promise<void> }>;
  queryPermission?(options: { mode: "read" | "readwrite" }): Promise<PermissionState>;
  requestPermission?(options: { mode: "read" | "readwrite" }): Promise<PermissionState>;
}

interface PickerAcceptType {
  description: string;
  accept: Record<string, string[]>;
}

interface FileSystemAccessWindow {
  showOpenFilePicker(options: {
    types?: PickerAcceptType[];
    multiple?: boolean;
    excludeAcceptAllOption?: boolean;
  }): Promise<FileHandleLike[]>;
  showSaveFilePicker(options: {
    suggestedName?: string;
    types?: PickerAcceptType[];
  }): Promise<FileHandleLike>;
}

const fsWindow = (): FileSystemAccessWindow | null =>
  typeof window !== "undefined" && "showOpenFilePicker" in window && "showSaveFilePicker" in window
    ? (window as unknown as FileSystemAccessWindow)
    : null;

export const supportsFileSystemAccess = (): boolean => fsWindow() !== null;

const isAbort = (error: unknown) => error instanceof DOMException && error.name === "AbortError";

const pickerTypes = (types: FileTypeSpec[]): PickerAcceptType[] =>
  types.map((t) => ({
    description: t.description,
    accept: { [t.mimeType]: [...t.extensions, ...(t.legacyExtensions ?? [])] },
  }));

/** Asks the user for a file. Resolves `null` when they cancel. */
export async function pickFileToOpen(
  types: FileTypeSpec[]
): Promise<{ file: File; handle: FileHandleLike | null } | null> {
  const fs = fsWindow();
  if (fs) {
    try {
      const [handle] = await fs.showOpenFilePicker({ types: pickerTypes(types) });
      return handle ? { file: await handle.getFile(), handle } : null;
    } catch (error) {
      if (isAbort(error)) return null;
      throw error;
    }
  }
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = types
      .flatMap((t) => [t.mimeType, ...t.extensions, ...(t.legacyExtensions ?? [])])
      .join(",");
    input.addEventListener("change", () =>
      resolve(input.files?.[0] ? { file: input.files[0], handle: null } : null)
    );
    input.addEventListener("cancel", () => resolve(null));
    input.click();
  });
}

/**
 * Asks where to save. Returns a handle (Chromium), or `null` when the API is
 * unavailable, in which case callers should `downloadBlob` instead.
 * Throws "AbortError" `DOMException` when the user cancels.
 */
export async function pickFileToSave(
  suggestedName: string,
  types: FileTypeSpec[]
): Promise<FileHandleLike | null> {
  const fs = fsWindow();
  if (!fs) return null;
  return fs.showSaveFilePicker({ suggestedName, types: pickerTypes(types) });
}

export async function writeFileHandle(handle: FileHandleLike, data: Blob | string): Promise<void> {
  const writable = await handle.createWritable();
  await writable.write(data);
  await writable.close();
}

/** Makes sure we may use a stored handle; prompts when needed (needs a user gesture). */
export async function ensurePermission(
  handle: FileHandleLike,
  mode: "read" | "readwrite"
): Promise<boolean> {
  if (!handle.queryPermission || !handle.requestPermission) return true;
  if ((await handle.queryPermission({ mode })) === "granted") return true;
  return (await handle.requestPermission({ mode })) === "granted";
}

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export { isAbort as isAbortError };
