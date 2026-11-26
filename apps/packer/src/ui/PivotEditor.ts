import type { PackSprite, Pivot } from "../model/PackProject";

/** Usual pivots, by value of the preset dropdown. */
const PRESETS: Record<string, Pivot> = {
  center: { x: 0.5, y: 0.5 },
  bottom: { x: 0.5, y: 1 },
  "top-left": { x: 0, y: 0 },
  "bottom-left": { x: 0, y: 1 },
};

const same = (a: Pivot, b: Pivot) => a.x === b.x && a.y === b.y;

/** Edits the selected sprites' pivot: a preset, or x and y as fractions of the sprite. */
export class PivotEditor {
  private readonly preset: HTMLSelectElement;
  private readonly x: HTMLInputElement;
  private readonly y: HTMLInputElement;

  constructor(
    private readonly root: HTMLElement,
    onChange: (pivot: Pivot | null) => void
  ) {
    this.preset = root.querySelector("#pivotPreset")!;
    this.x = root.querySelector("#pivotX")!;
    this.y = root.querySelector("#pivotY")!;
    this.preset.addEventListener("change", () => {
      const { value } = this.preset;
      if (value === "none") onChange(null);
      else if (value in PRESETS) onChange(PRESETS[value]);
    });
    for (const input of [this.x, this.y]) {
      input.addEventListener("change", () => {
        const pivot = { x: Number(this.x.value || 0.5), y: Number(this.y.value || 0.5) };
        if (Number.isFinite(pivot.x) && Number.isFinite(pivot.y)) onChange(pivot);
      });
    }
  }

  render(selected: readonly PackSprite[], supported: boolean): void {
    this.root.hidden = selected.length === 0;
    if (selected.length === 0) return;
    const title = this.root.querySelector<HTMLElement>("#selectionTitle")!;
    title.textContent = selected.length === 1 ? selected[0].name : `${selected.length} sprites`;
    const [first] = selected;
    const shared = selected.every((s) =>
      first.pivot && s.pivot ? same(first.pivot, s.pivot) : first.pivot === s.pivot
    );
    const pivot = shared ? first.pivot : undefined;
    const name = pivot
      ? (Object.keys(PRESETS).find((key) => same(PRESETS[key], pivot)) ?? "custom")
      : shared
        ? "none"
        : "mixed";
    this.preset.value = name;
    this.x.value = pivot ? String(pivot.x) : "";
    this.y.value = pivot ? String(pivot.y) : "";
    const hint = this.root.querySelector<HTMLElement>("#pivotHint")!;
    hint.hidden = supported;
  }
}
