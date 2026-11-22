import type { Atlas, AtlasInput, AtlasOptions, RgbaImage } from "@foundry2d/atlas";
import type { ExportFile, ExportRequest } from "../export";
import { Jobs, type Request, type Results } from "./jobs";
import type { Reply } from "./worker";

interface Pending {
  request: Request;
  /** Every image a packing needs, also the ones sent earlier. */
  images: ReadonlyMap<number, RgbaImage>;
  resolve: (result: never) => void;
  reject: (error: Error) => void;
}

const createWorker = () => new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });

/**
 * Packs and exports in a worker, so the page never waits for it. Where the
 * worker can't start (or dies), the jobs run on the page instead.
 */
export class Packer {
  private worker: Worker | null = null;
  /** Set once the worker is given up on. */
  private local: Jobs | null = null;
  private readonly pending = new Map<number, Pending>();
  private nextJob = 0;
  private readonly ids = new WeakMap<RgbaImage, number>();
  private nextImage = 0;
  /** Images the worker has: the ones of the last packing. */
  private sent: ReadonlyMap<number, RgbaImage> = new Map();

  constructor(private readonly start: () => Worker = createWorker) {}

  /** True while jobs run off the page. */
  get inWorker(): boolean {
    return this.worker !== null;
  }

  pack(inputs: readonly AtlasInput[], options: AtlasOptions): Promise<Atlas> {
    const used = new Map<number, RgbaImage>();
    const packInputs = inputs.map(({ image, ...input }) => {
      let imageId = this.ids.get(image);
      if (imageId === undefined) this.ids.set(image, (imageId = this.nextImage++));
      used.set(imageId, image);
      return { ...input, imageId };
    });
    const images = [...used].filter(([id]) => !this.sent.has(id));
    this.sent = used;
    return this.run({ type: "pack", images, inputs: packInputs, options }, used);
  }

  export(request: ExportRequest): Promise<ExportFile[]> {
    return this.run({ type: "export", ...request }, new Map());
  }

  private run<T extends Request>(
    request: T,
    images: Pending["images"]
  ): Promise<Results[T["type"]]> {
    if (!this.worker && !this.local) this.startWorker();
    if (this.local) return this.runLocally(this.local, request);
    return new Promise((resolve, reject) => {
      const id = this.nextJob++;
      this.pending.set(id, { request, images, resolve, reject });
      this.worker!.postMessage({ id, request });
    });
  }

  private async runLocally<T extends Request>(jobs: Jobs, request: T) {
    return (await jobs.run(request)) as Results[T["type"]];
  }

  private startWorker(): void {
    try {
      const worker = this.start();
      worker.onmessage = ({ data }: MessageEvent<Reply>) => {
        const job = this.pending.get(data.id);
        this.pending.delete(data.id);
        if ("error" in data) job?.reject(new Error(data.error));
        else job?.resolve(data.result as never);
      };
      worker.onerror = (ev) => {
        ev.preventDefault();
        this.giveUp();
      };
      worker.onmessageerror = () => this.giveUp();
      this.worker = worker;
    } catch {
      this.local = new Jobs();
    }
  }

  /** The worker is gone: what it was doing is done on the page. */
  private giveUp(): void {
    this.worker?.terminate();
    this.worker = null;
    const jobs = (this.local = new Jobs());
    const unfinished = [...this.pending.values()];
    this.pending.clear();
    this.sent = new Map(); // what comes next brings its images along
    for (const { request, images, resolve, reject } of unfinished) {
      const all: Request = request.type === "pack" ? { ...request, images: [...images] } : request;
      if (request.type === "pack") this.sent = images;
      void this.runLocally(jobs, all).then(resolve as (r: unknown) => void, reject);
    }
  }
}
