import type { DBSchema } from "idb";

/** Crash-recovery snapshots: one opaque byte blob per key. */
export interface RecoveryStore {
  saveRecovery(key: string, data: Uint8Array): Promise<void>;
  loadRecovery(key: string): Promise<Uint8Array | null>;
  clearRecovery(key: string): Promise<void>;
}

/** @deprecated Use `RecoveryStore`. Kept for existing imports. */
export type StorageDriver = RecoveryStore;

/** Summary of a project saved in the local library (no payload). */
export interface ProjectMeta {
  id: string;
  /** Which editor owns the project, e.g. "pixel" or "level". */
  app: string;
  name: string;
  createdAt: number;
  updatedAt: number;
  /** Small preview image as a data URL. */
  thumbnail?: string;
}

/** A library project: metadata plus the app's JSON payload. */
export interface ProjectRecord extends ProjectMeta {
  data: unknown;
}

/** The local project library. */
export interface ProjectStore {
  /** Projects of one app (or all), most recently updated first. */
  list(app?: string): Promise<ProjectMeta[]>;
  get(id: string): Promise<ProjectRecord | null>;
  put(record: ProjectRecord): Promise<void>;
  delete(id: string): Promise<void>;
}

export interface AssetRecord {
  /** SHA-256 of the bytes, hex encoded. */
  hash: string;
  /** MIME type, e.g. "image/png". */
  type: string;
  bytes: Uint8Array;
}

/**
 * Content-addressed binary assets (tileset images, …). Identical bytes are
 * stored once, so many projects can share them.
 */
export interface AssetStore {
  /** Stores bytes and returns their hash (a no-op if already present). */
  put(bytes: Uint8Array, type: string): Promise<string>;
  get(hash: string): Promise<AssetRecord | null>;
  has(hash: string): Promise<boolean>;
  delete(hash: string): Promise<void>;
  /** Removes every asset whose hash is not in `keep`. Returns how many were removed. */
  prune(keep: Iterable<string>): Promise<number>;
}

/** A file opened or saved through the File System Access API. */
export interface RecentFileRecord {
  id: string;
  app: string;
  name: string;
  openedAt: number;
  /** A `FileSystemFileHandle`; IndexedDB can store it, memory storage keeps it as-is. */
  handle: unknown;
}

export interface RecentFilesStore {
  list(app?: string): Promise<RecentFileRecord[]>;
  put(record: RecentFileRecord): Promise<void>;
  delete(id: string): Promise<void>;
}

/** Everything the editors persist in the browser. */
export interface Storage {
  /** "indexeddb" or "memory" (data is lost on reload). */
  readonly kind: "indexeddb" | "memory";
  readonly recovery: RecoveryStore;
  readonly projects: ProjectStore;
  readonly assets: AssetStore;
  readonly recentFiles: RecentFilesStore;
}

export interface FoundryDBSchema extends DBSchema {
  recovery: { key: string; value: Uint8Array };
  projects: { key: string; value: ProjectRecord; indexes: { app: string } };
  assets: { key: string; value: AssetRecord };
  recentFiles: { key: string; value: RecentFileRecord; indexes: { app: string } };
}

/** @deprecated Use `FoundryDBSchema`. */
export type RecoveryDBSchema = Pick<FoundryDBSchema, "recovery">;
