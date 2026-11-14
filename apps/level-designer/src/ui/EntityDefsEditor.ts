import type { LevelProject } from "../model/LevelProject";
import { tilesetGrid } from "../model/tiles";
import { fieldText } from "../model/entities";
import TilesetPickerView from "./TilesetPickerView";
import {
  ENTITY_SHAPES,
  FIELD_TYPES,
  type EntityDef,
  type EntityShape,
  type EnumDef,
  type FieldDef,
  type FieldType,
  type FieldValue,
} from "../model/types";

export interface EntityDefsEditorHooks {
  confirm: (message: string) => boolean;
}

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

const field = (label: string, ...controls: HTMLElement[]): HTMLLabelElement =>
  el(
    "label",
    { className: "field" },
    el("span", { className: "label", textContent: label }),
    ...controls
  );

const PIVOTS: { label: string; x: number; y: number }[] = [
  { label: "Top left", x: 0, y: 0 },
  { label: "Top", x: 0.5, y: 0 },
  { label: "Top right", x: 1, y: 0 },
  { label: "Left", x: 0, y: 0.5 },
  { label: "Centre", x: 0.5, y: 0.5 },
  { label: "Right", x: 1, y: 0.5 },
  { label: "Bottom left", x: 0, y: 1 },
  { label: "Bottom", x: 0.5, y: 1 },
  { label: "Bottom right", x: 1, y: 1 },
];

/**
 * Entity definitions (with their fields) and enums, shown as two sections
 * of the project settings dialog. Edits apply to the live project and are
 * not undoable, like other definition edits.
 */
export default class EntityDefsEditor {
  private project: LevelProject | null = null;
  private selectedEntityUid: number | null = null;
  private selectedEnumUid: number | null = null;
  /** Shared picker for "tile" shaped entities (kept across re-renders). */
  private readonly tilePickerHost = el("div", { className: "tileset-host entity-tile-picker" });
  private readonly tilePicker: TilesetPickerView;
  private tilePick: { entityUid: number; tilesetUid: number } | null = null;

  constructor(
    private readonly root: {
      entitiesList: HTMLElement;
      entityEditor: HTMLElement;
      enumsList: HTMLElement;
      enumEditor: HTMLElement;
      addEntity: HTMLElement;
      addEnum: HTMLElement;
    },
    private readonly hooks: EntityDefsEditorHooks
  ) {
    this.tilePicker = new TilesetPickerView(this.tilePickerHost, (tileset, selection) => {
      const pick = this.tilePick;
      if (!this.project || !pick || pick.tilesetUid !== tileset.uid) return;
      // A drag picks a rectangle; entities use its top-left tile.
      const tileId = selection.y * tilesetGrid(tileset).columns + selection.x;
      const def = this.project.getEntityDef(pick.entityUid);
      if (def?.tile?.tileId === tileId) return;
      this.project.updateEntityDef(pick.entityUid, { tile: { tilesetUid: tileset.uid, tileId } });
      this.render();
    });
    root.addEntity.addEventListener("click", () => {
      if (!this.project) return;
      this.selectedEntityUid = this.project.addEntityDef("Entity").uid;
      this.render();
    });
    root.addEnum.addEventListener("click", () => {
      if (!this.project) return;
      const def = this.project.addEnum("Enum");
      this.project.addEnumValue(def.uid);
      this.selectedEnumUid = def.uid;
      this.render();
    });
    root.entitiesList.addEventListener("click", (ev) => {
      const item = (ev.target as Element).closest<HTMLElement>("[data-uid]");
      if (!item) return;
      this.selectedEntityUid = Number(item.dataset.uid);
      this.render();
    });
    root.enumsList.addEventListener("click", (ev) => {
      const item = (ev.target as Element).closest<HTMLElement>("[data-uid]");
      if (!item) return;
      this.selectedEnumUid = Number(item.dataset.uid);
      this.render();
    });
  }

  open(project: LevelProject): void {
    this.project = project;
    this.render();
  }

  render(): void {
    const project = this.project;
    if (!project) return;
    if (!project.getEntityDef(this.selectedEntityUid ?? -1)) {
      this.selectedEntityUid = project.defs.entities[0]?.uid ?? null;
    }
    if (!project.getEnum(this.selectedEnumUid)) {
      this.selectedEnumUid = project.defs.enums[0]?.uid ?? null;
    }

    const listItem = (uid: number, name: string, meta: string, selected: boolean) => {
      const li = el("li", { textContent: name }, el("small", { textContent: meta }));
      li.dataset.uid = String(uid);
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", String(selected));
      return li;
    };

    this.root.entitiesList.replaceChildren(
      ...project.defs.entities.map((def) =>
        listItem(
          def.uid,
          def.identifier,
          `${def.width}×${def.height} · ${def.fields.length} field${def.fields.length === 1 ? "" : "s"}`,
          def.uid === this.selectedEntityUid
        )
      )
    );
    if (project.defs.entities.length === 0) {
      this.root.entitiesList.append(
        el("li", { className: "empty", textContent: "No entities yet." })
      );
    }
    const entity = project.getEntityDef(this.selectedEntityUid ?? -1);
    this.root.entityEditor.replaceChildren(...(entity ? this.entityEditor(project, entity) : []));

    this.root.enumsList.replaceChildren(
      ...project.defs.enums.map((def) =>
        listItem(
          def.uid,
          def.identifier,
          `${def.values.length} value${def.values.length === 1 ? "" : "s"}`,
          def.uid === this.selectedEnumUid
        )
      )
    );
    if (project.defs.enums.length === 0) {
      this.root.enumsList.append(el("li", { className: "empty", textContent: "No enums yet." }));
    }
    const enumDef = project.getEnum(this.selectedEnumUid);
    this.root.enumEditor.replaceChildren(...(enumDef ? this.enumEditor(project, enumDef) : []));
  }

  // ------------------------------------------------------------------ entities

  private entityEditor(project: LevelProject, def: EntityDef): HTMLElement[] {
    const update = (patch: Partial<Omit<EntityDef, "uid" | "fields">>) => {
      project.updateEntityDef(def.uid, patch);
      this.render();
    };

    const name = el("input", { className: "input", value: def.identifier, spellcheck: false });
    name.addEventListener("change", () => update({ identifier: name.value }));

    const color = el("input", { type: "color", value: def.color });
    color.addEventListener("change", () => update({ color: color.value }));

    const int = (value: number, min: number, onChange: (v: number) => void) => {
      const input = el("input", {
        className: "input",
        type: "number",
        min: String(min),
        step: "1",
        value: fieldText(value),
      });
      input.addEventListener("change", () => {
        const v = Number(input.value);
        if (Number.isInteger(v) && v >= min) onChange(v);
        else this.render();
      });
      return input;
    };

    const shape = el("select", { className: "input" });
    for (const s of ENTITY_SHAPES) {
      shape.append(new Option(s[0].toUpperCase() + s.slice(1), s, false, s === def.shape));
    }
    shape.addEventListener("change", () => {
      const next = shape.value as EntityShape;
      const tileset = project.defs.tilesets[0];
      if (next === "tile" && !def.tile && tileset) {
        update({ shape: next, tile: { tilesetUid: tileset.uid, tileId: 0 } });
      } else {
        update({ shape: next });
      }
    });
    if (project.defs.tilesets.length === 0) {
      shape.querySelector<HTMLOptionElement>('option[value="tile"]')!.disabled = true;
    }

    const pivot = el("select", { className: "input" });
    for (const [i, p] of PIVOTS.entries()) {
      pivot.append(new Option(p.label, String(i), false, p.x === def.pivotX && p.y === def.pivotY));
    }
    pivot.addEventListener("change", () => {
      const p = PIVOTS[Number(pivot.value)];
      update({ pivotX: p.x, pivotY: p.y });
    });

    const parts: HTMLElement[] = [
      field("Identifier (used as the export id)", name),
      el(
        "div",
        { className: "tileset-fields" },
        field(
          "Width (px)",
          int(def.width, 1, (v) => update({ width: v }))
        ),
        field(
          "Height (px)",
          int(def.height, 1, (v) => update({ height: v }))
        ),
        field("Colour", color)
      ),
      el(
        "div",
        { className: "tileset-fields" },
        field("Shape", shape),
        field("Pivot", pivot),
        field(
          "Max per level (0 = any)",
          int(def.maxPerLevel, 0, (v) => update({ maxPerLevel: v }))
        )
      ),
    ];

    if (def.shape === "tile" && def.tile) {
      const tile = def.tile;
      const tilesetSelect = el("select", { className: "input" });
      for (const t of project.defs.tilesets) {
        tilesetSelect.append(
          new Option(t.identifier, String(t.uid), false, t.uid === tile.tilesetUid)
        );
      }
      tilesetSelect.addEventListener("change", () =>
        update({ tile: { tilesetUid: Number(tilesetSelect.value), tileId: 0 } })
      );
      const tileset = project.getTileset(tile.tilesetUid);
      const columns = tileset ? tilesetGrid(tileset).columns : 0;
      this.tilePick = { entityUid: def.uid, tilesetUid: tile.tilesetUid };
      this.tilePicker.render(
        project,
        tileset,
        columns
          ? { x: tile.tileId % columns, y: Math.floor(tile.tileId / columns), width: 1, height: 1 }
          : null
      );
      parts.push(
        field("Tileset", tilesetSelect),
        el("span", { className: "label", textContent: `Tile #${tile.tileId} (click to choose)` }),
        this.tilePickerHost
      );
    }

    parts.push(
      el("span", { className: "label", textContent: "Fields" }),
      this.fieldsTable(project, def)
    );

    const typeSelect = el("select", { className: "input input-small" });
    for (const t of FIELD_TYPES) typeSelect.append(new Option(t, t));
    const addField = el("button", { className: "btn btn-small", textContent: "+ Field" });
    addField.addEventListener("click", () => {
      project.addField(def.uid, typeSelect.value as FieldType);
      this.render();
    });

    const instances = project.countEntities(def.uid);
    const remove = el("button", {
      className: "btn btn-small btn-danger",
      textContent: "Delete entity",
    });
    remove.addEventListener("click", () => {
      const message = instances
        ? `Delete "${def.identifier}" and its ${instances} placed instance(s) in every level? Ctrl+Z undoes it.`
        : `Delete "${def.identifier}"?`;
      if (!this.hooks.confirm(message)) return;
      project.removeEntityDef(def.uid);
      this.render();
    });

    parts.push(
      el(
        "div",
        { className: "def-editor-footer" },
        el("span", { className: "button-row" }, typeSelect, addField),
        remove
      )
    );
    return parts;
  }

  private fieldsTable(project: LevelProject, def: EntityDef): HTMLElement {
    const table = el("div", { className: "fields-table" });
    if (def.fields.length === 0) {
      table.append(
        el("p", {
          className: "hint",
          textContent: "No fields. Fields hold per-instance data, like a ghost's colour.",
        })
      );
      return table;
    }
    for (const f of def.fields) {
      const update = (patch: Partial<Omit<FieldDef, "uid" | "type">>) => {
        project.updateField(def.uid, f.uid, patch);
        this.render();
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

      const remove = el("button", {
        className: "btn btn-icon btn-danger",
        textContent: "✕",
        title: `Remove field ${f.identifier}`,
      });
      remove.setAttribute("aria-label", remove.title);
      remove.addEventListener("click", () => {
        if (
          !this.hooks.confirm(`Remove field "${f.identifier}" and its values? Ctrl+Z undoes it.`)
        ) {
          return;
        }
        project.removeField(def.uid, f.uid);
        this.render();
      });

      table.append(
        el(
          "div",
          { className: "field-row" },
          el("span", { className: "field-type", textContent: f.type }),
          name,
          this.defaultEditor(project, f, (value) => update({ defaultValue: value })),
          ...extras,
          remove
        )
      );
    }
    return table;
  }

  /** Editor for a field's default value. */
  private defaultEditor(
    project: LevelProject,
    f: FieldDef,
    onChange: (value: FieldValue) => void
  ): HTMLElement {
    const value = f.defaultValue;
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
        return el("span", { className: "hint", textContent: "default: not set" });
    }
  }

  // ------------------------------------------------------------------ enums

  private enumEditor(project: LevelProject, def: EnumDef): HTMLElement[] {
    const name = el("input", { className: "input", value: def.identifier, spellcheck: false });
    name.addEventListener("change", () => {
      project.renameEnum(def.uid, name.value);
      this.render();
    });

    const table = el("div", { className: "values-table" });
    for (const value of def.values) {
      const id = el("input", { className: "input", value: value.id, spellcheck: false });
      id.setAttribute("aria-label", "Value id");
      id.addEventListener("change", () => {
        project.updateEnumValue(def.uid, value.id, { id: id.value });
        this.render();
      });
      const color = el("input", { type: "color", value: value.color });
      color.setAttribute("aria-label", `Colour of ${value.id}`);
      color.addEventListener("change", () =>
        project.updateEnumValue(def.uid, value.id, { color: color.value })
      );
      const remove = el("button", {
        className: "btn btn-icon btn-danger",
        textContent: "✕",
        title: `Remove ${value.id}`,
      });
      remove.setAttribute("aria-label", remove.title);
      remove.addEventListener("click", () => {
        if (
          !this.hooks.confirm(`Remove "${value.id}"? Entities using it fall back to the default.`)
        ) {
          return;
        }
        project.removeEnumValue(def.uid, value.id);
        this.render();
      });
      table.append(el("div", { className: "value-row enum-row" }, id, color, remove));
    }

    const addValue = el("button", { className: "btn btn-small", textContent: "+ Value" });
    addValue.addEventListener("click", () => {
      project.addEnumValue(def.uid);
      this.render();
    });
    const remove = el("button", {
      className: "btn btn-small btn-danger",
      textContent: "Delete enum",
    });
    remove.addEventListener("click", () => {
      if (
        !this.hooks.confirm(`Delete enum "${def.identifier}"? Fields using it lose their values.`)
      ) {
        return;
      }
      project.removeEnum(def.uid);
      this.render();
    });

    return [
      field("Identifier", name),
      el("span", { className: "label", textContent: "Values" }),
      table,
      el("div", { className: "def-editor-footer" }, addValue, remove),
    ];
  }
}
