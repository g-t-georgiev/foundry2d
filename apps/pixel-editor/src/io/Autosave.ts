import { JsonRecovery, type GridDocument } from "@foundry2d/core";
import { fromProjectFile, toProjectFile } from "./project";

/**
 * Crash-recovery snapshots in IndexedDB. The snapshot is the same JSON as a
 * saved project file, so recovery and "Open" share one decoder.
 */
export class Autosave {
  private readonly slot: JsonRecovery;

  constructor(
    getSnapshot: () => { doc: GridDocument<Uint32Array>; name: string },
    onSaved?: () => void
  ) {
    this.slot = new JsonRecovery(
      "pixel-editor:autosave",
      () => {
        const { doc, name } = getSnapshot();
        return toProjectFile(doc, name);
      },
      { onSaved, onError: (error) => console.warn("Autosave failed", error) }
    );
  }

  schedule(): void {
    this.slot.schedule();
  }

  async load(): Promise<{ doc: GridDocument<Uint32Array>; name: string } | null> {
    const json = await this.slot.load();
    if (json === null) return null;
    try {
      return fromProjectFile(json);
    } catch (error) {
      console.warn("Ignoring unreadable autosave", error);
      return null;
    }
  }

  clear(): Promise<void> {
    return this.slot.clear();
  }
}
