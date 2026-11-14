import type {
  ExportController,
  ExportSource,
  GifExportOptions,
  ImageExportOptions,
  ImageFormat,
  SheetExportOptions,
} from "../export/ExportController";
import type { SheetDataFormat, SheetLayout } from "../export/spritesheet";

type Tab = "image" | "sheet" | "gif";

/**
 * Export dialog: one form per output kind (image, spritesheet, GIF), with a
 * live summary of what will be written. All encoding goes through
 * `ExportController`, so the dialog only gathers options.
 */
export default class ExportDialog {
  private tab: Tab = "image";
  private readonly $: <T extends HTMLElement>(sel: string) => T;

  constructor(
    private readonly dialog: HTMLDialogElement,
    private readonly controller: ExportController,
    private readonly notify: (message: string, timeout?: number) => void
  ) {
    this.$ = <T extends HTMLElement>(sel: string) => dialog.querySelector<T>(sel)!;

    for (const tab of dialog.querySelectorAll<HTMLButtonElement>("[data-export-tab]")) {
      tab.addEventListener("click", () => this.showTab(tab.dataset.exportTab as Tab));
    }
    dialog.addEventListener("input", () => this.refresh());
    dialog.addEventListener("change", () => this.refresh());
    this.$("#exCancel").addEventListener("click", () => dialog.close());
    this.$("#exRun").addEventListener("click", () => void this.run());
  }

  open(tab?: Tab): void {
    if (tab) this.tab = tab;
    this.showTab(this.tab);
    if (!this.dialog.open) this.dialog.showModal();
  }

  private value(sel: string): string {
    return this.$<HTMLInputElement | HTMLSelectElement>(sel).value;
  }

  private checked(sel: string): boolean {
    return this.$<HTMLInputElement>(sel).checked;
  }

  private int(sel: string, fallback: number): number {
    const n = Math.floor(Number(this.value(sel)));
    return Number.isFinite(n) && n >= 0 ? n : fallback;
  }

  private get common(): { scale: number; source: ExportSource } {
    return {
      scale: Math.max(1, this.int("#exScale", 1)),
      source: this.value("#exSource") as ExportSource,
    };
  }

  imageOptions(): ImageExportOptions {
    return {
      ...this.common,
      format: this.value("#exFormat") as ImageFormat,
      quality: this.int("#exQuality", 90) / 100,
      background: this.value("#exBackground"),
      frames: this.value("#exFrames") as "current" | "all",
      trim: this.checked("#exTrim"),
      pattern: this.value("#exPattern"),
    };
  }

  sheetOptions(): SheetExportOptions {
    const columns = this.int("#exColumns", 0);
    return {
      ...this.common,
      layout: this.value("#exLayout") as SheetLayout,
      columns: columns > 0 ? columns : null,
      padding: this.int("#exPadding", 0),
      extrude: this.int("#exExtrude", 0),
      trim: this.checked("#exSheetTrim"),
      data: this.value("#exData") as SheetDataFormat | "none",
      output: this.value("#exOutput") as "zip" | "files",
    };
  }

  gifOptions(): GifExportOptions {
    return { ...this.common, loop: this.checked("#exLoop") };
  }

  private showTab(tab: Tab): void {
    this.tab = tab;
    for (const button of this.dialog.querySelectorAll<HTMLButtonElement>("[data-export-tab]")) {
      button.setAttribute("aria-selected", String(button.dataset.exportTab === tab));
    }
    for (const panel of this.dialog.querySelectorAll<HTMLElement>("[data-export-panel]")) {
      panel.hidden = panel.dataset.exportPanel !== tab;
    }
    this.refresh();
  }

  /** Shows/hides dependent fields and updates the output summary. */
  private refresh(): void {
    const format = this.value("#exFormat");
    const toggle = (when: string, visible: boolean) => {
      for (const el of this.dialog.querySelectorAll<HTMLElement>(`[data-when="${when}"]`)) {
        el.hidden = !visible;
      }
    };
    toggle("lossy", format === "webp-lossy" || format === "jpeg");
    toggle("jpeg", format === "jpeg");
    toggle("grid", this.value("#exLayout") === "grid");

    const info = this.$("#exInfo");
    try {
      info.textContent = this.summary();
    } catch (error) {
      info.textContent = (error as Error).message;
    }
  }

  private summary(): string {
    if (this.tab === "image") {
      const options = this.imageOptions();
      const { width, height } = this.controller.imageSize(options);
      const count = options.frames === "all" ? this.controller.frameCount : 1;
      return count > 1
        ? `${count} images of up to ${width}×${height} px in a ZIP.`
        : `One ${width}×${height} px image.`;
    }
    if (this.tab === "sheet") {
      const sheet = this.controller.buildSheet(this.sheetOptions());
      return `Sheet ${sheet.image.width}×${sheet.image.height} px with ${sheet.frames.length} frame(s).`;
    }
    const { scale } = this.common;
    return `${this.controller.frameCount} frame(s), ${this.controller.spriteWidth * scale}×${this.controller.spriteHeight * scale} px.`;
  }

  private async run(): Promise<void> {
    const button = this.$<HTMLButtonElement>("#exRun");
    button.disabled = true;
    try {
      let written: string;
      if (this.tab === "image") written = await this.controller.exportImages(this.imageOptions());
      else if (this.tab === "sheet")
        written = await this.controller.exportSpritesheet(this.sheetOptions());
      else written = this.controller.exportGif(this.gifOptions());
      this.dialog.close();
      this.notify(`Exported ${written}`);
    } catch (error) {
      this.$("#exInfo").textContent = `Export failed: ${(error as Error).message}`;
      console.error(error);
    } finally {
      button.disabled = false;
    }
  }
}
