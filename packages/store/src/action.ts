import type { JSONSchema } from "json-schema-to-ts";
import type { ActionDefinition, ActionConstraint } from "./types";

export function defineAction<State, Type extends string, Schema extends JSONSchema>(
  type: Type,
  config: Omit<ActionDefinition<State, Type, Schema>, "type">
) {
  return {
    type,
    ...config,
  } as unknown as ActionConstraint<State>;
}
