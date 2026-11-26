import { el, fieldRow as labelledRow } from "@gs2d/ui";
import type { Level, LevelProject } from "../model/LevelProject";
import {
  fieldText,
  initialDefault,
  isEntityRef,
  isPoint,
  valueList,
  withEntry,
} from "../model/entities";
import type { EntityRef, FieldDef, FieldScalar, FieldValue } from "../model/types";

/** Picking a value on the canvas (a cell for Point fields, an entity for EntityRef fields). */
export interface CanvasPick {
  /** Entry being picked (0 for single values; arrays: the index, length to append), or null. */
  activeIndex: number | null;
  start(index: number): void;
  cancel(): void;
}

export interface FieldInputOptions {
  project: LevelProject;
  field: FieldDef;
  /** The current value (already resolved to the default when unset). */
  value: FieldValue;
  /** Commits a new value (one undo step on the caller's side). */
  set(next: FieldValue): void;
  /** The level the value belongs to: EntityRef choices list its entities first. */
  level: Level;
  /** The entity holding the value, left out of EntityRef choices. */
  selfIid?: string;
  /** Point and EntityRef fields: pick on the canvas. Without it, Points are typed as x/y. */
  pick?: CanvasPick;
}

/**
 * The input for one field value, by field type: number, checkbox, text,
 * colour, enum select, a cell for Point fields, an entity for EntityRef
 * fields, or a list of these for array fields. Shared by the entity
 * inspector and the level panel. Values commit on "change", not on every
 * keystroke.
 */
export function fieldInput(options: FieldInputOptions): HTMLElement {
  const { field, value, set } = options;
  if (field.isArray) return arrayInput(options);

  const controls = scalarControls(options, value as FieldScalar | null, (next) => set(next), 0);
  if (field.type === "Bool") {
    return el(
      "label",
      { className: "field inline checkbox-field" },
      ...controls,
      el("span", { className: "label", textContent: field.identifier })
    );
  }
  if (field.type === "Point" || field.type === "EntityRef" || field.type === "Enum") {
    // Single values of these types can be "not set".
    if (field.type !== "Enum") {
      const clear = el("button", { className: "btn btn-small", textContent: "Clear" });
      clear.disabled = value === null;
      clear.addEventListener("click", () => set(null));
      controls.push(clear);
    }
  }
  return labelledRow(label(field), ...controls);
}

const label = (field: FieldDef) =>
  field.type === "Point" ? `${field.identifier} (cell)` : field.identifier;

/** A list field: one row per entry with a remove button, and a way to add one. */
function arrayInput(options: FieldInputOptions): HTMLElement {
  const { project, field, value, set, pick } = options;
  const list = valueList(value);
  const setEntry = (index: number, next: FieldScalar | null) =>
    set(withEntry(field, value, index, next));

  const rows = list.map((entry, index) => {
    const remove = el("button", {
      className: "btn btn-icon btn-small",
      textContent: "✕",
      title: `Remove ${field.identifier}[${index}]`,
    });
    remove.setAttribute("aria-label", remove.title);
    remove.addEventListener("click", () => setEntry(index, null));
    return el(
      "div",
      { className: "array-entry" },
      el("span", { className: "array-index", textContent: String(index) }),
      ...scalarControls(options, entry, (next) => setEntry(index, next), index),
      remove
    );
  });

  const adders: HTMLElement[] = [];
  const end = list.length;
  if (field.type === "EntityRef") {
    const select = entitySelect(options, null, "+ Add entity…");
    select.addEventListener("change", () => {
      const ref = parseRef(select.value);
      if (ref) setEntry(end, ref);
    });
    adders.push(select);
  }
  if ((field.type === "Point" || field.type === "EntityRef") && pick) {
    adders.push(pickButton(pick, end, field.type === "Point" ? "+ Pick cell" : "+ Pick"));
  } else if (field.type !== "EntityRef") {
    const add = el("button", { className: "btn btn-small", textContent: "+ Add" });
    const initial =
      field.type === "Point"
        ? { x: 0, y: 0 }
        : (initialDefault(field.type, project.getEnum(field.enumUid)) as FieldScalar | null);
    add.disabled = initial === null;
    add.addEventListener("click", () => {
      if (initial !== null) setEntry(end, initial);
    });
    adders.push(add);
  }

  return el(
    "div",
    { className: "field array-field" },
    el("span", { className: "label", textContent: `${label(field)} · ${list.length}` }),
    ...rows,
    el("div", { className: "button-row" }, ...adders)
  );
}

/** The controls for one value (no label). */
function scalarControls(
  options: FieldInputOptions,
  value: FieldScalar | null,
  set: (next: FieldScalar | null) => void,
  index: number
): HTMLElement[] {
  const { project, field, pick } = options;
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
      input.setAttribute("aria-label", field.identifier);
      input.addEventListener("change", () => {
        const n = Number(input.value);
        if (input.value.trim() !== "" && Number.isFinite(n)) set(n);
        else input.value = fieldText(value);
      });
      return [input];
    }
    case "Bool": {
      const input = el("input", { type: "checkbox", checked: value === true });
      input.addEventListener("change", () => set(input.checked));
      return [input];
    }
    case "String": {
      const input = el("input", { className: "input", value: fieldText(value) });
      input.setAttribute("aria-label", field.identifier);
      input.addEventListener("change", () => set(input.value));
      return [input];
    }
    case "Color": {
      const input = el("input", { type: "color", value: fieldText(value) });
      input.setAttribute("aria-label", field.identifier);
      input.addEventListener("change", () => set(input.value));
      return [input];
    }
    case "Enum": {
      const enumDef = project.getEnum(field.enumUid);
      const select = el("select", { className: "input" });
      if (!field.isArray) select.append(new Option("— none —", ""));
      for (const v of enumDef?.values ?? []) {
        select.append(new Option(v.id, v.id, false, v.id === value));
      }
      select.disabled = !enumDef;
      select.setAttribute("aria-label", field.identifier);
      select.addEventListener("change", () => set(select.value || null));
      return [select];
    }
    case "Point": {
      const point = isPoint(value) ? value : null;
      if (pick) {
        return [
          el("span", {
            className: "point-value",
            textContent: point ? `${point.x}, ${point.y}` : "not set",
          }),
          pickButton(pick, index, "Pick"),
        ];
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
      return [coordinate("x"), coordinate("y")];
    }
    case "EntityRef": {
      const ref = isEntityRef(value) ? value : null;
      const select = entitySelect(options, ref, "— none —");
      select.addEventListener("change", () => set(parseRef(select.value)));
      return pick ? [select, pickButton(pick, index, "Pick")] : [select];
    }
  }
}

function pickButton(pick: CanvasPick, index: number, text: string): HTMLButtonElement {
  const active = pick.activeIndex === index;
  const button = el("button", {
    className: `btn btn-small${active ? " active" : ""}`,
    textContent: active ? "Click on the level…" : text,
    title: "Pick on the level (Esc cancels)",
  });
  button.addEventListener("click", () => (active ? pick.cancel() : pick.start(index)));
  return button;
}

const refKey = (ref: EntityRef) => `${ref.levelUid}:${ref.entityIid}`;

function parseRef(key: string): EntityRef | null {
  const sep = key.indexOf(":");
  if (sep <= 0) return null;
  return { levelUid: Number(key.slice(0, sep)), entityIid: key.slice(sep + 1) };
}

/**
 * Entities a reference can point at, grouped by level (the value's own
 * level first), limited to the field's entity type. A reference to a
 * deleted entity shows as "missing".
 */
function entitySelect(
  { project, field, level, selfIid }: FieldInputOptions,
  current: EntityRef | null,
  emptyLabel: string
): HTMLSelectElement {
  const select = el("select", { className: "input entity-ref-select" });
  select.setAttribute("aria-label", field.identifier);
  select.append(new Option(emptyLabel, ""));
  if (current && !project.findEntity(current)) {
    select.append(new Option("⚠ missing entity", refKey(current), false, true));
  }
  const levels = [level, ...project.levels.filter((l) => l !== level)];
  for (const l of levels) {
    const candidates = l.entities.filter(
      (e) =>
        e.iid !== selfIid &&
        (field.refDefUid == null || e.defUid === field.refDefUid) &&
        project.getEntityDef(e.defUid)
    );
    if (candidates.length === 0) continue;
    const group = el("optgroup", {
      label: l === level ? `${l.identifier} (this level)` : l.identifier,
    });
    for (const e of candidates) {
      const def = project.getEntityDef(e.defUid)!;
      const cx = Math.floor(e.x / project.gridSize);
      const cy = Math.floor(e.y / project.gridSize);
      const key = refKey({ levelUid: l.uid, entityIid: e.iid });
      group.append(
        new Option(
          `${def.identifier} at ${cx}, ${cy}`,
          key,
          false,
          current !== null && refKey(current) === key
        )
      );
    }
    select.append(group);
  }
  if (!current) select.value = "";
  return select;
}
