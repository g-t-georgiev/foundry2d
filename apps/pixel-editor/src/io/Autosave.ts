import type { GridDocument } from "@foundry2d/core";
import { IndexedDBStorageDriver, type StorageDriver } from "@foundry2d/core";
import { fromProjectFile, toProjectFile } from "./project";

const RECOVERY_KEY = "pixel-editor:autosave";

/**
 * Debounced crash-recovery snapshots in IndexedDB. The snapshot is the same
 * JSON as a saved project file, so recovery and "Open" share one decoder.
 */
export class Autosave {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private readonly encoder = new TextEncoder();
  private readonly decoder = new TextDecoder();

  constructor(
    private readonly getSnapshot: () => { doc: GridDocument<Uint32Array>; name: string },
    private readonly onSaved?: () => void,
    private readonly driver: StorageDriver = new IndexedDBStorageDriver("foundry2d")
  ) {}

  /** Schedules a save `delay` ms after the last change. */
  schedule(delay = 800): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.flush();
    }, delay);
  }

  async flush(): Promise<void> {
    const { doc, name } = this.getSnapshot();
    const bytes = this.encoder.encode(JSON.stringify(toProjectFile(doc, name)));
    try {
      await this.driver.saveRecovery(RECOVERY_KEY, bytes);
      this.onSaved?.();
    } catch (error) {
      console.warn("Autosave failed", error);
    }
  }

  async load(): Promise<{ doc: GridDocument<Uint32Array>; name: string } | null> {
    try {
      const bytes = await this.driver.loadRecovery(RECOVERY_KEY);
      if (!bytes) return null;
      return fromProjectFile(JSON.parse(this.decoder.decode(bytes)));
    } catch (error) {
      console.warn("Ignoring unreadable autosave", error);
      return null;
    }
  }

  async clear(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    await this.driver.clearRecovery(RECOVERY_KEY);
  }
}
