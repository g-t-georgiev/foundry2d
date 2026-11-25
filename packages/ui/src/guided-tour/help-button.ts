import { customElement, type WebComponent, WebComponentBase } from "../core";

/** An entry of the Help menu: a link (opens in a new tab) or an action. */
export interface HelpItem {
  label: string;
  hint?: string;
  href?: string;
  action?: () => void;
}

const template = document.createElement("template");
template.innerHTML = `
  <style>
    :host { display: inline-flex; font: inherit; }
    .toggle {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      font: inherit;
      font-weight: 600;
      color: var(--theme-text-main, #f4f4f5);
      background: var(--theme-bg-card, #222228);
      border: 1px solid var(--theme-border-color, #2a2a32);
      border-radius: 6px;
      cursor: pointer;
    }
    .toggle:hover { background: var(--theme-bg-card-hover, #2d2d35); }
    button:focus-visible, a:focus-visible { outline: 2px solid var(--theme-color-accent, #38bdf8); outline-offset: 1px; }
    /* A popover in the top layer, placed next to the button (see place). */
    .menu {
      position: fixed;
      inset: auto;
      margin: 0;
      min-width: 220px;
      padding: 4px;
      color: inherit;
      background: var(--theme-bg-panel, #18181c);
      border: 1px solid var(--theme-border-color, #2a2a32);
      border-radius: 8px;
      box-shadow: 0 12px 32px rgba(0, 0, 0, 0.5);
    }
    .menu:not(:popover-open):not(.open) { display: none; }
    .item {
      display: flex;
      justify-content: space-between;
      gap: 16px;
      width: 100%;
      padding: 7px 10px;
      font: inherit;
      text-align: left;
      text-decoration: none;
      color: var(--theme-text-main, #f4f4f5);
      background: none;
      border: 0;
      border-radius: 5px;
      cursor: pointer;
      box-sizing: border-box;
    }
    .item:hover, .item:focus-visible { background: var(--theme-bg-card-hover, #2d2d35); outline: none; }
    .hint { color: var(--theme-text-muted, #a1a1aa); font-size: 0.9em; }
  </style>
  <button class="toggle" aria-haspopup="menu" aria-expanded="false" aria-label="Help" title="Help">?</button>
  <div class="menu" role="menu" popover="manual"></div>
`;

const Base = WebComponentBase({ mode: "open" });

/** The "?" button of an app's toolbar: a menu with the tour, the manual and so on. */
@customElement("help-button")
export default class HelpButton extends Base implements WebComponent {
  declare _shadowRoot: ShadowRoot;
  private readonly toggle: HTMLButtonElement;
  private readonly menu: HTMLElement;
  private readonly onOutside = (ev: PointerEvent) => {
    if (!ev.composedPath().includes(this)) this.open(false);
  };
  private readonly reposition = () => this.place();

  constructor() {
    super();
    this._shadowRoot.appendChild(template.content.cloneNode(true));
    this.toggle = this._shadowRoot.querySelector(".toggle")!;
    this.menu = this._shadowRoot.querySelector(".menu")!;
    this.toggle.addEventListener("click", () => this.open(!this.isOpen));
    this.menu.addEventListener("keydown", (ev) => this.onKey(ev));
  }

  get isOpen(): boolean {
    return this.toggle.getAttribute("aria-expanded") === "true";
  }

  /** The menu's entries. */
  set items(items: readonly HelpItem[]) {
    this.menu.replaceChildren(
      ...items.map((item) => {
        const entry = document.createElement(item.href ? "a" : "button");
        entry.className = "item";
        entry.setAttribute("role", "menuitem");
        entry.append(item.label);
        if (item.hint) {
          const hint = document.createElement("span");
          hint.className = "hint";
          hint.textContent = item.hint;
          entry.append(hint);
        }
        if (entry instanceof HTMLAnchorElement) {
          entry.href = item.href!;
          entry.target = "_blank";
          entry.rel = "noopener";
        }
        entry.addEventListener("click", () => {
          this.open(false);
          item.action?.();
        });
        return entry;
      })
    );
  }

  private entries(): HTMLElement[] {
    return [...this.menu.querySelectorAll<HTMLElement>(".item")];
  }

  open(open: boolean): void {
    if (open === this.isOpen) return;
    this.toggle.setAttribute("aria-expanded", String(open));
    const popover = typeof this.menu.showPopover === "function";
    if (open) {
      if (popover) this.menu.showPopover();
      else this.menu.classList.add("open");
      this.place();
      this.entries()[0]?.focus();
      document.addEventListener("pointerdown", this.onOutside, true);
      window.addEventListener("resize", this.reposition);
    } else {
      if (popover && this.menu.matches(":popover-open")) this.menu.hidePopover();
      this.menu.classList.remove("open");
      document.removeEventListener("pointerdown", this.onOutside, true);
      window.removeEventListener("resize", this.reposition);
    }
  }

  /** Below the button, right-aligned with it, inside the window. */
  private place(): void {
    const button = this.toggle.getBoundingClientRect();
    const menu = this.menu.getBoundingClientRect();
    const left = Math.max(
      8,
      Math.min(button.right - menu.width, window.innerWidth - menu.width - 8)
    );
    this.menu.style.left = `${left}px`;
    this.menu.style.top = `${button.bottom + 4}px`;
  }

  private onKey(ev: KeyboardEvent): void {
    const entries = this.entries();
    const at = entries.indexOf(this._shadowRoot.activeElement as HTMLElement);
    if (ev.key === "Escape") {
      this.open(false);
      this.toggle.focus();
    } else if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      const step = ev.key === "ArrowDown" ? 1 : entries.length - 1;
      entries[(at + step) % entries.length]?.focus();
    } else return;
    ev.preventDefault();
    ev.stopPropagation();
  }
}
