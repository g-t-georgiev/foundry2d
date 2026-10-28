import { type WebComponent, WebComponentBase, customElement, html } from "../core";
import { LayerEvents } from "./types";

/** @private */
const getLayerItemHtml = html<{ name: string }>`
  <style>
    :host {
      display: block;
      transition: transform 0.2s cubic-bezier(0.2, 0, 0, 1);
    }

    :host(.dragging) {
      opacity: 0.95;
      position: fixed;
      z-index: 1000;
      box-shadow: 0 10px 15px rgba(0, 0, 0, 0.3);
      transition: none !important;
    }

    .layer {
      display: flex;
      align-items: center;
      padding: 6px 8px;
      background-color: #2d2d2d;
      border-radius: 4px;
      color: #e0e0e0;
      cursor: pointer;
      user-select: none;
    }

    .layer:hover {
      background-color: #3a3a3a;
    }

    :host([active]) .layer {
      background-color: #3f3f3f;
    }

    .thumbnail {
      width: 24px;
      height: 24px;
      background-image:
        linear-gradient(45deg, #444 25%, transparent 25%),
        linear-gradient(-45deg, #444 25%, transparent 25%),
        linear-gradient(45deg, transparent 75%, #444 75%),
        linear-gradient(-45deg, transparent 75%, #444 75%);

      background-size: 8px 8px;
      background-position:
        0 0,
        0 4px,
        4px -4px,
        -4px 0px;
      border: 1px solid #222;
      border-radius: 2px;
      margin-right: 10px;
    }

    .title {
      flex-grow: 1;
      font-size: 13px;
    }

    .actions {
      display: flex;
      gap: 4px;
    }

    button {
      background: none;
      border: none;
      color: #a0a0a0;
      cursor: pointer;
      font-size: 14px;
      padding: 2px 4px;
      border-radius: 3px;
    }

    button:hover {
      background-color: #555;
      color: #fff;
    }

    .drag-handle {
      background: none;
      border: none;
      color: #888;
      cursor: grab;
      padding: 4px;
      margin-right: 8px;
      border-radius: 4px;
      font-size: 14px;
      line-height: 1;
    }

    :host(:only-child) .drag-handle {
      pointer-events: none;
      opacity: 0.5;
    }

    .visibility-btn::before {
      content: "[O]";
      display: inline-block;
    }

    :host([is-hidden]) .visibility-btn::before {
      content: "[X]";
    }
  </style>

  <div class="layer">
    <button
      data-id="drag-handle"
      class="drag-handle"
      aria-label="Move panel"
      title="Drag or use arrow keys"
    >
      ⋮⋮
    </button>
    <div class="thumbnail"></div>
    <span data-id="title" class="title">${(p) => p.name}</span>
    <div class="actions">
      <button
        data-id="visibility-btn"
        class="visibility-btn"
        type="button"
        title="Toggle Visibility"
      ></button>
      <button data-id="context-menu-btn" class="context-menu-btn" type="button" title="Options">
        ⋮
      </button>
    </div>
  </div>
`;

const LayerItemBase = WebComponentBase({ mode: "open" });

@customElement("layer-item")
export default class LayerItem extends LayerItemBase implements WebComponent {
  static get observedAttributes() {
    return ["name", "uuid"];
  }

  private _name: HTMLElement;
  private _dragHandle: HTMLElement;
  private _visibilityBtn: HTMLElement;
  private _contextMenuBtn: HTMLElement;

  private _abortController!: AbortController;

  private _requestedDragging: boolean = false;

  constructor() {
    super();

    this._shadowRoot.innerHTML = getLayerItemHtml({ name: this.name });

    this._name = this._shadowRoot.querySelector('[data-id="title"]')!;
    this._dragHandle = this._shadowRoot.querySelector('[data-id="drag-handle"]')!;
    this._visibilityBtn = this._shadowRoot.querySelector('[data-id="visibility-btn"]')!;
    this._contextMenuBtn = this._shadowRoot.querySelector('[data-id="context-menu-btn"]')!;
  }

  get name(): string {
    return this.getAttribute("name") || "Anonymous Layer";
  }

  set name(value: string | null) {
    value = value || "Anonymous Layer";

    this._name.textContent = value;
    this.setAttribute("name", value);
  }

  get uuid() {
    return this.getAttribute("uuid")!;
  }

  set uuid(value: string) {
    this.setAttribute("uuid", value);
  }

  get active() {
    return this.hasAttribute("active") ?? false;
  }

  get visible() {
    return !this.hasAttribute("is-hidden");
  }

  set visible(value: boolean) {
    this.toggleAttribute("is-hidden", !value);
  }

  get requestedDragging() {
    return this._requestedDragging;
  }

  connectedCallback(): void {
    if (!this.uuid) {
      console.warn(
        `LayerItem initialized without an UUID! This could have unexpected out of sync errors and state mismatch!`
      );
    }

    this._abortController = new AbortController();
    const { signal } = this._abortController;

    this._attachClickListeners(signal);
    this._attachDragHandleEventListeners(signal);
    this._attachVisibilityBtnEventListeners(signal);
    this._attachContextMenuBtnEventListeners(signal);
  }

  disconnectedCallback(): void {
    this._abortController.abort();
  }

  attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
    if (name === "name" && oldValue !== newValue) {
      this.name = newValue;
    }

    if (name === "uuid" && newValue && oldValue !== newValue) {
      this.uuid = newValue;
    }
  }

  private _attachVisibilityBtnEventListeners(signal: AbortSignal) {
    this._visibilityBtn.addEventListener(
      "click",
      (ev: PointerEvent) => {
        ev.preventDefault();
        this._stopPropagation(ev);
        const visible = (this.visible = !this.visible);
        this.dispatchEvent(
          new CustomEvent(LayerEvents.VisibilityChange, {
            bubbles: true,
            composed: true,
            detail: { id: this.uuid, visible },
          })
        );
      },
      { signal }
    );

    this._visibilityBtn.addEventListener("pointerdown", this._stopPropagation);
    this._visibilityBtn.addEventListener("pointermove", this._stopPropagation);
    this._visibilityBtn.addEventListener("pointerup", this._stopPropagation);
    this._visibilityBtn.addEventListener("pointercancel", this._stopPropagation);
  }

  private _attachDragHandleEventListeners(signal: AbortSignal) {
    this._dragHandle.addEventListener(
      "pointerdown",
      (ev: PointerEvent) => {
        ev.preventDefault();
        this._requestedDragging = true;
      },
      { signal }
    );

    this.addEventListener(
      "pointerup",
      (ev: PointerEvent) => {
        ev.preventDefault();
        this._requestedDragging = false;
      },
      { signal }
    );

    this._dragHandle.addEventListener("pointerup", this._stopPropagation, { signal });
    this._dragHandle.addEventListener("click", this._stopPropagation, { signal });
  }

  private _attachContextMenuBtnEventListeners(signal: AbortSignal) {
    this._contextMenuBtn.addEventListener("click", this._stopPropagation, { signal });
    this._contextMenuBtn.addEventListener("pointerdown", this._stopPropagation, { signal });
    this._contextMenuBtn.addEventListener("pointermove", this._stopPropagation, { signal });
    this._contextMenuBtn.addEventListener("pointerup", this._stopPropagation, { signal });
    this._contextMenuBtn.addEventListener("pointercancel", this._stopPropagation, { signal });
  }

  private _attachClickListeners(signal: AbortSignal) {
    const layerDiv = this._shadowRoot.querySelector<HTMLElement>(".layer")!;

    layerDiv.addEventListener(
      "click",
      (ev: PointerEvent) => {
        const target = ev.target as HTMLElement;
        // Ignore button clicks
        if (target.closest("button")) return;

        this.dispatchEvent(
          new CustomEvent(LayerEvents.Select, {
            bubbles: true,
            composed: true,
            detail: this,
          })
        );
      },
      { signal }
    );
  }

  private _stopPropagation = <T extends Event>(ev: T) => {
    ev.stopPropagation();
  };
}
