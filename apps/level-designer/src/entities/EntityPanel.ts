import type { Level, LevelProject } from "../model/LevelProject";
import { fieldText, fieldValue } from "../model/entities";
import type { EntityDef, EntityInstance, FieldDef, FieldValue } from "../model/types";
import { entityColor } from "../render/entityRenderer";
import type { EntityController } from "./EntityController";

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

const row = (label: string, ...controls: HTMLElement[]) =>
  el(
    "label",
    { className: "field" },
    el("span", { className: "label", textContent: label }),
    ...(controls.length === 1 ? controls : [el("span", { className: "field-pair" }, ...controls)])
  );

/**
 * Side panel for Entities layers: the list of definitions to place (with
 * per-level counts) and an inspector for the selected instance.
 */
export default class EntityPanel {
  constructor(
    private readonly list: HTMLElement,
    private readonly inspector: HTMLElement,
    private readonly controller: EntityController,
    private readonly openSettings: () => void
  ) {
    list.addEventListener("click", (ev) => {
      const item = (ev.target as Element).closest<HTMLElement>("[data-uid]");
      if (item) this.controller.setPlaceDef(Number(item.dataset.uid));
    });
  }

  render(project: LevelProject, level: Level): void {
    this.renderList(project, level);
    this.renderInspector(project);
  }

  private renderList(project: LevelProject, level: Level): void {
    const current = this.controller.placeDef?.uid;
    if (project.defs.entities.length === 0) {
      const button = el("button", {
        className: "btn btn-small",
        textContent: "Define entities…",
      });
      button.addEventListener("click", () => this.openSettings());
      this.list.replaceChildren(
        el("p", { className: "hint", textContent: "This project has no entity definitions." }),
        button
      );
      return;
    }
    this.list.replaceChildren(
      ...project.defs.entities.map((def, i) => {
        const count = project.countEntities(def.uid, level);
        const item = el(
          "button",
          { className: "entity-item", type: "button" },
          el("span", { className: `entity-swatch shape-${def.shape}` }),
          el("span", { className: "entity-name", textContent: def.identifier }),
          el("small", {
            className: "entity-count",
            textContent: def.maxPerLevel ? `${count}/${def.maxPerLevel}` : String(count),
          })
        );
        (item.firstChild as HTMLElement).style.setProperty("--swatch", def.color);
        item.dataset.uid = String(def.uid);
        item.title = i < 9 ? `${def.identifier} (${i + 1})` : def.identifier;
        item.setAttribute("aria-pressed", String(def.uid === current));
        return item;
      })
    );
  }

  private renderInspector(project: LevelProject): void {
    const instance = this.controller.selected;
    const def = instance ? project.getEntityDef(instance.defUid) : undefined;
    if (!instance || !def) {
      this.inspector.replaceChildren(
        el("p", {
          className: "hint",
          textContent:
            "Click to place · drag to move · Shift places freely · right-click or Delete removes · Ctrl+D duplicates.",
        })
      );
      return;
    }

    const header = el(
      "div",
      { className: "inspector-header" },
      el("span", { className: "entity-swatch" }),
      el("strong", { textContent: def.identifier }),
      el("small", { textContent: instance.iid.slice(0, 8), title: instance.iid })
    );
    (header.firstChild as HTMLElement).style.setProperty(
      "--swatch",
      entityColor(project, def, instance)
    );

    const number = (value: number, onChange: (v: number) => void, step = "1") => {
      const input = el("input", {
        className: "input",
        type: "number",
        step,
        value: fieldText(value),
      });
      input.addEventListener("change", () => {
        const v = Number(input.value);
        if (input.value.trim() !== "" && Number.isFinite(v)) onChange(v);
        else input.value = String(value);
      });
      return input;
    };
    const x = number(instance.x, (v) =>
      this.controller.update(instance.iid, { x: v }, "Move entity")
    );
    const y = number(instance.y, (v) =>
      this.controller.update(instance.iid, { y: v }, "Move entity")
    );
    x.setAttribute("aria-label", "X in pixels");
    y.setAttribute("aria-label", "Y in pixels");

    const fields = def.fields.map((field) => this.fieldEditor(project, def, instance, field));

    const duplicate = el("button", { className: "btn btn-small", textContent: "Duplicate" });
    duplicate.addEventListener("click", () => this.controller.duplicateSelected());
    const remove = el("button", { className: "btn btn-small btn-danger", textContent: "Delete" });
    remove.addEventListener("click", () => this.controller.deleteSelected());

    this.inspector.replaceChildren(
      header,
      row("Position (px)", x, y),
      ...(fields.length
        ? fields
        : [
            el("p", { className: "hint", textContent: "No fields. Add them in Project settings." }),
          ]),
      el("div", { className: "button-row" }, duplicate, remove)
    );
  }

  private fieldEditor(
    project: LevelProject,
    def: EntityDef,
    instance: EntityInstance,
    field: FieldDef
  ): HTMLElement {
    const value = fieldValue(instance, field, project.defs.enums);
    const set = (next: FieldValue) =>
      this.controller.update(
        instance.iid,
        { fields: { ...instance.fields, [field.uid]: next } },
        `Set ${def.identifier}.${field.identifier}`
      );

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
        return row(field.identifier, input);
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
        return row(field.identifier, input);
      }
      case "Color": {
        const input = el("input", { type: "color", value: fieldText(value) });
        input.addEventListener("change", () => set(input.value));
        return row(field.identifier, input);
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
        return row(field.identifier, select);
      }
      case "Point": {
        const point = value && typeof value === "object" ? value : null;
        const label = el("span", {
          className: "point-value",
          textContent: point ? `${point.x}, ${point.y}` : "not set",
        });
        const picking = this.controller.pickingPoint;
        const isPicking = picking?.iid === instance.iid && picking.fieldUid === field.uid;
        const pick = el("button", {
          className: `btn btn-small${isPicking ? " active" : ""}`,
          textContent: isPicking ? "Click a cell…" : "Pick",
          title: "Pick a cell on the level",
        });
        pick.addEventListener("click", () =>
          isPicking
            ? this.controller.cancelPointPick()
            : this.controller.startPointPick(instance.iid, field.uid)
        );
        const clear = el("button", {
          className: "btn btn-small",
          textContent: "Clear",
          disabled: !point,
        });
        clear.addEventListener("click", () => set(null));
        return row(`${field.identifier} (cell)`, label, pick, clear);
      }
    }
  }
}
