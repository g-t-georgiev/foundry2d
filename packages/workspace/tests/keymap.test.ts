import { describe, it, expect, vi } from "vite-plus/test";
import { Keymap, parseCombo } from "../src/Keymap";
import { niceStep } from "@gs2d/render";

const key = (k: string, mods: Partial<KeyboardEvent> = {}) =>
  ({
    key: k,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    repeat: false,
    target: null,
    preventDefault: vi.fn(),
    ...mods,
  }) as unknown as KeyboardEvent;

describe("Keymap", () => {
  it("parses combos including the plus key", () => {
    expect(parseCombo("mod+shift+z")).toEqual({ key: "z", mod: true, shift: true, alt: false });
    expect(parseCombo("+")).toMatchObject({ key: "+", mod: false });
    expect(parseCombo("mod++")).toMatchObject({ key: "+", mod: true });
  });

  it("prefers the more specific shift binding", () => {
    const keymap = new Keymap();
    const undo = vi.fn();
    const redo = vi.fn();
    keymap.bind("mod+z", undo);
    keymap.bind("mod+shift+z", redo);
    keymap.handle(key("Z", { ctrlKey: true, metaKey: true, shiftKey: true }));
    expect(redo).toHaveBeenCalledOnce();
    expect(undo).not.toHaveBeenCalled();
  });

  it("does not fire a plain letter binding while shift is held", () => {
    const keymap = new Keymap();
    const pen = vi.fn();
    keymap.bind("b", pen);
    expect(keymap.handle(key("B", { shiftKey: true }))).toBe(false);
    expect(keymap.handle(key("b"))).toBe(true);
    expect(pen).toHaveBeenCalledOnce();
  });

  it("tracks held keys and releases them on blur", () => {
    const keymap = new Keymap();
    const press = vi.fn();
    const release = vi.fn();
    keymap.hold("alt", press, release);
    keymap.handleKeyDown(key("Alt", { altKey: true }));
    keymap.handleKeyDown(key("Alt", { altKey: true, repeat: true }));
    expect(press).toHaveBeenCalledOnce();
    keymap.releaseAll();
    expect(release).toHaveBeenCalledOnce();
  });
});

describe("niceStep", () => {
  it("rounds to 1/2/5 steps", () => {
    expect(niceStep(0.7)).toBe(1);
    expect(niceStep(13)).toBe(20);
    expect(niceStep(40)).toBe(50);
    expect(niceStep(70)).toBe(100);
  });
});

describe("rulerScale (item 47)", () => {
  it("never ticks between whole units", async () => {
    const { rulerScale } = await import("@gs2d/render");
    for (const px of [0.3, 1, 2.59 * 8, 7, 13, 40, 120, 400]) {
      for (const kind of ["binary", "decimal"] as const) {
        const { step, tick } = rulerScale(px, kind);
        expect(Number.isInteger(tick)).toBe(true);
        expect(tick).toBeGreaterThanOrEqual(1);
        expect(step % tick).toBe(0);
        expect(step * px).toBeGreaterThanOrEqual(Math.min(53, step * px));
      }
    }
  });

  it("8 px tiles at 259%: labels every 4 tiles (the grid's stronger lines), a tick per tile", async () => {
    const { rulerScale } = await import("@gs2d/render");
    expect(rulerScale(2.59 * 8, "binary")).toEqual({ step: 4, tick: 1 });
  });

  it("zoomed out, binary steps stay powers of two and decimal ones 1-2-5", async () => {
    const { rulerScale } = await import("@gs2d/render");
    expect(rulerScale(0.5, "binary")).toEqual({ step: 128, tick: 16 });
    expect(rulerScale(0.5, "decimal")).toEqual({ step: 200, tick: 10 });
    expect(rulerScale(100, "binary")).toEqual({ step: 1, tick: 1 });
  });
});
