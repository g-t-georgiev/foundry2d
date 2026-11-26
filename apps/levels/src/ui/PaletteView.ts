import type { LayerDef } from "../model/types";

/**
 * IntGrid value picker for the active layer. Pure view: it renders the def it
 * is given and reports clicks; the app decides what "selected" means.
 */
export default class PaletteView {
  constructor(
    private readonly list: HTMLElement,
    private readonly title: HTMLElement | null,
    private readonly onSelect: (value: number) => void
  ) {
    list.addEventListener("click", (ev) => {
      const item = (ev.target as Element).closest<HTMLElement>("[data-value]");
      if (item) this.onSelect(Number(item.dataset.value));
    });
  }

  render(def: LayerDef | undefined, selected: number | undefined): void {
    if (this.title) this.title.textContent = def?.identifier ?? "—";

    if (!def || def.intGridValues.length === 0) {
      const empty = document.createElement("p");
      empty.className = "palette-empty";
      empty.textContent = def
        ? "This layer has no values yet. Add some in the layer definitions."
        : "No layer selected.";
      this.list.replaceChildren(empty);
      return;
    }

    const items = def.intGridValues.map((entry, index) => {
      const item = document.createElement("button");
      item.className = "palette-item";
      item.dataset.value = String(entry.value);
      item.setAttribute("role", "option");
      item.setAttribute("aria-selected", String(entry.value === selected));
      item.title = `${entry.identifier} (value ${entry.value})`;

      const swatch = document.createElement("span");
      swatch.className = "palette-swatch";
      swatch.style.background = entry.color;

      const name = document.createElement("span");
      name.textContent = entry.identifier;

      const key = document.createElement("span");
      key.className = "key";
      key.textContent = index < 9 ? `${index + 1} · ${entry.value}` : String(entry.value);

      item.append(swatch, name, key);
      return item;
    });
    this.list.replaceChildren(...items);
  }
}
