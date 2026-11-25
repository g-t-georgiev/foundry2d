import { collectShortcuts, type Shortcut, type ShortcutInfo } from "./shortcuts";

export type KeyHandler = (event: KeyboardEvent) => void | boolean;

export interface KeyBinding {
  /** e.g. "mod+z", "mod+shift+z", "b", "alt", "escape", "+" */
  combo: string;
  handler: KeyHandler;
  /** Fire on key repeat as well. Defaults to `false`. */
  repeat?: boolean;
  /**
   * Also fire while the user types into a form field (e.g. Save). The field
   * is left first, so it commits its value. Defaults to `false`.
   */
  whileTyping?: boolean;
}

/** Options of `Keymap.bind`; a label and group put the binding in the manual. */
export interface BindOptions extends Partial<ShortcutInfo> {
  repeat?: boolean;
  whileTyping?: boolean;
}

export interface ParsedCombo {
  key: string;
  mod: boolean;
  shift: boolean;
  alt: boolean;
}

const SHIFT_SENSITIVE = /^([a-z0-9]|[a-z]{2,}\d*)$/;

const isMacPlatform = (): boolean =>
  typeof navigator !== "undefined" && /mac|iphone|ipad/i.test(navigator.platform);

/** Normalizes `KeyboardEvent.key` to the lowercase names used in combos. */
export function normalizeKey(key: string): string {
  if (key === " ") return "space";
  return key.toLowerCase();
}

export function parseCombo(combo: string): ParsedCombo {
  const parts = combo.toLowerCase().split("+");
  // Support binding the "+" key itself, e.g. "mod++" or "+".
  let key = parts.pop() ?? "";
  if (key === "" && combo.endsWith("+")) {
    key = "+";
    parts.pop();
  }
  return {
    key,
    mod: parts.includes("mod") || parts.includes("ctrl") || parts.includes("cmd"),
    shift: parts.includes("shift"),
    alt: parts.includes("alt"),
  };
}

/**
 * Keyboard shortcut registry. "mod" means Cmd on macOS and Ctrl elsewhere.
 * Bindings are ignored while the user types into a form field, unless they
 * are `whileTyping`. Dropdowns only keep plain keys (type-ahead) to themselves.
 */
export class Keymap {
  private bindings: { parsed: ParsedCombo; binding: KeyBinding }[] = [];
  private holds: { key: string; onPress: () => void; onRelease: () => void; held: boolean }[] = [];
  /** Every labelled key, in the order bound (also keys handled outside the keymap). */
  private described: ({ combo: string } & ShortcutInfo)[] = [];
  private readonly isMac = isMacPlatform();

  bind(combo: string, handler: KeyHandler, options: BindOptions = {}): () => void {
    const { label, group, ...rest } = options;
    const entry = { parsed: parseCombo(combo), binding: { combo, handler, ...rest } };
    this.bindings.push(entry);
    if (label && group) this.describe(combo, { label, group });
    return () => {
      this.bindings = this.bindings.filter((b) => b !== entry);
    };
  }

  /**
   * Lists a key in the manual that something else handles (a list's own
   * key handler, the browser's paste event).
   */
  describe(combo: string, info: ShortcutInfo): void {
    this.described.push({ combo, ...info });
  }

  /** The labelled shortcuts, one row per action. */
  shortcuts(): Shortcut[] {
    return collectShortcuts(this.described);
  }

  /** Dispatches a keydown. Returns `true` when a binding handled it. */
  handle(event: KeyboardEvent): boolean {
    const key = normalizeKey(event.key);
    const mod = this.isMac ? event.metaKey : event.ctrlKey;
    const typing = isTypingTarget(event.target) && !(mod && isSelect(event.target));

    // Prefer the most specific match (most modifiers).
    const matches = this.bindings
      .filter(({ parsed, binding }) => {
        if (typing && !binding.whileTyping) return false;
        if (parsed.key !== key) return false;
        if (parsed.mod !== mod) return false;
        if (parsed.alt !== event.altKey) return false;
        if (parsed.shift) return event.shiftKey;
        // Symbols such as "+" or "?" need Shift on many layouts, so an
        // undeclared Shift only disqualifies letters, digits and named keys.
        return !event.shiftKey || !SHIFT_SENSITIVE.test(parsed.key);
      })
      .sort((a, b) => Number(b.parsed.shift) - Number(a.parsed.shift));

    for (const { binding } of matches) {
      if (event.repeat && !binding.repeat) return true;
      // Leaving the field fires its "change", so the handler sees the new value.
      if (typing) (event.target as HTMLElement).blur();
      if (binding.handler(event) === false) continue;
      event.preventDefault();
      return true;
    }
    return false;
  }

  /**
   * Binds a key that is held down, e.g. Alt for a temporary eyedropper.
   * `onRelease` also fires when the window loses focus while held.
   */
  hold(key: string, onPress: () => void, onRelease: () => void, info?: ShortcutInfo): () => void {
    if (info) this.describe(`hold ${key}`, info);
    const entry = { key: normalizeKey(key), onPress, onRelease, held: false };
    this.holds.push(entry);
    return () => {
      this.holds = this.holds.filter((h) => h !== entry);
    };
  }

  handleKeyDown(event: KeyboardEvent): boolean {
    if (isTypingTarget(event.target)) return this.handle(event);
    const key = normalizeKey(event.key);
    let handled = false;
    for (const hold of this.holds) {
      if (hold.key !== key) continue;
      handled = true;
      if (!hold.held) {
        hold.held = true;
        hold.onPress();
      }
    }
    if (handled) {
      event.preventDefault();
      return true;
    }
    return this.handle(event);
  }

  handleKeyUp(event: KeyboardEvent): void {
    const key = normalizeKey(event.key);
    for (const hold of this.holds) {
      if (hold.key === key && hold.held) {
        hold.held = false;
        hold.onRelease();
      }
    }
  }

  /** Releases every held key (used on window blur). */
  releaseAll(): void {
    for (const hold of this.holds) {
      if (hold.held) {
        hold.held = false;
        hold.onRelease();
      }
    }
  }

  clear(): void {
    this.bindings = [];
    this.holds = [];
    this.described = [];
  }
}

const isSelect = (target: EventTarget | null) =>
  typeof HTMLSelectElement !== "undefined" && target instanceof HTMLSelectElement;

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!target || typeof HTMLElement === "undefined" || !(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") {
    const type = (target as HTMLInputElement).type;
    return !["checkbox", "radio", "button", "range", "color"].includes(type);
  }
  return false;
}
