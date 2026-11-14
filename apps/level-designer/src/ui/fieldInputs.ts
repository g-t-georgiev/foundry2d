import type { LevelProject } from "../model/LevelProject";
import { fieldText } from "../model/entities";
import type { FieldDef, FieldValue } from "../model/types";

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

export const labelledRow = (label: string, ...controls: HTMLElement[]) =>
  el(
    "label",
    { className: "field" },
    el("span", { className: "label", textContent: label }),
    ...(controls.length === 1 ? controls : [el("span", { className: "field-pair" }, ...controls)])
  );

export interface FieldInputOptions {
  project: LevelProject;
  field: FieldDef;
  /** The current value (already resolved to the default when unset). */
  value: FieldValue;
  /** Commits a new value (one undo step on the caller's side). */
  set(next: FieldValue): void;
  /**
   * Point fields: picking a cell on the canvas. Without it, a Point field is
   * edited as two numbers.
   */
  pickPoint?: { active: boolean; start(): void; cancel(): void };
}

/**
 * The input for one field value, by field type: number, checkbox, text,
 * colour, enum select, or a cell for Point fields. Shared by the entity
 * inspector and the level panel. Values commit on "change", not on every
 * keystroke.
 */
export function fieldInput({
  project,
  field,
  value,
  set,
  pickPoint,
}: FieldInputOptions): HTMLElement {
  switch (field.type) {
    case "Int":
    case "Float": {
      const input = el("input", {
        className: "input",
        type: "number",
        step: field.type === "Int" ? "1" : "any",
        value: fieldText(value),
      });
      if (typeof field.min === "number") input.min = String(field.min);
      if (typeof field.max === "number") input.max = String(field.max);
      input.addEventListener("change", () => {
        const n = Number(input.value);
        if (input.value.trim() !== "" && Number.isFinite(n)) set(n);
        else input.value = fieldText(value);
      });
      return labelledRow(field.identifier, input);
    }
    case "Bool": {
      const input = el("input", { type: "checkbox", checked: value === true });
      input.addEventListener("change", () => set(input.checked));
      return el(
        "label",
        { className: "field inline checkbox-field" },
        input,
        el("span", { className: "label", textContent: field.identifier })
      );
    }
    case "String": {
      const input = el("input", { className: "input", value: fieldText(value) });
      input.addEventListener("change", () => set(input.value));
      return labelledRow(field.identifier, input);
    }
    case "Color": {
      const input = el("input", { type: "color", value: fieldText(value) });
      input.addEventListener("change", () => set(input.value));
      return labelledRow(field.identifier, input);
    }
    case "Enum": {
      const enumDef = project.getEnum(field.enumUid);
      const select = el("select", { className: "input" });
      select.append(new Option("— none —", ""));
      for (const v of enumDef?.values ?? []) {
        select.append(new Option(v.id, v.id, false, v.id === value));
      }
      select.disabled = !enumDef;
      select.addEventListener("change", () => set(select.value || null));
      return labelledRow(field.identifier, select);
    }
    case "Point": {
      const point = value && typeof value === "object" ? value : null;
      const clear = el("button", {
        className: "btn btn-small",
        textContent: "Clear",
        disabled: !point,
      });
      clear.addEventListener("click", () => set(null));
      if (pickPoint) {
        const label = el("span", {
          className: "point-value",
          textContent: point ? `${point.x}, ${point.y}` : "not set",
        });
        const pick = el("button", {
          className: `btn btn-small${pickPoint.active ? " active" : ""}`,
          textContent: pickPoint.active ? "Click a cell…" : "Pick",
          title: "Pick a cell on the level",
        });
        pick.addEventListener("click", () =>
          pickPoint.active ? pickPoint.cancel() : pickPoint.start()
        );
        return labelledRow(`${field.identifier} (cell)`, label, pick, clear);
      }
      const coordinate = (axis: "x" | "y") => {
        const input = el("input", {
          className: "input",
          type: "number",
          step: "1",
          placeholder: axis,
          value: point ? String(point[axis]) : "",
        });
        input.setAttribute("aria-label", `${field.identifier} ${axis}`);
        input.addEventListener("change", () => {
          const n = Number(input.value);
          if (input.value.trim() === "" || !Number.isInteger(n)) return;
          set({ x: axis === "x" ? n : (point?.x ?? 0), y: axis === "y" ? n : (point?.y ?? 0) });
        });
        return input;
      };
      return labelledRow(`${field.identifier} (cell)`, coordinate("x"), coordinate("y"), clear);
    }
  }
}
