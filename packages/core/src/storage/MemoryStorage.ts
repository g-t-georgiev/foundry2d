import { sha256Hex } from "./hash";
import type { AssetRecord, ProjectMeta, ProjectRecord, RecentFileRecord, Storage } from "./types";

const byUpdated = (a: ProjectMeta, b: ProjectMeta) => b.updatedAt - a.updatedAt;
const metaOf = ({ data: _data, ...meta }: ProjectRecord): ProjectMeta => meta;
const done = (): Promise<void> => Promise.resolve();

/**
 * In-memory `Storage`: used in tests and as a fallback when IndexedDB is
 * unavailable (some private-browsing modes). Nothing survives a reload.
 * Values are copied in and out, like IndexedDB's structured clone.
 */
export class MemoryStorage implements Storage {
  readonly kind = "memory" as const;
  private readonly recoveryMap = new Map<string, Uint8Array>();
  private readonly projectMap = new Map<string, ProjectRecord>();
  private readonly assetMap = new Map<string, AssetRecord>();
  private readonly recentMap = new Map<string, RecentFileRecord>();

  readonly recovery = {
    saveRecovery: (key: string, data: Uint8Array): Promise<void> => {
      this.recoveryMap.set(key, data.slice());
      return done();
    },
    loadRecovery: (key: string): Promise<Uint8Array | null> =>
      Promise.resolve(this.recoveryMap.get(key)?.slice() ?? null),
    clearRecovery: (key: string): Promise<void> => {
      this.recoveryMap.delete(key);
      return done();
    },
  };

  readonly projects = {
    list: (app?: string): Promise<ProjectMeta[]> =>
      Promise.resolve(
        [...this.projectMap.values()]
          .filter((p) => app === undefined || p.app === app)
          .map(metaOf)
          .sort(byUpdated)
      ),
    get: (id: string): Promise<ProjectRecord | null> => {
      const record = this.projectMap.get(id);
      return Promise.resolve(record ? structuredClone(record) : null);
    },
    put: (record: ProjectRecord): Promise<void> => {
      this.projectMap.set(record.id, structuredClone(record));
      return done();
    },
    delete: (id: string): Promise<void> => {
      this.projectMap.delete(id);
      return done();
    },
  };

  readonly assets = {
    put: async (bytes: Uint8Array, type: string): Promise<string> => {
      const hash = await sha256Hex(bytes);
      if (!this.assetMap.has(hash)) this.assetMap.set(hash, { hash, type, bytes: bytes.slice() });
      return hash;
    },
    get: (hash: string): Promise<AssetRecord | null> => {
      const record = this.assetMap.get(hash);
      return Promise.resolve(record ? { ...record, bytes: record.bytes.slice() } : null);
    },
    has: (hash: string): Promise<boolean> => Promise.resolve(this.assetMap.has(hash)),
    delete: (hash: string): Promise<void> => {
      this.assetMap.delete(hash);
      return done();
    },
    prune: (keep: Iterable<string>): Promise<number> => {
      const keepSet = new Set(keep);
      let removed = 0;
      for (const hash of Array.from(this.assetMap.keys())) {
        if (!keepSet.has(hash)) {
          this.assetMap.delete(hash);
          removed++;
        }
      }
      return Promise.resolve(removed);
    },
  };

  readonly recentFiles = {
    list: (app?: string): Promise<RecentFileRecord[]> =>
      Promise.resolve(
        [...this.recentMap.values()]
          .filter((r) => app === undefined || r.app === app)
          .sort((a, b) => b.openedAt - a.openedAt)
      ),
    put: (record: RecentFileRecord): Promise<void> => {
      this.recentMap.set(record.id, { ...record });
      return done();
    },
    delete: (id: string): Promise<void> => {
      this.recentMap.delete(id);
      return done();
    },
  };
}
