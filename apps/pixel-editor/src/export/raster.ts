import { compositeRgba } from "@foundry2d/core";
import { type RgbaImage } from "@foundry2d/atlas";
import type { Frame } from "../model/Sprite";

export {
  blit,
  createImage,
  cropImage,
  flattenOnto,
  opaqueBounds,
  parseHexColor,
  scaleImage,
  type Rect,
  type RgbaImage,
} from "@foundry2d/atlas";

/**
 * Composites a frame in software (see core `compositeRgba`). With `layerId`,
 * only that layer is exported, at full opacity.
 */
export function compositeFrame(frame: Frame, layerId?: string): RgbaImage {
  const { width, height } = frame.doc;
  return { width, height, data: compositeRgba(frame.doc, layerId) };
}
