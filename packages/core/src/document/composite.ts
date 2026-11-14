import type { GridDocument, GridLayer } from "./index";

/**
 * Bytes of an RGBA pixel layer (0xAABBGGRR words are RGBA bytes on
 * little-endian hosts; apps call `assertPixelByteOrder()` at startup).
 */
function layerBytes(layer: GridLayer<Uint32Array>): Uint8Array {
  return new Uint8Array(layer.data.buffer, layer.data.byteOffset, layer.data.byteLength);
}

/**
 * Composites an RGBA document into straight (non-premultiplied) RGBA bytes,
 * "source over", honouring visibility and layer opacity. With `layerId`,
 * only that layer is returned, at full opacity.
 *
 * Done in software rather than on a canvas so results are exact (no colour
 * management or premultiplication rounding) and work outside the browser.
 */
export function compositeRgba(doc: GridDocument<Uint32Array>, layerId?: string): Uint8ClampedArray {
  const dst = new Uint8ClampedArray(doc.width * doc.height * 4);
  const sources = layerId
    ? doc.layers.filter((l) => l.id === layerId).map((l) => ({ layer: l, opacity: 1 }))
    : doc.layers
        .filter((l) => l.visible && l.opacity > 0)
        .map((l) => ({ layer: l, opacity: l.opacity }));

  for (const { layer, opacity } of sources) {
    const src = layerBytes(layer);
    for (let i = 0; i < src.length; i += 4) {
      const sa = (src[i + 3] / 255) * opacity;
      if (sa <= 0) continue;
      const da = dst[i + 3] / 255;
      const oa = sa + da * (1 - sa);
      for (let c = 0; c < 3; c++) {
        dst[i + c] = Math.round((src[i + c] * sa + dst[i + c] * da * (1 - sa)) / oa);
      }
      dst[i + 3] = Math.round(oa * 255);
    }
  }
  return dst;
}
