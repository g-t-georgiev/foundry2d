import { buffersOf, Jobs, type Request } from "./jobs";

/** Reply to a job: its result, or why it failed. */
export type Reply = { id: number } & ({ result: unknown } | { error: string });

const jobs = new Jobs();

self.onmessage = async ({ data }: MessageEvent<{ id: number; request: Request }>) => {
  const { id, request } = data;
  try {
    const result = await jobs.run(request);
    self.postMessage({ id, result } satisfies Reply, { transfer: buffersOf(result) });
  } catch (error) {
    self.postMessage({ id, error: (error as Error).message } satisfies Reply);
  }
};
