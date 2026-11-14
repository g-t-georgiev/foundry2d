export interface PaletteHooks {
  pick(color: string): void;
  add(): void;
  remove(color: string): void;
  import(file: File): void;
  export(format: "hex" | "gpl"): void;
}

/**
 * Sprite palette: swatches plus add/remove/import/export. Pure view over
 * the colours it is given; changes go through the hooks.
 * Right-click (or Delete on a focused swatch) removes a colour.
 */
export default class PaletteView {
  private readonly grid: HTMLElement;

  constructor(
    root: HTMLElement,
    private readonly hooks: PaletteHooks
  ) {
    const $ = <T extends Element>(sel: string) => root.querySelector<T>(sel)!;
    this.grid = $(".palette");
    const fileInput = $<HTMLInputElement>("#paletteFile");

    this.grid.addEventListener("click", (ev) => {
      const swatch = (ev.target as Element).closest<HTMLElement>("[data-color]");
      if (swatch?.dataset.color) hooks.pick(swatch.dataset.color);
    });
    this.grid.addEventListener("contextmenu", (ev) => {
      const swatch = (ev.target as Element).closest<HTMLElement>("[data-color]");
      if (!swatch?.dataset.color) return;
      ev.preventDefault();
      hooks.remove(swatch.dataset.color);
    });
    this.grid.addEventListener("keydown", (ev) => {
      const swatch = (ev.target as Element).closest<HTMLElement>("[data-color]");
      if (swatch?.dataset.color && (ev.key === "Delete" || ev.key === "Backspace")) {
        ev.preventDefault();
        ev.stopPropagation();
        hooks.remove(swatch.dataset.color);
      }
    });
    $("#paletteAdd").addEventListener("click", () => hooks.add());
    $("#paletteImport").addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", () => {
      const file = fileInput.files?.[0];
      fileInput.value = "";
      if (file) hooks.import(file);
    });
    const exportSelect = $<HTMLSelectElement>("#paletteExport");
    exportSelect.addEventListener("change", () => {
      const format = exportSelect.value;
      exportSelect.value = "";
      if (format === "hex" || format === "gpl") hooks.export(format);
    });
  }

  render(colors: readonly string[], current: string): void {
    const active = current.toLowerCase();
    this.grid.replaceChildren(
      ...colors.map((color) => {
        const swatch = document.createElement("button");
        swatch.className = "swatch";
        swatch.style.setProperty("--c", color);
        swatch.dataset.color = color;
        swatch.title = `${color} (right-click to remove)`;
        swatch.setAttribute("aria-label", color);
        swatch.classList.toggle("active", color.toLowerCase() === active);
        return swatch;
      })
    );
  }
}
