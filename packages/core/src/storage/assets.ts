import { bytesToDataUrl, dataUrlToBytes } from "./hash";
import type { AssetStore, Storage } from "./types";

/**
 * Library and recovery copies keep images in the asset store and reference
 * them as `asset:<hash>`, so an image is stored once however many projects
 * and snapshots use it. The store is shared by every app on the same origin.
 */
export const ASSET_PREFIX = "asset:";

export const isAssetRef = (value: unknown): value is string =>
  typeof value === "string" && value.startsWith(ASSET_PREFIX);

/** Moves a data URL's bytes to the asset store and returns its reference. */
export async function storeDataUrl(dataUrl: string, assets: AssetStore): Promise<string> {
  const { type, bytes } = dataUrlToBytes(dataUrl);
  return `${ASSET_PREFIX}${await assets.put(bytes, type)}`;
}

/** The data URL behind an asset reference, or `null` when it is gone. */
export async function loadDataUrl(ref: string, assets: AssetStore): Promise<string | null> {
  const record = await assets.get(ref.slice(ASSET_PREFIX.length));
  return record && bytesToDataUrl(record.bytes, record.type);
}

/** Hashes of every asset referenced anywhere in a stored project, whatever app wrote it. */
export function collectAssetRefs(json: unknown): string[] {
  const found = new Set<string>();
  const stack: unknown[] = [json];
  while (stack.length) {
    const value = stack.pop();
    if (isAssetRef(value)) found.add(value.slice(ASSET_PREFIX.length));
    else if (typeof value === "object" && value !== null) {
      // Cell data is long lists of numbers: no need to look at each.
      if (Array.isArray(value) && typeof value[0] === "number") continue;
      for (const child of Object.values(value)) stack.push(child);
    }
  }
  return [...found];
}

/**
 * Deletes assets that no saved project and no recovery snapshot of any app
 * references. Returns how many were removed.
 */
export async function pruneUnusedAssets(storage: Storage): Promise<number> {
  const keep = new Set<string>();
  for (const meta of await storage.projects.list()) {
    const record = await storage.projects.get(meta.id);
    for (const hash of collectAssetRefs(record?.data)) keep.add(hash);
  }
  for (const key of await storage.recovery.listRecovery()) {
    const bytes = await storage.recovery.loadRecovery(key);
    if (!bytes) continue;
    try {
      const snapshot: unknown = JSON.parse(new TextDecoder().decode(bytes));
      for (const hash of collectAssetRefs(snapshot)) keep.add(hash);
    } catch {
      // Not JSON: no app can restore it either.
    }
  }
  return storage.assets.prune(keep);
}
