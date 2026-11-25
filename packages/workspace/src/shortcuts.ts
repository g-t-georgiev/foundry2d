/**
 * Shortcut descriptions for the manual. Bindings carry a label and a group
 * where they are made (`Keymap.bind`), so the hotkey tables in the docs are
 * generated from the code and can't drift from it.
 */

/** What a shortcut is shown as. */
export interface ShortcutInfo {
  /** What it does, e.g. "Undo". */
  label: string;
  /** Table section, e.g. "History and files". */
  group: string;
}

/** One table row: every key that does the same thing. */
export interface Shortcut extends ShortcutInfo {
  /** Combos as bound, e.g. ["mod+shift+z", "mod+y"]. */
  keys: string[];
}

const KEY_NAMES: Record<string, string> = {
  mod: "Ctrl",
  ctrl: "Ctrl",
  cmd: "Ctrl",
  shift: "Shift",
  alt: "Alt",
  escape: "Esc",
  delete: "Delete",
  backspace: "Backspace",
  enter: "Enter",
  space: "Space",
  arrowleft: "←",
  arrowright: "→",
  arrowup: "↑",
  arrowdown: "↓",
  "+": "+",
};

/** "mod+shift+z" → "Ctrl+Shift+Z" (Cmd on macOS, as the manual says once). */
export function formatCombo(combo: string): string {
  const parts = combo.split("+");
  // "mod++" and "+" bind the plus key itself.
  if (combo.endsWith("+")) {
    parts.splice(-2, 2, "+");
  }
  return parts
    .map((part) => {
      const lower = part.toLowerCase();
      if (lower in KEY_NAMES) return KEY_NAMES[lower];
      if (lower.startsWith("hold ")) return `Hold ${formatCombo(lower.slice(5))}`;
      return part.length === 1 ? part.toUpperCase() : part[0].toUpperCase() + part.slice(1);
    })
    .join("+");
}

/** The keys of a row as text: "Ctrl+Shift+Z, Ctrl+Y"; runs of digits become "1–9". */
export function formatKeys(keys: readonly string[]): string {
  const shown: string[] = [];
  for (let i = 0; i < keys.length; i++) {
    let j = i;
    while (
      /^\d$/.test(keys[i]) &&
      j + 1 < keys.length &&
      Number(keys[j + 1]) === Number(keys[j]) + 1
    ) {
      j++;
    }
    shown.push(j > i + 1 ? `${keys[i]}–${keys[j]}` : formatCombo(keys[i]));
    if (j > i + 1) i = j;
  }
  return shown.join(", ");
}

/** Rows for bindings with a label: one per label and group, in the order they were made. */
export function collectShortcuts(
  entries: Iterable<{ combo: string } & Partial<ShortcutInfo>>
): Shortcut[] {
  const rows: Shortcut[] = [];
  for (const { combo, label, group } of entries) {
    if (!label || !group) continue;
    const row = rows.find((r) => r.label === label && r.group === group);
    if (row) {
      if (!row.keys.includes(combo)) row.keys.push(combo);
    } else {
      rows.push({ label, group, keys: [combo] });
    }
  }
  return rows;
}

/** Mouse and keyboard navigation every canvas has (see `InputController`). */
export const CANVAS_NAVIGATION: readonly Shortcut[] = [
  { group: "Canvas", label: "Pan", keys: ["Middle-drag", "Space+drag"] },
  { group: "Canvas", label: "Zoom at the pointer", keys: ["Wheel"] },
  { group: "Canvas", label: "Pan sideways", keys: ["Shift+wheel"] },
];

/**
 * A stand-in for an app object that the key bindings only hold on to: every
 * property and call gives it back. Used to collect the bindings outside the
 * app (the manual's generator and its test), where no handler ever runs.
 */
export function inert<T>(): T {
  const target = () => proxy;
  const proxy: unknown = new Proxy(target, { get: () => proxy, apply: () => proxy });
  return proxy as T;
}

/** The generated "Keyboard shortcuts" article of an app's manual. */
export function shortcutsArticle(app: string, shortcuts: readonly Shortcut[]): string {
  return [
    "# Keyboard shortcuts",
    "",
    `<!-- Generated from the ${app}'s key bindings by \`vp run docs\`. Edit the labels in its keys.ts, not this file. -->`,
    "",
    "Ctrl means Cmd on macOS. Letter keys work while the canvas or a panel has the focus, not while you type in a field; Save, Save as, Open and Export work everywhere.",
    "",
    shortcutTables(shortcuts),
    "",
  ].join("\n");
}

const escapeCell = (text: string) => text.replace(/\|/g, "\\|");

/** Markdown tables, one per group (`### Group`), groups in first-seen order. */
export function shortcutTables(shortcuts: readonly Shortcut[]): string {
  const groups = [...new Set(shortcuts.map((s) => s.group))];
  return groups
    .map((group) => {
      const rows = shortcuts
        .filter((s) => s.group === group)
        .map((s) => {
          return `| ${escapeCell(formatKeys(s.keys))} | ${escapeCell(s.label)} |`;
        });
      return [`### ${group}`, "", "| Keys | Action |", "| --- | --- |", ...rows].join("\n");
    })
    .join("\n\n");
}
