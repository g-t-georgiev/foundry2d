import { describe, it, expect, vi } from "vitest";
import { Store, defineAction } from "../src";

type AppState = { user: { id: string; name: string } | null; counter: number };

const incrementSchema = {
  type: "object",
  properties: { amount: { type: "number" } },
  required: ["amount"],
  additionalProperties: false,
} as const;

const increment = defineAction<AppState, "counter/increment", typeof incrementSchema>(
  "counter/increment",
  {
    schema: incrementSchema,
    reducer: (state, payload: { amount: number }) => {
      state.counter += payload.amount;
    },
  }
);

describe("store", () => {
  it("mutates state safely using immer and validates payloads", () => {
    const store = new Store<AppState>({
      initialState: { user: null, counter: 0 },
      actions: [increment],
    });

    // Valid Dispatch
    store.dispatch("counter/increment", { amount: 5 });
    expect(store.getState().counter).toBe(5);

    // Invalid Dispatch (Validation Error)
    expect(() => {
      store.dispatch("counter/increment", { amount: "five" });
    }).toThrow(/Invalid payload/);

    // State should remain unchanged after failed validation
    expect(store.getState().counter).toBe(5);
  });

  it("triggers select listeners only when the specific slice changes", () => {
    const store = new Store<AppState>({
      initialState: { user: null, counter: 0 },
      actions: [increment],
    });

    const userMock = vi.fn();
    store.select((s) => s.user, userMock);

    // Change counter. The user selector should NOT fire.
    store.dispatch("counter/increment", { amount: 1 });
    expect(userMock).not.toHaveBeenCalled();
  });
});
