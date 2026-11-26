import { SHEET_FORMATS } from "@gs2d/formats";
import { rotationBlocked, type PackSettings } from "../model/settings";

/**
 * The settings form: every control carries its setting in `data-setting`
 * (checkboxes, numbers and selects). Changes commit on "change" as a patch;
 * `render` shows the project's settings and hides what doesn't apply.
 */
export class SettingsPanel {
  constructor(
    private readonly root: HTMLElement,
    onChange: (patch: Partial<PackSettings>) => void
  ) {
    const format = root.querySelector<HTMLSelectElement>('[data-setting="dataFormat"]')!;
    for (const f of SHEET_FORMATS) format.append(new Option(f.label, f.id));
    format.append(new Option("Image only", "none"));

    root.addEventListener("change", (ev) => {
      const control = ev.target as HTMLInputElement | HTMLSelectElement;
      if (control.dataset.scale) {
        const boxes = root.querySelectorAll<HTMLInputElement>("[data-scale]:checked");
        onChange({ scales: [...boxes].map((b) => Number(b.dataset.scale)) });
        return;
      }
      const key = control.dataset.setting;
      if (!key) return;
      const value =
        control instanceof HTMLInputElement && control.type === "checkbox"
          ? control.checked
          : control instanceof HTMLInputElement && control.type === "number"
            ? control.value.trim() === ""
              ? NaN // an emptied number keeps its old value
              : Number(control.value)
            : control.value;
      onChange({ [key]: value });
    });
  }

  render(settings: Readonly<PackSettings>): void {
    for (const control of this.root.querySelectorAll<HTMLInputElement | HTMLSelectElement>(
      "[data-setting]"
    )) {
      const value = settings[control.dataset.setting as keyof PackSettings];
      if (control instanceof HTMLInputElement && control.type === "checkbox") {
        control.checked = value === true;
      } else {
        control.value = String(value);
      }
    }
    for (const box of this.root.querySelectorAll<HTMLInputElement>("[data-scale]")) {
      box.checked = settings.scales.includes(Number(box.dataset.scale));
    }
    for (const part of this.root.querySelectorAll<HTMLElement>("[data-for]")) {
      part.hidden = part.dataset.for !== settings.algorithm;
    }
    const blocked = rotationBlocked(settings);
    const rotation = this.root.querySelector<HTMLInputElement>('[data-setting="allowRotation"]')!;
    rotation.disabled = blocked !== null;
    const hint = this.root.querySelector<HTMLElement>("#rotationHint")!;
    hint.textContent = blocked ?? "";
    hint.hidden = blocked === null;
    const format = SHEET_FORMATS.find((f) => f.id === settings.dataFormat);
    this.root.querySelector<HTMLElement>("#formatHint")!.textContent = format
      ? `Read by: ${format.readers}`
      : "Only the sheet images are exported.";
  }
}
