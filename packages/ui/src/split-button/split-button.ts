import { customElement, type WebComponent, WebComponentBase } from "../core";
import { SplitButtonEvents, type SplitButtonEventMap } from "./types";

const template = document.createElement("template");
template.innerHTML = `
  <style>
    :host {
      position: relative;
      display: inline-flex;
      font: inherit;
      --_bg: var(--split-bg, var(--theme-bg-card, #222228));
      --_bg-hover: var(--split-bg-hover, var(--theme-bg-card-hover, #2d2d35));
      --_text: var(--split-text, var(--theme-text-main, #f4f4f5));
      --_border: var(--split-border, var(--theme-border-color, #2a2a32));
      --_menu-bg: var(--split-menu-bg, var(--theme-bg-panel, #18181c));
      --_muted: var(--theme-text-muted, #a1a1aa);
      --_accent: var(--theme-color-accent, #38bdf8);
      --_selected: var(--theme-bg-selected, #1e3a6e);
    }
    :host([variant="primary"]) {
      --_bg: var(--split-bg, var(--theme-color-primary, #2563eb));
      --_bg-hover: var(--split-bg-hover, var(--theme-color-primary-hover, #1d4ed8));
      --_text: var(--split-text, #fff);
      --_border: var(--split-border, transparent);
    }
    button {
      display: inline-flex;
      align-items: center;
      gap: 6px;
      height: 32px;
      padding: 0 12px;
      font: inherit;
      color: var(--_text);
      background: var(--_bg);
      border: 1px solid var(--_border);
      cursor: pointer;
      white-space: nowrap;
    }
    button:hover:not(:disabled) { background: var(--_bg-hover); }
    button:focus-visible { outline: 2px solid var(--_accent); outline-offset: 1px; z-index: 1; }
    button:disabled { opacity: 0.5; cursor: default; }
    .main { border-radius: 6px 0 0 6px; }
    .toggle {
      padding: 0 7px;
      border-left-color: rgba(255, 255, 255, 0.22);
      border-radius: 0 6px 6px 0;
    }
    .toggle svg { width: 12px; height: 12px; transition: rotate 0.15s; }
    .toggle[aria-expanded="true"] svg { rotate: 180deg; }
    ::slotted(svg), ::slotted([slot="icon"]) { width: 16px; height: 16px; fill: currentColor; }
    .menu {
      position: absolute;
      top: calc(100% + 4px);
      right: 0;
      z-index: 50;
      min-width: 100%;
      padding: 4px;
      background: var(--_menu-bg);
      border: 1px solid var(--theme-border-color, #2a2a32);
      border-radius: 8px;
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
    }
    .menu[hidden] { display: none; }
    .item {
      display: flex;
      width: 100%;
      height: auto;
      padding: 7px 10px;
      gap: 8px;
      color: var(--theme-text-main, #f4f4f5);
      background: none;
      border: none;
      border-radius: 6px;
      text-align: left;
    }
    .item:hover, .item:focus-visible { background: var(--theme-bg-card-hover, #2d2d35); outline: none; }
    .item[aria-checked="true"] { background: var(--_selected); }
    .item .check { width: 12px; color: var(--_accent); }
    .item small { margin-left: auto; padding-left: 16px; color: var(--_muted); }
    slot[name="options"] { display: none; }
  </style>
  <button class="main" part="main"><slot name="icon"></slot><span id="label"></span></button>
  <button class="toggle" part="toggle" aria-haspopup="menu" aria-expanded="false" aria-label="More options">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>
  </button>
  <div class="menu" role="menu" hidden></div>
  <slot name="options"></slot>
`;

const Base = WebComponentBase<SplitButtonEventMap>({ mode: "open" });

/**
 * A split button: the main part runs the current default action, the arrow
 * opens a menu of alternatives. Picking an alternative makes it the default
 * (the main label follows it) and runs it right away.
 *
 * Options are declared as light-DOM `<option>` children:
 *
 * ```html
 * <split-button variant="primary" remember="level-export">
 *   <option value="json" selected>Export (JSON)</option>
 *   <option value="csv" data-hint="one file per layer">Export (CSV)</option>
 * </split-button>
 * ```
 *
 * - `variant="primary"`: accent colours.
 * - `remember="key"`: keeps the chosen default per browser (localStorage).
 * - `data-hint` on an option: a muted note in the menu.
 *
 * Emits `split-action` with `{ value }`.
 */
@customElement("split-button")
export default class SplitButton extends Base implements WebComponent {
  declare _shadowRoot: ShadowRoot;
  private readonly main: HTMLButtonElement;
  private readonly toggle: HTMLButtonElement;
  private readonly menu: HTMLElement;
  private readonly label: HTMLElement;
  private abort: AbortController | null = null;

  constructor() {
    super();
    this._shadowRoot.appendChild(template.content.cloneNode(true));
    const $ = <T extends Element>(sel: string) => this._shadowRoot.querySelector<T>(sel)!;
    this.main = $(".main");
    this.toggle = $(".toggle");
    this.menu = $(".menu");
    this.label = $("#label");
  }

  /** Value of the option the main button runs. */
  get value(): string {
    return this.selectedOption()?.value ?? "";
  }

  set value(value: string) {
    this.select(value);
  }

  connectedCallback(): void {
    this.abort = new AbortController();
    const signal = this.abort.signal;
    this.assignSlots();
    const remembered = this.readRemembered();
    if (remembered && this.options().some((o) => o.value === remembered)) this.select(remembered);
    this.render();

    this.main.addEventListener("click", () => this.run(), { signal });
    this.toggle.addEventListener("click", () => this.setOpen(!this.isOpen), { signal });
    this.menu.addEventListener(
      "click",
      (ev) => {
        const item = (ev.target as Element).closest<HTMLElement>("[data-value]");
        if (!item) return;
        this.select(item.dataset.value!);
        this.setOpen(false);
        this.main.focus();
        this.run();
      },
      { signal }
    );
    this.menu.addEventListener("keydown", (ev) => this.onMenuKey(ev), { signal });
    this.toggle.addEventListener(
      "keydown",
      (ev) => {
        if (ev.key === "ArrowDown") {
          ev.preventDefault();
          this.setOpen(true);
        }
      },
      { signal }
    );
    document.addEventListener(
      "pointerdown",
      (ev) => {
        if (this.isOpen && !ev.composedPath().includes(this)) this.setOpen(false);
      },
      { signal }
    );
    // Re-render when options change. Only attributes that matter are watched,
    // and `assignSlots` writes nothing when slots are already set, so the
    // observer can't trigger itself.
    new MutationObserver(() => {
      this.assignSlots();
      this.render();
    }).observe(this, {
      childList: true,
      subtree: true,
      characterData: true,
      attributes: true,
      attributeFilter: ["selected", "value", "data-hint", "disabled"],
    });
  }

  disconnectedCallback(): void {
    this.abort?.abort();
    this.abort = null;
  }

  /** Options are light-DOM children; keep them in the hidden named slot. */
  private assignSlots(): void {
    for (const option of this.options()) {
      if (option.slot !== "options") option.slot = "options";
    }
  }

  private options(): HTMLOptionElement[] {
    return [...this.querySelectorAll<HTMLOptionElement>(":scope > option")];
  }

  private selectedOption(): HTMLOptionElement | undefined {
    const options = this.options();
    return options.find((o) => o.hasAttribute("selected")) ?? options[0];
  }

  private select(value: string): void {
    const options = this.options();
    if (!options.some((o) => o.value === value)) return;
    for (const option of options) option.toggleAttribute("selected", option.value === value);
    this.writeRemembered(value);
    this.render();
  }

  private run(): void {
    const value = this.value;
    if (!value) return;
    this.dispatchEvent(
      new CustomEvent(SplitButtonEvents.Action, {
        detail: { value },
        bubbles: true,
        composed: true,
      })
    );
  }

  private get isOpen(): boolean {
    return this.toggle.getAttribute("aria-expanded") === "true";
  }

  private setOpen(open: boolean): void {
    this.menu.hidden = !open;
    this.toggle.setAttribute("aria-expanded", String(open));
    if (open) {
      const items = this.items();
      (items.find((i) => i.getAttribute("aria-checked") === "true") ?? items[0])?.focus();
    }
  }

  private items(): HTMLElement[] {
    return [...this.menu.querySelectorAll<HTMLElement>("[data-value]")];
  }

  private onMenuKey(ev: KeyboardEvent): void {
    const items = this.items();
    const index = items.indexOf(this._shadowRoot.activeElement as HTMLElement);
    if (ev.key === "Escape") {
      ev.preventDefault();
      ev.stopPropagation();
      this.setOpen(false);
      this.toggle.focus();
    } else if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      ev.preventDefault();
      const step = ev.key === "ArrowDown" ? 1 : items.length - 1;
      items[(index + step) % items.length]?.focus();
    } else if (ev.key === "Tab") {
      this.setOpen(false);
    }
  }

  private render(): void {
    const selected = this.selectedOption();
    this.label.textContent = selected?.textContent?.trim() ?? "";
    const disabled = this.hasAttribute("disabled") || !selected;
    this.main.disabled = disabled;
    this.toggle.disabled = disabled;
    this.main.title = this.title || this.label.textContent;
    this.menu.replaceChildren(
      ...this.options().map((option) => {
        const item = document.createElement("button");
        item.className = "item";
        item.type = "button";
        item.dataset.value = option.value;
        item.setAttribute("role", "menuitemradio");
        const checked = option === selected;
        item.setAttribute("aria-checked", String(checked));
        const check = document.createElement("span");
        check.className = "check";
        check.textContent = checked ? "✓" : "";
        const text = document.createElement("span");
        text.textContent = option.textContent?.trim() ?? option.value;
        item.append(check, text);
        if (option.dataset.hint) {
          const hint = document.createElement("small");
          hint.textContent = option.dataset.hint;
          item.append(hint);
        }
        return item;
      })
    );
  }

  private readRemembered(): string | null {
    const key = this.getAttribute("remember");
    if (!key) return null;
    try {
      return localStorage.getItem(`split-button:${key}`);
    } catch {
      return null;
    }
  }

  private writeRemembered(value: string): void {
    const key = this.getAttribute("remember");
    if (!key) return;
    try {
      localStorage.setItem(`split-button:${key}`, value);
    } catch {
      // Storage can be unavailable (private mode); the default just isn't kept.
    }
  }
}
