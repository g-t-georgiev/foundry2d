import { isAssetRef, loadDataUrl, storeDataUrl, type AssetStore } from "@gs2d/core";
import { ProjectFormatError } from "./projectFile";

/*
 * Library and recovery copies of a project keep tileset images in the asset
 * store (see core `storeDataUrl`). Files written to disk always embed the
 * image again (`internalizeAssets`).
 */

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
    tileset.image!.dataUrl = await storeDataUrl(url, assets);
  }
  return copy;
}

/** Returns a copy of `json` with `asset:` references replaced by data URLs. */
export async function internalizeAssets(json: unknown, assets: AssetStore): Promise<unknown> {
  const copy = structuredClone(json);
  for (const tileset of tilesetsOf(copy)) {
    const url = tileset.image?.dataUrl;
    if (!isAssetRef(url)) continue;
    const dataUrl = await loadDataUrl(url, assets);
    if (dataUrl === null) {
      throw new ProjectFormatError("A tileset image is missing from browser storage.");
    }
    tileset.image!.dataUrl = dataUrl;
  }
  return copy;
}
