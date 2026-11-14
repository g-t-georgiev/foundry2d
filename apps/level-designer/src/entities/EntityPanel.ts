import type { Level, LevelProject } from "../model/LevelProject";
import { fieldText, fieldValue } from "../model/entities";
import { fieldInput } from "../ui/fieldInputs";
import type { EntityDef, EntityInstance, FieldDef } from "../model/types";
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
    const picking = this.controller.pickingPoint;
    return fieldInput({
      project,
      field,
      value: fieldValue(instance, field, project.defs.enums),
      set: (next) =>
        this.controller.update(
          instance.iid,
          { fields: { ...instance.fields, [field.uid]: next } },
          `Set ${def.identifier}.${field.identifier}`
        ),
      pickPoint: {
        active: picking?.iid === instance.iid && picking.fieldUid === field.uid,
        start: () => this.controller.startPointPick(instance.iid, field.uid),
        cancel: () => this.controller.cancelPointPick(),
      },
    });
  }
}
