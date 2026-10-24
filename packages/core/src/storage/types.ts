import type { DBSchema } from "idb";

export interface StorageDriver {
  saveRecovery(key: string, data: Uint8Array): Promise<void>;
  loadRecovery(key: string): Promise<Uint8Array | null>;
  clearRecovery(key: string): Promise<void>;
}

export interface RecoveryDBSchema extends DBSchema {
  recovery: {
    key: string;
    value: Uint8Array;
  };
}
