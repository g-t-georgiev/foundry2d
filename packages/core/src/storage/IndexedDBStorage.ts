import { openDB, type IDBPDatabase } from "idb";
import { sha256Hex } from "./hash";
import type {
  FoundryDBSchema,
  ProjectMeta,
  ProjectRecord,
  RecentFileRecord,
  Storage,
} from "./types";

export const FOUNDRY_DB_NAME = "foundry2d";
/**
 * v1: `recovery`
 * v2: `projects` (index `app`), `assets`, `recentFiles` (index `app`)
 */
export const FOUNDRY_DB_VERSION = 2;

const metaOf = ({ data: _data, ...meta }: ProjectRecord): ProjectMeta => meta;

/** Creates or migrates the object stores, one step per version. */
function upgradeFoundryDB(db: IDBPDatabase<FoundryDBSchema>, oldVersion: number): void {
  if (oldVersion < 1) db.createObjectStore("recovery");
  if (oldVersion < 2) {
    db.createObjectStore("projects", { keyPath: "id" }).createIndex("app", "app");
    db.createObjectStore("assets", { keyPath: "hash" });
    db.createObjectStore("recentFiles", { keyPath: "id" }).createIndex("app", "app");
  }
}

/** `Storage` backed by one IndexedDB database. */
export class IndexedDBStorage implements Storage {
  readonly kind = "indexeddb" as const;
  private readonly db: Promise<IDBPDatabase<FoundryDBSchema>>;

  constructor(name = FOUNDRY_DB_NAME) {
    this.db = openDB<FoundryDBSchema>(name, FOUNDRY_DB_VERSION, { upgrade: upgradeFoundryDB });
  }

  /** Resolves `true` if the database can be opened (fails in some private modes). */
  static async isAvailable(name = FOUNDRY_DB_NAME): Promise<boolean> {
    if (typeof indexedDB === "undefined") return false;
    // Open the real database (creating or upgrading it), rather than a probe
    // database that would be left behind.
    try {
      const db = await openDB<FoundryDBSchema>(name, FOUNDRY_DB_VERSION, {
        upgrade: upgradeFoundryDB,
      });
      db.close();
      return true;
    } catch {
      return false;
    }
  }

  readonly recovery = {
    saveRecovery: async (key: string, data: Uint8Array) => {
      await (await this.db).put("recovery", data, key);
    },
    loadRecovery: async (key: string) => (await (await this.db).get("recovery", key)) ?? null,
    clearRecovery: async (key: string) => {
      await (await this.db).delete("recovery", key);
    },
    listRecovery: async () => (await this.db).getAllKeys("recovery"),
  };

  readonly projects = {
    list: async (app?: string) => {
      const db = await this.db;
      const records =
        app === undefined
          ? await db.getAll("projects")
          : await db.getAllFromIndex("projects", "app", app);
      return records.map(metaOf).sort((a, b) => b.updatedAt - a.updatedAt);
    },
    get: async (id: string) => (await (await this.db).get("projects", id)) ?? null,
    put: async (record: ProjectRecord) => {
      await (await this.db).put("projects", record);
    },
    delete: async (id: string) => {
      await (await this.db).delete("projects", id);
    },
  };

  readonly assets = {
    put: async (bytes: Uint8Array, type: string) => {
      const hash = await sha256Hex(bytes);
      const db = await this.db;
      if ((await db.getKey("assets", hash)) === undefined) {
        await db.put("assets", { hash, type, bytes });
      }
      return hash;
    },
    get: async (hash: string) => (await (await this.db).get("assets", hash)) ?? null,
    has: async (hash: string) => (await (await this.db).getKey("assets", hash)) !== undefined,
    delete: async (hash: string) => {
      await (await this.db).delete("assets", hash);
    },
    prune: async (keep: Iterable<string>) => {
      const keepSet = new Set(keep);
      const db = await this.db;
      let removed = 0;
      for (const hash of await db.getAllKeys("assets")) {
        if (!keepSet.has(hash)) {
          await db.delete("assets", hash);
          removed++;
        }
      }
      return removed;
    },
  };

  readonly recentFiles = {
    list: async (app?: string) => {
      const db = await this.db;
      const records =
        app === undefined
          ? await db.getAll("recentFiles")
          : await db.getAllFromIndex("recentFiles", "app", app);
      return records.sort((a, b) => b.openedAt - a.openedAt);
    },
    put: async (record: RecentFileRecord) => {
      await (await this.db).put("recentFiles", record);
    },
    delete: async (id: string) => {
      await (await this.db).delete("recentFiles", id);
    },
  };
}

/**
 * Opens the editors' storage: IndexedDB when available, otherwise an
 * in-memory fallback (check `storage.kind` to warn the user).
 */
export async function openStorage(): Promise<Storage> {
  if (await IndexedDBStorage.isAvailable()) return new IndexedDBStorage();
  const { MemoryStorage } = await import("./MemoryStorage");
  return new MemoryStorage();
}

/** @deprecated Recovery-only driver; use `IndexedDBStorage#recovery`. */
export class IndexedDBStorageDriver {
  private readonly storage: IndexedDBStorage;

  constructor(name = FOUNDRY_DB_NAME) {
    this.storage = new IndexedDBStorage(name);
  }

  saveRecovery(key: string, data: Uint8Array): Promise<void> {
    return this.storage.recovery.saveRecovery(key, data);
  }

  loadRecovery(key: string): Promise<Uint8Array | null> {
    return this.storage.recovery.loadRecovery(key);
  }

  clearRecovery(key: string): Promise<void> {
    return this.storage.recovery.clearRecovery(key);
  }

  listRecovery(): Promise<string[]> {
    return this.storage.recovery.listRecovery();
  }
}
