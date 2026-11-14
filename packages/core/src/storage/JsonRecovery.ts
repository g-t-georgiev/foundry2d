import type { RecoveryStore } from "./types";
import { IndexedDBStorage } from "./IndexedDBStorage";

export interface JsonRecoveryOptions {
  /** Where snapshots go. Defaults to the shared IndexedDB storage. */
  store?: RecoveryStore;
  /** Debounce in ms between the last change and the write. Default 800. */
  delay?: number;
  onSaved?: () => void;
  onError?: (error: unknown) => void;
}

/**
 * Debounced crash-recovery slot that stores one JSON value under `key`.
 * Apps call `schedule()` whenever their data changes.
 */
export class JsonRecovery {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly driver: RecoveryStore;
  private readonly delay: number;
  private readonly encoder = new TextEncoder();
  private readonly decoder = new TextDecoder();

  constructor(
    private readonly key: string,
    private readonly getValue: () => unknown,
    private readonly options: JsonRecoveryOptions = {}
  ) {
    this.driver = options.store ?? new IndexedDBStorage().recovery;
    this.delay = options.delay ?? 800;
  }

  schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, this.delay);
  }

  async flush(): Promise<void> {
    try {
      const bytes = this.encoder.encode(JSON.stringify(this.getValue()));
      await this.driver.saveRecovery(this.key, bytes);
      this.options.onSaved?.();
    } catch (error) {
      this.options.onError?.(error);
    }
  }

  /** Returns the parsed value, or `null` when nothing (readable) is stored. */
  async load(): Promise<unknown> {
    try {
      const bytes = await this.driver.loadRecovery(this.key);
      return bytes ? (JSON.parse(this.decoder.decode(bytes)) as unknown) : null;
    } catch (error) {
      this.options.onError?.(error);
      return null;
    }
  }

  async clear(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await this.driver.clearRecovery(this.key);
  }
}
