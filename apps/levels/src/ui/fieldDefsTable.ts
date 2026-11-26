import { el } from "@gs2d/ui";
import type { LevelProject } from "../model/LevelProject";
import { fieldText } from "../model/entities";
import type { FieldDef, FieldValue } from "../model/types";

/** A list of field definitions and how to change it (an entity type's, or the levels'). */
export interface FieldDefsOwner {
  fields: readonly FieldDef[];
  update(fieldUid: number, patch: Partial<Omit<FieldDef, "uid" | "type">>): void;
  remove(fieldUid: number): void;
  /** Shown when there are no fields yet. */
  emptyHint: string;
}

export interface FieldDefsHooks {
  confirm(message: string): boolean;
  /** Redraws the surrounding editor after a change. */
  rerender(): void;
}

/**
 * Table of field definitions: type, identifier, default value, and
 * type-specific settings (enum, min/max), with a remove button per field.
 * Used for entity fields and level fields.
 */
export function fieldDefsTable(
  project: LevelProject,
  owner: FieldDefsOwner,
  hooks: FieldDefsHooks
): HTMLElement {
  const table = el("div", { className: "fields-table" });
  if (owner.fields.length === 0) {
    table.append(
      el("p", {
        className: "hint",
        textContent: owner.emptyHint,
      })
    );
    return table;
  }
  for (const f of owner.fields) {
    const update = (patch: Partial<Omit<FieldDef, "uid" | "type">>) => {
      owner.update(f.uid, patch);
      hooks.rerender();
    };
    const name = el("input", { className: "input", value: f.identifier, spellcheck: false });
    name.setAttribute("aria-label", "Field identifier");
    name.addEventListener("change", () => update({ identifier: name.value }));

    const extras: HTMLElement[] = [];
    if (f.type === "Enum") {
      const enumSelect = el("select", { className: "input" });
      enumSelect.append(new Option("— enum —", ""));
      for (const e of project.defs.enums) {
        enumSelect.append(new Option(e.identifier, String(e.uid), false, e.uid === f.enumUid));
      }
      enumSelect.setAttribute("aria-label", "Enum");
      enumSelect.addEventListener("change", () =>
        update({ enumUid: enumSelect.value ? Number(enumSelect.value) : null })
      );
      extras.push(enumSelect);
    }
    if (f.type === "EntityRef") {
      const target = el("select", { className: "input" });
      target.append(new Option("any entity", ""));
      for (const d of project.defs.entities) {
        target.append(new Option(d.identifier, String(d.uid), false, d.uid === f.refDefUid));
      }
      target.setAttribute("aria-label", "Points at");
      target.title = "Entity type the field points at";
      target.addEventListener("change", () =>
        update({ refDefUid: target.value ? Number(target.value) : null })
      );
      extras.push(target);
    }
    if (f.type === "Int" || f.type === "Float") {
      const bound = (key: "min" | "max") => {
        const input = el("input", {
          className: "input input-small",
          type: "number",
          placeholder: key,
          value: typeof f[key] === "number" ? String(f[key]) : "",
        });
        input.setAttribute("aria-label", key);
        input.addEventListener("change", () => {
          const v = input.value.trim() === "" ? null : Number(input.value);
          update({ [key]: v === null || Number.isFinite(v) ? v : null });
        });
        return input;
      };
      extras.push(bound("min"), bound("max"));
    }

    const array = el("input", { type: "checkbox", checked: f.isArray === true });
    array.setAttribute("aria-label", `${f.identifier} is a list`);
    array.addEventListener("change", () => {
      if (
        !array.checked &&
        !hooks.confirm(`Make "${f.identifier}" a single value? Lists keep only their first entry.`)
      ) {
        array.checked = true;
        return;
      }
      update({ isArray: array.checked });
    });
    extras.push(
      el(
        "label",
        { className: "inline field-array-toggle", title: "Hold a list of values" },
        array,
        el("span", { textContent: "List" })
      )
    );

    const remove = el("button", {
      className: "btn btn-icon btn-danger",
      textContent: "✕",
      title: `Remove field ${f.identifier}`,
    });
    remove.setAttribute("aria-label", remove.title);
    remove.addEventListener("click", () => {
      if (!hooks.confirm(`Remove field "${f.identifier}" and its values? Ctrl+Z undoes it.`)) {
        return;
      }
      owner.remove(f.uid);
      hooks.rerender();
    });

    table.append(
      el(
        "div",
        { className: "field-row" },
        el("span", { className: "field-type", textContent: f.type }),
        name,
        defaultEditor(project, f, (value) => update({ defaultValue: value })),
        ...extras,
        remove
      )
    );
  }
  return table;
}

/** Editor for a field's default value. */
function defaultEditor(
  project: LevelProject,
  f: FieldDef,
  onChange: (value: FieldValue) => void
): HTMLElement {
  const value = f.defaultValue;
  if (f.isArray) return el("span", { className: "hint", textContent: "default: empty list" });
  switch (f.type) {
    case "Int":
    case "Float": {
      const input = el("input", {
        className: "input input-small",
        type: "number",
        step: f.type === "Int" ? "1" : "any",
        value: fieldText(value ?? 0),
        title: "Default",
      });
      input.addEventListener("change", () => onChange(Number(input.value) || 0));
      return input;
    }
    case "Bool": {
      const input = el("input", { type: "checkbox", checked: value === true, title: "Default" });
      input.addEventListener("change", () => onChange(input.checked));
      return input;
    }
    case "String": {
      const input = el("input", {
        className: "input",
        value: fieldText(value),
        placeholder: "default",
      });
      input.addEventListener("change", () => onChange(input.value));
      return input;
    }
    case "Color": {
      const input = el("input", { type: "color", value: fieldText(value), title: "Default" });
      input.addEventListener("change", () => onChange(input.value));
      return input;
    }
    case "Enum": {
      const select = el("select", { className: "input", title: "Default" });
      select.append(new Option("— none —", ""));
      for (const v of project.getEnum(f.enumUid)?.values ?? []) {
        select.append(new Option(v.id, v.id, false, v.id === value));
      }
      select.addEventListener("change", () => onChange(select.value || null));
      return select;
    }
    case "Point":
    case "EntityRef":
      return el("span", { className: "hint", textContent: "default: not set" });
  }
}
