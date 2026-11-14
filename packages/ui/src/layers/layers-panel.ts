import { customElement, type WebComponent, WebComponentBase } from "../core";
import {
  LayerPanelEvents,
  type LayerPanelEventName,
  type LayerPanelEventPayloads,
  type LayersPanelEventMap,
  type LayerView,
} from "./types";

const ICONS = {
  add: `<svg viewBox="0 0 24 24"><path d="M11 5h2v6h6v2h-6v6h-2v-6H5v-2h6z"/></svg>`,
  duplicate: `<svg viewBox="0 0 24 24"><path d="M16 1H4a2 2 0 0 0-2 2v14h2V3h12V1m3 4H8a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2m0 16H8V7h11v14z"/></svg>`,
  up: `<svg viewBox="0 0 24 24"><path d="M7.4 15.4 12 10.8l4.6 4.6L18 14l-6-6-6 6z"/></svg>`,
  down: `<svg viewBox="0 0 24 24"><path d="M7.4 8.6 12 13.2l4.6-4.6L18 10l-6 6-6-6z"/></svg>`,
  delete: `<svg viewBox="0 0 24 24"><path d="M9 3v1H4v2h1v13a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V6h1V4h-5V3H9m0 5h2v9H9V8m4 0h2v9h-2V8z"/></svg>`,
  lock: `<svg viewBox="0 0 24 24"><path d="M12 2a5 5 0 0 0-5 5v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5m-3 8V7a3 3 0 0 1 6 0v3H9z"/></svg>`,
  unlock: `<svg viewBox="0 0 24 24"><path d="M12 2a5 5 0 0 0-5 5h2a3 3 0 0 1 6 0v3H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8a2 2 0 0 0-2-2h-1V7a5 5 0 0 0-5-5z"/></svg>`,
  eye: `<svg viewBox="0 0 24 24"><path d="M12 4.5C7 4.5 2.7 7.6 1 12c1.7 4.4 6 7.5 11 7.5s9.3-3.1 11-7.5c-1.7-4.4-6-7.5-11-7.5M12 17a5 5 0 1 1 0-10 5 5 0 0 1 0 10m0-8a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/></svg>`,
  eyeOff: `<svg viewBox="0 0 24 24"><path d="M2 5.3 3.3 4 20 20.7 18.7 22l-3.1-3.1c-1.1.4-2.3.6-3.6.6-5 0-9.3-3.1-11-7.5.8-2 2.1-3.7 3.8-5L2 5.3M12 9a3 3 0 0 1 3 3v.4L11.6 9H12m0-4.5c5 0 9.3 3.1 11 7.5a11.8 11.8 0 0 1-4.1 5.3l-1.4-1.4A9.8 9.8 0 0 0 20.8 12 9.8 9.8 0 0 0 12 6.5c-1.1 0-2.2.2-3.2.5L7.2 5.4c1.5-.6 3.1-.9 4.8-.9M3.2 12A9.8 9.8 0 0 0 12 17.5c.7 0 1.4-.1 2-.2l-2.3-2.3A3 3 0 0 1 9 12.3L5.6 8.9c-1 .9-1.9 1.9-2.4 3.1z"/></svg>`,
};

const template = document.createElement("template");
template.innerHTML = `
  <style>
    :host {
      display: flex;
      flex-direction: column;
      min-height: 0;
      font: 13px/1.3 var(--layers-font, system-ui, sans-serif);
      color: var(--layers-text, #e0e0e0);
      --_bg: var(--layers-bg, #232529);
      --_row: var(--layers-row-bg, #2b2e33);
      --_row-hover: var(--layers-row-hover, #33363c);
      --_active: var(--layers-active-bg, #2f5d8a);
      --_active-border: var(--layers-active-border, #4c9ffe);
      --_border: var(--layers-border, #3a3d44);
      --_muted: var(--layers-muted, #8b9099);
      --_accent: var(--layers-accent, #4c9ffe);
    }
    .panel {
      display: flex;
      flex-direction: column;
      min-height: 0;
      flex: 1;
      background: var(--_bg);
      border: 1px solid var(--_border);
      border-radius: 6px;
      overflow: hidden;
    }
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 6px 8px;
      border-bottom: 1px solid var(--_border);
      font-weight: 600;
      text-transform: uppercase;
      font-size: 11px;
      letter-spacing: 0.04em;
      color: var(--_muted);
    }
    .rail {
      display: flex;
      gap: 2px;
    }
    button {
      all: unset;
      box-sizing: border-box;
      display: inline-grid;
      place-items: center;
      width: 24px;
      height: 24px;
      border-radius: 4px;
      color: var(--layers-text, #e0e0e0);
      cursor: pointer;
    }
    button:hover:not(:disabled) { background: var(--_row-hover); }
    button:focus-visible { outline: 2px solid var(--_accent); outline-offset: -2px; }
    button:disabled { opacity: 0.35; cursor: default; }
    button[hidden] { display: none; }
    svg { width: 16px; height: 16px; fill: currentColor; }
    .list {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      padding: 4px;
      display: flex;
      flex-direction: column;
      gap: 2px;
      outline: none;
    }
    .row {
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 0 6px 0 2px;
      height: 30px;
      background: var(--_row);
      border: 1px solid transparent;
      border-radius: 4px;
      cursor: pointer;
      user-select: none;
    }
    .row:hover { background: var(--_row-hover); }
    .row[aria-selected="true"] { background: var(--_active); border-color: var(--_active-border); }
    .row.hidden .name { color: var(--_muted); font-style: italic; }
    .name {
      flex: 1;
      overflow: hidden;
      white-space: nowrap;
      text-overflow: ellipsis;
    }
    .name input {
      all: unset;
      width: 100%;
      background: #111;
      border-radius: 3px;
      padding: 2px 4px;
      box-sizing: border-box;
    }
    .opacity-badge { color: var(--_muted); font-size: 11px; font-variant-numeric: tabular-nums; }
    .lock { color: var(--_muted); }
    /* Unlocked layers show the toggle only on hover or for the active row, to keep rows calm. */
    .lock[aria-pressed="false"] { opacity: 0; }
    .row:hover .lock[aria-pressed="false"],
    .row[aria-selected="true"] .lock[aria-pressed="false"],
    .lock:focus-visible { opacity: 0.6; }
    .lock[aria-pressed="true"] { color: var(--layers-text, #e0e0e0); }
    .lock:disabled { cursor: help; }
    .footer {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 8px;
      border-top: 1px solid var(--_border);
      color: var(--_muted);
      font-size: 11px;
    }
    .footer input[type="range"] { flex: 1; accent-color: var(--_accent); }
    .footer output { width: 3ch; text-align: right; font-variant-numeric: tabular-nums; }
  </style>
  <div class="panel">
    <div class="header">
      <span id="title">Layers</span>
      <div class="rail" role="toolbar" aria-label="Layer actions">
        <button data-action="add" title="Add layer" aria-label="Add layer">${ICONS.add}</button>
        <button data-action="duplicate" title="Duplicate layer" aria-label="Duplicate layer">${ICONS.duplicate}</button>
        <button data-action="up" title="Move layer up" aria-label="Move layer up">${ICONS.up}</button>
        <button data-action="down" title="Move layer down" aria-label="Move layer down">${ICONS.down}</button>
        <button data-action="delete" title="Delete layer" aria-label="Delete layer">${ICONS.delete}</button>
      </div>
    </div>
    <div class="list" id="list" role="listbox" aria-label="Layers" tabindex="0"></div>
    <label class="footer">
      <span>Opacity</span>
      <input id="opacity" type="range" min="0" max="100" step="1" value="100" />
      <output id="opacityValue">100</output>
    </label>
  </div>
`;

const Base = WebComponentBase<LayersPanelEventMap>({ mode: "open" });

/**
 * Piskel-style layer list.
 *
 * Controlled component: the host sets `layers` (bottom → top, as stored in a
 * document) and `activeId`; the panel shows the top layer first and only
 * emits intent events. It never changes its own layer list.
 */
@customElement("layers-panel")
export default class LayersPanel extends Base implements WebComponent {
  /**
   * `actions`: space-separated rail buttons to show, e.g. `actions="up down"`
   * for a fixed set of layers. Defaults to all of them.
   */
  static get observedAttributes() {
    return ["actions"];
  }

  declare _shadowRoot: ShadowRoot;

  private _layers: LayerView[] = [];
  private _activeId: string | null = null;
  private _editingId: string | null = null;
  private _abort: AbortController | null = null;

  private readonly list: HTMLElement;
  private readonly opacity: HTMLInputElement;
  private readonly opacityValue: HTMLOutputElement;
  private readonly buttons: Record<
    "add" | "duplicate" | "up" | "down" | "delete",
    HTMLButtonElement
  >;

  constructor() {
    super();
    this._shadowRoot.appendChild(template.content.cloneNode(true));
    const $ = <T extends Element>(sel: string) => this._shadowRoot.querySelector<T>(sel)!;
    this.list = $("#list");
    this.opacity = $("#opacity");
    this.opacityValue = $("#opacityValue");
    this.buttons = {
      add: $('[data-action="add"]'),
      duplicate: $('[data-action="duplicate"]'),
      up: $('[data-action="up"]'),
      down: $('[data-action="down"]'),
      delete: $('[data-action="delete"]'),
    };
  }

  /** Layers in document order: index 0 is the bottom-most layer. */
  get layers(): readonly LayerView[] {
    return this._layers;
  }

  set layers(value: readonly LayerView[]) {
    this._layers = value.map((l) => ({ ...l }));
    if (this._activeId && !this._layers.some((l) => l.id === this._activeId)) {
      this._activeId = null;
    }
    this.render();
  }

  get activeId(): string | null {
    return this._activeId;
  }

  set activeId(id: string | null) {
    if (this._activeId === id) return;
    this._activeId = id;
    this.render();
  }

  attributeChangedCallback(name: string): void {
    if (name === "actions") this.applyActionVisibility();
  }

  private applyActionVisibility(): void {
    const attr = this.getAttribute("actions");
    const allowed = attr === null ? null : new Set(attr.split(/\s+/).filter(Boolean));
    for (const [action, button] of Object.entries(this.buttons)) {
      button.hidden = allowed !== null && !allowed.has(action);
    }
  }

  connectedCallback(): void {
    this._abort = new AbortController();
    const signal = this._abort.signal;
    const root = this._shadowRoot;

    root
      .querySelector(".rail")!
      .addEventListener("click", (ev) => this.onRailClick(ev), { signal });
    this.list.addEventListener("click", (ev) => this.onListClick(ev), { signal });
    this.list.addEventListener("dblclick", (ev) => this.onListDoubleClick(ev), { signal });
    this.list.addEventListener("keydown", (ev) => this.onListKeyDown(ev), { signal });
    this.opacity.addEventListener("input", () => this.emitOpacity(false), { signal });
    this.opacity.addEventListener("change", () => this.emitOpacity(true), { signal });
    this.applyActionVisibility();
    this.render();
  }

  disconnectedCallback(): void {
    this._abort?.abort();
    this._abort = null;
  }

  // ------------------------------------------------------------------ events

  private emit<K extends LayerPanelEventName>(type: K, detail: LayerPanelEventPayloads[K]): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  private onRailClick(ev: Event): void {
    const button = (ev.target as Element).closest<HTMLButtonElement>("button[data-action]");
    if (!button || button.disabled) return;
    const id = this._activeId;
    switch (button.dataset.action) {
      case "add":
        this.emit(LayerPanelEvents.Add, { afterId: id });
        break;
      case "duplicate":
        if (id) this.emit(LayerPanelEvents.Duplicate, { id });
        break;
      case "up":
        if (id) this.emit(LayerPanelEvents.Move, { id, direction: "up" });
        break;
      case "down":
        if (id) this.emit(LayerPanelEvents.Move, { id, direction: "down" });
        break;
      case "delete":
        if (id) this.emit(LayerPanelEvents.Delete, { id });
        break;
    }
  }

  private rowOf(target: EventTarget | null): HTMLElement | null {
    return (target as Element | null)?.closest<HTMLElement>(".row") ?? null;
  }

  private onListClick(ev: MouseEvent): void {
    const row = this.rowOf(ev.target);
    if (!row?.dataset.id) return;
    const id = row.dataset.id;

    if ((ev.target as Element).closest('[data-action="lock"]')) {
      const layer = this._layers.find((l) => l.id === id);
      if (layer && layer.lockable !== false) {
        this.emit(LayerPanelEvents.Lock, { id, locked: !layer.locked });
      }
      return;
    }
    if ((ev.target as Element).closest('[data-action="visibility"]')) {
      const layer = this._layers.find((l) => l.id === id);
      if (layer) this.emit(LayerPanelEvents.Visibility, { id, visible: !layer.visible });
      return;
    }
    if (id !== this._activeId) this.emit(LayerPanelEvents.Select, { id });
  }

  private onListDoubleClick(ev: MouseEvent): void {
    const row = this.rowOf(ev.target);
    if (!row?.dataset.id || (ev.target as Element).closest("button")) return;
    this.startRename(row.dataset.id);
  }

  private onListKeyDown(ev: KeyboardEvent): void {
    if (this._editingId) return;
    const index = this._layers.findIndex((l) => l.id === this._activeId);
    if (index === -1) return;
    // The list shows the top layer first, so ArrowUp moves to a higher index.
    if (ev.key === "ArrowUp" || ev.key === "ArrowDown") {
      ev.preventDefault();
      const next = this._layers[index + (ev.key === "ArrowUp" ? 1 : -1)];
      if (!next) return;
      if (ev.altKey) {
        this.emit(LayerPanelEvents.Move, {
          id: this._layers[index].id,
          direction: ev.key === "ArrowUp" ? "up" : "down",
        });
      } else {
        this.emit(LayerPanelEvents.Select, { id: next.id });
      }
    } else if (ev.key === "F2" || ev.key === "Enter") {
      ev.preventDefault();
      this.startRename(this._layers[index].id);
    }
  }

  private emitOpacity(final: boolean): void {
    const id = this._activeId;
    if (!id) return;
    const opacity = Number(this.opacity.value) / 100;
    this.opacityValue.value = this.opacity.value;
    this.emit(LayerPanelEvents.Opacity, { id, opacity, final });
  }

  // ------------------------------------------------------------------ rename

  /** Opens inline rename for a layer. */
  startRename(id: string): void {
    const layer = this._layers.find((l) => l.id === id);
    const nameCell = this.list.querySelector<HTMLElement>(
      `.row[data-id="${CSS.escape(id)}"] .name`
    );
    if (!layer || !nameCell) return;

    this._editingId = id;
    const input = document.createElement("input");
    input.value = layer.name;
    input.setAttribute("aria-label", "Layer name");
    nameCell.replaceChildren(input);
    input.focus();
    input.select();

    let done = false;
    const finish = (commit: boolean) => {
      if (done) return;
      done = true;
      this._editingId = null;
      const name = input.value.trim();
      if (commit && name && name !== layer.name) {
        this.emit(LayerPanelEvents.Rename, { id, name });
      }
      this.render();
      this.list.focus();
    };
    input.addEventListener("keydown", (ev) => {
      ev.stopPropagation();
      if (ev.key === "Enter") finish(true);
      else if (ev.key === "Escape") finish(false);
    });
    input.addEventListener("blur", () => finish(true));
  }

  // ------------------------------------------------------------------ render

  private render(): void {
    if (!this.isConnected || this._editingId) return;

    const rows: HTMLElement[] = [];
    for (let i = this._layers.length - 1; i >= 0; i--) {
      rows.push(this.renderRow(this._layers[i]));
    }
    this.list.replaceChildren(...rows);

    const index = this._layers.findIndex((l) => l.id === this._activeId);
    const active = this._layers[index];
    const hasActive = index !== -1;
    this.buttons.duplicate.disabled = !hasActive;
    this.buttons.up.disabled = !hasActive || index >= this._layers.length - 1;
    this.buttons.down.disabled = !hasActive || index <= 0;
    this.buttons.delete.disabled = !hasActive || this._layers.length <= 1;

    this.opacity.disabled = !hasActive;
    const percent = String(Math.round((active?.opacity ?? 1) * 100));
    // Don't fight the user while they drag the slider.
    if (this._shadowRoot.activeElement !== this.opacity) this.opacity.value = percent;
    this.opacityValue.value = this.opacity.value;
  }

  private renderRow(layer: LayerView): HTMLElement {
    const selected = layer.id === this._activeId;
    const row = document.createElement("div");
    row.className = layer.visible ? "row" : "row hidden";
    row.dataset.id = layer.id;
    row.setAttribute("role", "option");
    row.setAttribute("aria-selected", String(selected));

    const eye = document.createElement("button");
    eye.dataset.action = "visibility";
    eye.title = layer.visible ? "Hide layer" : "Show layer";
    eye.setAttribute("aria-label", eye.title);
    eye.setAttribute("aria-pressed", String(!layer.visible));
    eye.innerHTML = layer.visible ? ICONS.eye : ICONS.eyeOff;

    const name = document.createElement("span");
    name.className = "name";
    name.textContent = layer.name;
    name.title = layer.name;

    row.append(eye, name);

    if (layer.opacity < 1) {
      const badge = document.createElement("span");
      badge.className = "opacity-badge";
      badge.textContent = `${Math.round(layer.opacity * 100)}%`;
      row.append(badge);
    }
    if (layer.locked !== undefined) {
      const lock = document.createElement("button");
      lock.className = "lock";
      lock.dataset.action = "lock";
      lock.disabled = layer.lockable === false;
      lock.title = lock.disabled
        ? (layer.lockReason ?? "Always locked")
        : layer.locked
          ? "Unlock layer"
          : "Lock layer (no drawing)";
      lock.setAttribute("aria-label", lock.title);
      lock.setAttribute("aria-pressed", String(layer.locked));
      lock.innerHTML = layer.locked ? ICONS.lock : ICONS.unlock;
      row.append(lock);
    }
    return row;
  }
}
