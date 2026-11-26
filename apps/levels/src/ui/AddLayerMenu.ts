import type { LayerType } from "../model/types";

/**
 * Small popover that asks which kind of layer to add. `choose()` resolves
 * with the picked type, or `null` when dismissed (Escape, click outside).
 */
export default class AddLayerMenu {
  private pending: ((type: LayerType | null) => void) | null = null;

  constructor(private readonly menu: HTMLElement) {
    menu.addEventListener("click", (ev) => {
      const item = (ev.target as Element).closest<HTMLElement>("[data-layer-type]");
      if (item) this.finish(item.dataset.layerType as LayerType);
    });
    menu.addEventListener("keydown", (ev) => {
      const items = [...menu.querySelectorAll<HTMLElement>("[data-layer-type]")];
      const index = items.indexOf(document.activeElement as HTMLElement);
      if (ev.key === "Escape") {
        ev.stopPropagation();
        this.finish(null);
      } else if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
        ev.preventDefault();
        const step = ev.key === "ArrowDown" ? 1 : items.length - 1;
        items[(index + step) % items.length]?.focus();
      }
    });
    document.addEventListener("pointerdown", (ev) => {
      if (this.pending && !menu.contains(ev.target as Node)) this.finish(null);
    });
  }

  choose(): Promise<LayerType | null> {
    this.finish(null);
    this.menu.hidden = false;
    this.menu.querySelector<HTMLElement>("[data-layer-type]")?.focus();
    return new Promise((resolve) => (this.pending = resolve));
  }

  private finish(type: LayerType | null): void {
    const resolve = this.pending;
    this.pending = null;
    this.menu.hidden = true;
    resolve?.(type);
  }
}
