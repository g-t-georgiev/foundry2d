import type { IDBPDatabase } from "idb";
import type { RecoveryDBSchema, StorageDriver } from "./types";
import { openDB } from "idb";

export class IndexedDBStorageDriver implements StorageDriver {
  private dbPromise: Promise<IDBPDatabase<RecoveryDBSchema>>;

  constructor(dbName = "spatial_suite_db") {
    this.dbPromise = openDB(dbName, 1, {
      upgrade(db) {
        db.createObjectStore("recovery");
      },
    });
  }

  async saveRecovery(key: string, data: Uint8Array): Promise<void> {
    const db = await this.dbPromise;
    await db.put("recovery", data, key);
  }

  async loadRecovery(key: string): Promise<Uint8Array | null> {
    const db = await this.dbPromise;
    return (await db.get("recovery", key)) || null;
  }

  async clearRecovery(key: string): Promise<void> {
    const db = await this.dbPromise;
    await db.delete("recovery", key);
  }
}
