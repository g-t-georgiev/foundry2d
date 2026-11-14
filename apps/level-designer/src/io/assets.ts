import { bytesToDataUrl, dataUrlToBytes, type AssetStore } from "@foundry2d/core";
import { ProjectFormatError } from "./projectFile";

/**
 * Library and recovery copies of a project keep tileset images in the asset
 * store and reference them as `asset:<sha256>`, so large images are stored
 * once however many projects or snapshots use them. Files written to disk
 * always embed the image again (`internalizeAssets`).
 */
export const ASSET_PREFIX = "asset:";

interface TilesetLike {
  image?: { dataUrl?: unknown };
}

const tilesetsOf = (json: unknown): TilesetLike[] => {
  if (typeof json !== "object" || json === null) return [];
  const defs = (json as { defs?: { tilesets?: unknown } }).defs;
  return Array.isArray(defs?.tilesets) ? (defs.tilesets as TilesetLike[]) : [];
};

/** Returns a copy of `json` with embedded tileset images moved to `assets`. */
export async function externalizeAssets(json: unknown, assets: AssetStore): Promise<unknown> {
  const copy = structuredClone(json);
  for (const tileset of tilesetsOf(copy)) {
    const url = tileset.image?.dataUrl;
    if (typeof url !== "string" || !url.startsWith("data:")) continue;
    const { type, bytes } = dataUrlToBytes(url);
    tileset.image!.dataUrl = `${ASSET_PREFIX}${await assets.put(bytes, type)}`;
  }
  return copy;
}

/** Returns a copy of `json` with `asset:` references replaced by data URLs. */
export async function internalizeAssets(json: unknown, assets: AssetStore): Promise<unknown> {
  const copy = structuredClone(json);
  for (const tileset of tilesetsOf(copy)) {
    const url = tileset.image?.dataUrl;
    if (typeof url !== "string" || !url.startsWith(ASSET_PREFIX)) continue;
    const record = await assets.get(url.slice(ASSET_PREFIX.length));
    if (!record) {
      throw new ProjectFormatError("A tileset image is missing from browser storage.");
    }
    tileset.image!.dataUrl = bytesToDataUrl(record.bytes, record.type);
  }
  return copy;
}

/** Asset hashes referenced by a stored project. */
export function collectAssetRefs(json: unknown): string[] {
  return tilesetsOf(json)
    .map((t) => t.image?.dataUrl)
    .filter((url): url is string => typeof url === "string" && url.startsWith(ASSET_PREFIX))
    .map((url) => url.slice(ASSET_PREFIX.length));
}
