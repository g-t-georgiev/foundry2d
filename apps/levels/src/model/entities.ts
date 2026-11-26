import type { Rect } from "@gs2d/core";
import type {
  EntityDef,
  EntityInstance,
  EntityRef,
  EnumDef,
  FieldDef,
  FieldScalar,
  FieldType,
  FieldValue,
  GridPoint,
} from "./types";

let fallbackCounter = 0;

/** A new unique instance id (UUID where available). */
export function newIid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  fallbackCounter++;
  return `e-${Date.now().toString(36)}-${fallbackCounter.toString(36)}`;
}

const HEX = /^#[0-9a-f]{6}$/i;

export const isHexColor = (v: unknown): v is string => typeof v === "string" && HEX.test(v);

export const isPoint = (v: unknown): v is GridPoint =>
  typeof v === "object" &&
  v !== null &&
  Number.isInteger((v as GridPoint).x) &&
  Number.isInteger((v as GridPoint).y);

export const isEntityRef = (v: unknown): v is EntityRef =>
  typeof v === "object" &&
  v !== null &&
  typeof (v as EntityRef).entityIid === "string" &&
  (v as EntityRef).entityIid !== "" &&
  Number.isInteger((v as EntityRef).levelUid);

/** Sensible default for a new field of `type`. */
export function initialDefault(type: FieldType, enumDef?: EnumDef): FieldValue {
  switch (type) {
    case "Int":
    case "Float":
      return 0;
    case "Bool":
      return false;
    case "String":
      return "";
    case "Color":
      return "#ffffff";
    case "Enum":
      return enumDef?.values[0]?.id ?? null;
    case "Point":
    case "EntityRef":
      return null;
  }
}

/** Default for a new or reset field: an empty list for arrays, else by type. */
export function defaultFor(field: FieldDef, enumDef?: EnumDef): FieldValue {
  return field.isArray ? [] : initialDefault(field.type, enumDef);
}

/** The values of a field as a list (one value, none, or the array itself). */
export function valueList(value: FieldValue): FieldScalar[] {
  if (Array.isArray(value)) return value;
  return value === null ? [] : [value];
}

/** Applies `fn` to each scalar of a value (one value or every array entry). */
export function mapScalars(value: FieldValue, fn: (v: FieldScalar) => FieldScalar): FieldValue {
  if (Array.isArray(value)) return value.map(fn);
  return value === null ? null : fn(value);
}

/**
 * The value with entry `index` set to `next` (arrays; an index past the end
 * appends, `null` removes the entry), or `next` itself for single values.
 */
export function withEntry(
  field: FieldDef,
  value: FieldValue,
  index: number,
  next: FieldScalar | null
): FieldValue {
  if (!field.isArray) return next;
  const list = [...valueList(value)];
  if (next === null) list.splice(index, 1);
  else list[Math.min(index, list.length)] = next;
  return list;
}

/**
 * Returns `value` if it is valid for `field`, otherwise `undefined`.
 * Numbers are clamped to min/max and Ints are rounded.
 */
export function validateFieldValue(
  field: FieldDef,
  value: unknown,
  enums: readonly EnumDef[]
): FieldValue | undefined {
  if (field.isArray) {
    if (!Array.isArray(value)) return undefined;
    return value.flatMap((entry) => {
      const valid = validateScalar(field, entry, enums);
      return valid === undefined || valid === null ? [] : [valid];
    });
  }
  return Array.isArray(value) ? undefined : validateScalar(field, value, enums);
}

/** One value checked against the field type (see `validateFieldValue`). */
function validateScalar(
  field: FieldDef,
  value: unknown,
  enums: readonly EnumDef[]
): FieldScalar | null | undefined {
  switch (field.type) {
    case "Int":
    case "Float": {
      if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
      let n = field.type === "Int" ? Math.round(value) : value;
      if (typeof field.min === "number") n = Math.max(field.min, n);
      if (typeof field.max === "number") n = Math.min(field.max, n);
      return n;
    }
    case "Bool":
      return typeof value === "boolean" ? value : undefined;
    case "String":
      return typeof value === "string" ? value : undefined;
    case "Color":
      return isHexColor(value) ? value.toLowerCase() : undefined;
    case "Enum": {
      if (value === null) return null;
      const enumDef = enums.find((e) => e.uid === field.enumUid);
      return typeof value === "string" && enumDef?.values.some((v) => v.id === value)
        ? value
        : undefined;
    }
    case "Point":
      return value === null ? null : isPoint(value) ? { x: value.x, y: value.y } : undefined;
    case "EntityRef":
      return value === null
        ? null
        : isEntityRef(value)
          ? { entityIid: value.entityIid, levelUid: value.levelUid }
          : undefined;
  }
}

/** The value of `field` on `instance`, falling back to the field default. */
export function fieldValue(
  instance: Pick<EntityInstance, "fields">,
  field: FieldDef,
  enums: readonly EnumDef[]
): FieldValue {
  const stored = instance.fields[String(field.uid)];
  if (stored !== undefined) {
    const valid = validateFieldValue(field, stored, enums);
    if (valid !== undefined) return valid;
  }
  return validateFieldValue(field, field.defaultValue, enums) ?? defaultFor(field);
}

/** The instance's bounding box in level pixels (position is the pivot point). */
export function entityRect(def: EntityDef, instance: Pick<EntityInstance, "x" | "y">): Rect {
  return {
    x: instance.x - def.width * def.pivotX,
    y: instance.y - def.height * def.pivotY,
    width: def.width,
    height: def.height,
  };
}

/**
 * Position for an entity dropped on `cell`: the pivot sits at the same
 * relative spot inside the cell, so a centred 8×8 entity fills the cell.
 */
export function snapToCell(def: EntityDef, cellX: number, cellY: number, gridSize: number) {
  return {
    x: Math.round(cellX * gridSize + def.pivotX * gridSize),
    y: Math.round(cellY * gridSize + def.pivotY * gridSize),
  };
}

/** Deep copy of an instance, optionally with a new id. */
export function cloneInstance(instance: EntityInstance, iid = instance.iid): EntityInstance {
  return { ...instance, iid, fields: structuredClone(instance.fields) };
}

/** A scalar field value as input text (`""` for null and Point values). */
export function fieldText(value: FieldValue): string {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? String(value)
    : "";
}
