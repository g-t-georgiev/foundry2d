import type { FromSchema, JSONSchema } from "json-schema-to-ts";

export type ActionDefinition<State, Type extends string, Schema extends JSONSchema> = {
  type: Type;
  schema?: Schema;
  reducer?: (state: State, payload: FromSchema<Schema>) => void;
  effect?: (event: StoreEvent<State, Type, FromSchema<Schema>>) => void;
};

// Simplified constraint used internally by Store maps.
// `any` is used intentionally here for type erasure across heterogeneous action types.
export type ActionConstraint<State> = {
  type: string;
  schema?: JSONSchema;
  // oxlint-disable-next-line @typescript-eslint/no-explicit-any
  reducer?: (state: State, payload: any) => void;
  // oxlint-disable-next-line @typescript-eslint/no-explicit-any
  effect?: (event: StoreEvent<State, string, any>) => void;
};

export type StoreEvent<State, Type extends string, Payload> = {
  type: Type;
  payload: Payload;
  state: State;
  previousState: State;
};

export type Subscriber<State> = (state: State, previousState: State) => void;

export type ActionListener<State, Type extends string = string, Payload = unknown> = (
  event: StoreEvent<State, Type, Payload>
) => void;
