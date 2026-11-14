import { downloadBlob } from "@foundry2d/workspace";
import { ApplicationStateActions, applicationStore } from "../state";
import type { Sprite } from "../model/Sprite";
import { PaletteFormatError, parsePaletteFile, toGplPalette, toHexPalette } from "../io/palette";
import PaletteView from "./PaletteView";

/**
 * The sprite's palette panel: picking, adding and removing colours, and
 * importing or exporting `.hex` / `.gpl` palette files.
 */
export class PaletteController {
  private readonly view: PaletteView;

  constructor(
    root: HTMLElement,
    private readonly sprite: Sprite,
    private readonly hooks: {
      getName(): string;
      notify(message: string, timeout?: number): void;
    }
  ) {
    this.view = new PaletteView(root, {
      pick: (color) => applicationStore.dispatch(ApplicationStateActions.SetColor, { color }),
      add: () => sprite.setPalette([...sprite.palette, applicationStore.getState().currentColor]),
      remove: (color) => sprite.setPalette(sprite.palette.filter((c) => c !== color)),
      import: (file) => void this.importFile(file),
      export: (format) => this.exportFile(format),
    });
  }

  render(): void {
    this.view.render(this.sprite.palette, applicationStore.getState().currentColor);
  }

  private async importFile(file: File): Promise<void> {
    try {
      const colors = parsePaletteFile(file.name, await file.text());
      this.sprite.setPalette(colors);
      this.hooks.notify(`Imported ${colors.length} colours from ${file.name}`);
    } catch (error) {
      const message =
        error instanceof PaletteFormatError ? error.message : "Could not read the palette.";
      this.hooks.notify(message, 5000);
      console.error(error);
    }
  }

  private exportFile(format: "hex" | "gpl"): void {
    const colors = this.sprite.palette;
    const name = this.hooks.getName();
    const text = format === "hex" ? toHexPalette(colors) : toGplPalette(colors, name);
    downloadBlob(new Blob([text], { type: "text/plain" }), `${name}.${format}`);
    this.hooks.notify(`Exported ${colors.length} colours as .${format}`);
  }
}
