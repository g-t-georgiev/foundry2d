import type { FromSchema, JSONSchema } from "json-schema-to-ts";

export interface ActionDefinition<
  State,
  Type extends string,
  Schema extends JSONSchema = JSONSchema,
> {
  type: Type;
  schema?: Schema;
  reducer?(state: State, payload: FromSchema<Schema>): void;
  effect?(event: StoreEvent<State, Type, FromSchema<Schema>>): void;
}

export interface ActionConstraint<State> {
  type: string;
  schema?: JSONSchema;
  reducer?(state: State, payload: unknown): void;
  effect?(event: StoreEvent<State, string, unknown>): void;
}

export interface StoreEvent<State, Type extends string, Payload> {
  type: Type;
  payload: Payload;
  state: State;
  previousState: State;
}

export type Subscriber<State> = (state: State, previousState: State) => void;

export type ActionListener<State, Type extends string = string, Payload = unknown> = (
  event: StoreEvent<State, Type, Payload>
) => void;
