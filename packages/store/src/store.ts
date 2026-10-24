// store.ts
import Ajv from "ajv";
import type { ErrorObject, ValidateFunction } from "ajv";
import { produce } from "immer";
import type { ActionConstraint, ActionListener, Subscriber, StoreEvent } from "./types";

/** Custom error thrown when action payload validation fails against its JSON Schema. */
export class ValidationError extends Error {
  public validationErrors?: ErrorObject[] | null;

  constructor(message: string, errors?: ErrorObject[] | null) {
    super(message);
    this.name = "ValidationError";
    this.validationErrors = errors;
    Object.setPrototypeOf(this, ValidationError.prototype);
  }
}

export default class Store<
  State,
  EventsMap extends Record<string, unknown> = Record<string, unknown>,
> {
  private state: State;
  private subscribers = new Set<Subscriber<State>>();
  private actionListeners = new Map<string, Set<ActionListener<State>>>();
  private actionsMap = new Map<string, ActionConstraint<State>>();

  private schemaValidator: Ajv | null;
  // Type the map with Ajv's ValidateFunction instead of any
  private compiledSchemas = new Map<string, ValidateFunction>();

  constructor(config: {
    initialState: State;
    actions: ActionConstraint<State>[];
    validate?: boolean;
  }) {
    this.state = config.initialState;
    this.schemaValidator = config.validate !== false ? new Ajv({ allErrors: true }) : null;

    for (const action of config.actions) {
      this.actionsMap.set(action.type, action);
      if (this.schemaValidator && action.schema) {
        this.compiledSchemas.set(action.type, this.schemaValidator.compile(action.schema));
      }
    }
  }

  dispatch<EventType extends keyof EventsMap & string>(
    type: EventType,
    ...args: EventsMap[EventType] extends undefined | void
      ? [payload?: undefined]
      : [payload: EventsMap[EventType]]
  ): StoreEvent<State, EventType, EventsMap[EventType]> {
    const payload = args[0];
    const definition = this.actionsMap.get(type);

    if (!definition) {
      throw new Error(`Unknown action type: "${type}"`);
    }

    const validator = this.compiledSchemas.get(type);
    if (validator && !validator(payload)) {
      // Strongly typed, zero 'any' casts
      throw new ValidationError(`Invalid payload for action "${type}"`, validator.errors);
    }

    const previousState = this.state;

    if (definition.reducer) {
      this.state = produce(previousState, (draft) => {
        definition.reducer!(draft as State, payload);
      });
    }

    const event: StoreEvent<State, EventType, EventsMap[EventType]> = {
      type,
      payload: payload as EventsMap[EventType],
      state: this.state,
      previousState,
    };

    if (definition.effect) {
      definition.effect(event);
    }

    const listeners = this.actionListeners.get(type);
    if (listeners) {
      for (const listener of listeners) {
        listener(event);
      }
    }

    if (this.state !== previousState) {
      for (const subscriber of this.subscribers) {
        subscriber(this.state, previousState);
      }
    }

    return event;
  }

  subscribe(listener: Subscriber<State>) {
    this.subscribers.add(listener);
    return () => this.subscribers.delete(listener);
  }

  select<Selected>(selector: (state: State) => Selected, listener: (selected: Selected) => void) {
    let currentSlice = selector(this.state);

    return this.subscribe((newState) => {
      const nextSlice = selector(newState);
      if (nextSlice !== currentSlice) {
        currentSlice = nextSlice;
        listener(currentSlice);
      }
    });
  }

  on<EventType extends keyof EventsMap & string>(
    type: EventType,
    listener: ActionListener<State, EventType, EventsMap[EventType]>
  ) {
    if (!this.actionListeners.has(type)) {
      this.actionListeners.set(type, new Set());
    }
    this.actionListeners.get(type)!.add(listener as ActionListener<State>);

    return () => this.actionListeners.get(type)!.delete(listener as ActionListener<State>);
  }

  getState = () => this.state;
}
