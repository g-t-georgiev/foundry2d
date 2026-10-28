import type { JSONSchema } from "json-schema-to-ts";
import type { ActionDefinition } from "./types";

export function defineAction<State, Type extends string, Schema extends JSONSchema>(
  type: Type,
  config: Omit<ActionDefinition<State, Type, Schema>, "type">
): ActionDefinition<State, Type, Schema> {
  return {
    type,
    ...config,
  };
}
