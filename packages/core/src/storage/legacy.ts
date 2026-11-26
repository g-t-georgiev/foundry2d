import { openDB, type IDBPDatabase } from "idb";
import type { AssetRecord, Gs2dDBSchema, ProjectRecord, RecentFileRecord } from "./types";

/**
 * Moving to Game Studio 2D (roadmap item 48): the browser database was
 * called "foundry2d", and two apps had other ids ("level", "pack"). Its
 * content is copied into the new database once, with the new ids; the old
 * database is left in place as a safety copy.
 */
export const LEGACY_DB_NAME = "foundry2d";

const LEGACY_APP_IDS: Readonly<Record<string, string>> = { level: "levels", pack: "packer" };

/** An app id from before Game Studio 2D, as it is now. */
export const currentAppId = (app: string) => LEGACY_APP_IDS[app] ?? app;

/** Everything a database holds. */
export interface DatabaseContents {
  recovery: [key: string, data: Uint8Array][];
  projects: ProjectRecord[];
  assets: AssetRecord[];
  recentFiles: RecentFileRecord[];
}

/** "level:session" → "levels:session"; recent file ids carry the app the same way. */
const renameKey = (key: string) => {
  const at = key.indexOf(":");
  return at < 0 ? key : `${currentAppId(key.slice(0, at))}${key.slice(at)}`;
};

/** The old database's content with today's app ids. */
export function renameLegacyContents(old: DatabaseContents): DatabaseContents {
  return {
    recovery: old.recovery.map(([key, data]) => [renameKey(key), data]),
    projects: old.projects.map((p) => ({ ...p, app: currentAppId(p.app) })),
    assets: old.assets,
    recentFiles: old.recentFiles.map((r) => ({
      ...r,
      id: renameKey(r.id),
      app: currentAppId(r.app),
    })),
  };
}

/**
 * Copies the old database into `target` the first time Game Studio 2D opens
 * it. Returns whether anything was copied. Never throws: the apps work
 * without the old content.
 */
export async function migrateLegacyDatabase(target: IDBPDatabase<Gs2dDBSchema>): Promise<boolean> {
  try {
    if (await target.get("meta", "migrated")) return false;
    const names = (await indexedDB.databases?.())?.map((d) => d.name) ?? [];
    let copied = false;
    if (names.includes(LEGACY_DB_NAME)) {
      // No version: the old database opens as it is, never upgraded or created.
      const legacy = await openDB(LEGACY_DB_NAME);
      try {
        const has = (store: string) => legacy.objectStoreNames.contains(store);
        const all = async <T>(store: string): Promise<T[]> =>
          has(store) ? ((await legacy.getAll(store)) as T[]) : [];
        const recoveryKeys = has("recovery") ? await legacy.getAllKeys("recovery") : [];
        const recoveryValues = await all<Uint8Array>("recovery");
        const contents = renameLegacyContents({
          recovery: recoveryKeys.map((key, i) => [key as string, recoveryValues[i]]),
          projects: await all<ProjectRecord>("projects"),
          assets: await all<AssetRecord>("assets"),
          recentFiles: await all<RecentFileRecord>("recentFiles"),
        });
        const tx = target.transaction(
          ["recovery", "projects", "assets", "recentFiles", "meta"],
          "readwrite"
        );
        for (const [key, data] of contents.recovery) void tx.objectStore("recovery").put(data, key);
        for (const p of contents.projects) void tx.objectStore("projects").put(p);
        for (const a of contents.assets) void tx.objectStore("assets").put(a);
        for (const r of contents.recentFiles) void tx.objectStore("recentFiles").put(r);
        void tx.objectStore("meta").put({ from: LEGACY_DB_NAME, at: Date.now() }, "migrated");
        await tx.done;
        copied = true;
      } finally {
        legacy.close();
      }
    } else {
      await target.put("meta", { from: null, at: Date.now() }, "migrated");
    }
    return copied;
  } catch (error) {
    console.warn("Could not copy the old foundry2d storage", error);
    return false;
  }
}
