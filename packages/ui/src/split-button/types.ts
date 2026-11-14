export const SplitButtonEvents = {
  /** The main button was pressed, or an option was picked (which also runs it). */
  Action: "split-action",
} as const;

export type SplitButtonEventPayloads = {
  /** `value` of the option that runs. */
  [SplitButtonEvents.Action]: { value: string };
};

export type SplitButtonEventMap = HTMLElementEventMap & {
  [K in keyof SplitButtonEventPayloads]: CustomEvent<SplitButtonEventPayloads[K]>;
};
