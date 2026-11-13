import { GridDocument } from "./GridDocument";
import type { CellBuffer, CellBufferCtor } from "./types";

/**
 * Run-length encodes cell data as a flat `[count, value, count, value, ...]` array.
 * Compact for sparse tilemaps and pixel art, and still plain JSON.
 */
export function encodeRLE(data: ArrayLike<number>): number[] {
  const out: number[] = [];
  let i = 0;
  while (i < data.length) {
    const value = data[i];
    let run = 1;
    while (i + run < data.length && data[i + run] === value) run++;
    out.push(run, value);
    i += run;
  }
  return out;
}

export function decodeRLE<Buffer extends CellBuffer>(
  encoded: readonly number[],
  length: number,
  bufferCtor: CellBufferCtor<Buffer>
): Buffer {
  if (encoded.length % 2 !== 0) throw new Error("Malformed RLE data: odd number of entries");
  const out = new bufferCtor(length);
  let offset = 0;
  for (let i = 0; i < encoded.length; i += 2) {
    const run = encoded[i];
    const value = encoded[i + 1];
    if (offset + run > length) throw new Error("Malformed RLE data: exceeds target length");
    out.fill(value, offset, offset + run);
    offset += run;
  }
  if (offset !== length)
    throw new Error(`Malformed RLE data: expected ${length} cells, got ${offset}`);
  return out;
}

export interface SerializedLayer {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  /** RLE-encoded cells, see `encodeRLE`. */
  data: number[];
}

export interface SerializedDocument {
  width: number;
  height: number;
  emptyValue: number;
  activeLayerId: string | null;
  layers: SerializedLayer[];
}

export function serializeDocument<Buffer extends CellBuffer>(
  doc: GridDocument<Buffer>
): SerializedDocument {
  return {
    width: doc.width,
    height: doc.height,
    emptyValue: doc.emptyValue,
    activeLayerId: doc.activeLayerId,
    layers: doc.layers.map((layer) => ({
      id: layer.id,
      name: layer.name,
      visible: layer.visible,
      locked: layer.locked,
      opacity: layer.opacity,
      data: encodeRLE(layer.data),
    })),
  };
}

export function deserializeDocument<Buffer extends CellBuffer>(
  json: SerializedDocument,
  bufferCtor: CellBufferCtor<Buffer>
): GridDocument<Buffer> {
  const doc = new GridDocument<Buffer>({
    width: json.width,
    height: json.height,
    emptyValue: json.emptyValue,
    bufferCtor,
  });
  const length = json.width * json.height;
  for (const layer of json.layers) {
    doc.addLayer({
      id: layer.id,
      name: layer.name,
      visible: layer.visible,
      locked: layer.locked,
      opacity: layer.opacity,
      activate: false,
      data: decodeRLE(layer.data, length, bufferCtor),
    });
  }
  doc.setActiveLayer(json.activeLayerId ?? doc.layers[0]?.id ?? null);
  return doc;
}
