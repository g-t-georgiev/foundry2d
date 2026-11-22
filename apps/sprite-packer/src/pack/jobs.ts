import {
  buildAtlas,
  type Atlas,
  type AtlasInput,
  type AtlasOptions,
  type RgbaImage,
} from "@foundry2d/atlas";
import { exportFiles, type ExportFile, type ExportRequest } from "../export";

/** A sprite to pack; its pixels are among the images sent so far. */
export interface PackInput extends Omit<AtlasInput, "image"> {
  imageId: number;
}

export interface PackRequest {
  type: "pack";
  /** Images not sent before, by id. */
  images: [id: number, image: RgbaImage][];
  inputs: PackInput[];
  options: AtlasOptions;
}

export type Request = PackRequest | ({ type: "export" } & ExportRequest);

export interface Results {
  pack: Atlas;
  export: ExportFile[];
}

/**
 * Runs the slow jobs. Lives in the worker (or on the page, where workers
 * can't start) and keeps the images of the last packing, so each image is
 * sent once.
 */
export class Jobs {
  private images = new Map<number, RgbaImage>();

  run(request: Request): Atlas | Promise<ExportFile[]> {
    return request.type === "pack" ? this.pack(request) : exportFiles(request);
  }

  private pack({ images, inputs, options }: PackRequest): Atlas {
    const known = new Map([...this.images, ...images]);
    this.images = new Map(inputs.map(({ imageId }) => [imageId, known.get(imageId)!]));
    return buildAtlas(
      inputs.map(({ imageId, ...input }) => ({ ...input, image: known.get(imageId)! })),
      options
    );
  }
}

/** The buffers of a result, to hand over instead of copying. */
export function buffersOf(result: Atlas | ExportFile[]): ArrayBuffer[] {
  const buffers = Array.isArray(result)
    ? result.map((f) => f.bytes.buffer)
    : result.sheets.map((s) => s.image.data.buffer);
  return [...new Set(buffers)] as ArrayBuffer[];
}
