import { isAssetRef, loadDataUrl, storeDataUrl, type AssetStore } from "@gs2d/core";
import { PackFormatError } from "./packFile";

/*
 * Library and recovery copies of a pack keep their images in the shared
 * asset store, so autosaving doesn't write every image again. Files on disk
 * always embed them.
 */

const spritesOf = (json: unknown): { image?: unknown }[] => {
  const sprites = (json as { sprites?: unknown } | null)?.sprites;
  return Array.isArray(sprites) ? (sprites as { image?: unknown }[]) : [];
};

/** A copy of `json` with embedded images moved to `assets`. */
export async function externalizeSprites(json: unknown, assets: AssetStore): Promise<unknown> {
  const copy = structuredClone(json);
  for (const sprite of spritesOf(copy)) {
    if (typeof sprite.image !== "string" || !sprite.image.startsWith("data:")) continue;
    sprite.image = await storeDataUrl(sprite.image, assets);
  }
  return copy;
}

/** A copy of `json` with asset references replaced by data URLs. */
export async function internalizeSprites(json: unknown, assets: AssetStore): Promise<unknown> {
  const copy = structuredClone(json);
  for (const sprite of spritesOf(copy)) {
    if (!isAssetRef(sprite.image)) continue;
    const dataUrl = await loadDataUrl(sprite.image, assets);
    if (dataUrl === null) throw new PackFormatError("A sprite is missing from browser storage.");
    sprite.image = dataUrl;
  }
  return copy;
}
