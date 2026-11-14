import { customElement, type WebComponent, WebComponentBase } from "../../core";
import { ColorPickerEvents, type ColorChangedEventShape, type ColorPickerEventMap } from "../types";
import type ColorPickerPanel from "./color-picker-panel";
import { ColorUtils } from "../utils";

const FALLBACK_COLOR = "#000000";

const template = document.createElement("template");
template.innerHTML = `
  <style>
    :host {
      display: inline-block;
      position: relative;

      --color-picker-trigger-width: 30px;
      --color-picker-trigger-height: 30px;
      --color-picker-trigger-borderSize: 2px;
      --color-picker-trigger-borderStyle: solid;
      --color-picker-trigger-borderColor: #454545;
      --color-picker-trigger-borderRadius: 50%;
    }

    .trigger {
      width: var(--color-picker-trigger-width, 30px);
      height: var(--color-picker-trigger-height, 30px);
      border-radius: var(--color-picker-trigger-borderRadius, 50%);
      border:
        var(--color-picker-trigger-borderSize, 2px)
        var(--color-picker-trigger-borderStyle, solid)
        var(--color-picker-trigger-borderColor, #454545);
      background-image:
        linear-gradient(45deg, #444 25%, transparent 25%, transparent 75%, #444 75%, #444),
        linear-gradient(45deg, #444 25%, transparent 25%, transparent 75%, #444 75%, #444);
      background-size: 10px 10px;
      background-position: 0 0, 5px 5px;
      cursor: pointer;
      position: relative;
      overflow: hidden;
    }

    .trigger-color {
      position: absolute;
      inset: 0;
      background: transparent;
    }

    /*
     * The panel is a manual popover, so it renders in the top layer: above
     * the canvas and every panel, whatever their stacking or overflow. It is
     * placed in viewport coordinates next to the trigger (see _updatePosition).
     */
    .popover {
      position: fixed;
      inset: auto;
      margin: 0;
      padding: 0;
      border: none;
      background: transparent;
      overflow: visible;
      z-index: 1000; /* only matters without popover support */
      display: none;
    }

    .popover.visible,
    .popover:popover-open {
      display: block;
    }
  </style>

  <div class="trigger" id="trigger">
    <div class="trigger-color" id="triggerColor"></div>
  </div>
  <div class="popover" id="popover" popover="manual">
    <color-picker-panel id="panel"></color-picker-panel>
  </div>
`;

const ColorPickerButtonBase = WebComponentBase<ColorPickerEventMap>({ mode: "open" });

@customElement("color-picker-button")
export default class ColorPickerButton extends ColorPickerButtonBase implements WebComponent {
  static get observedAttributes() {
    return ["value"];
  }

  declare _shadowRoot: ShadowRoot;

  private _triggerBtn: HTMLElement;
  private _triggerColor: HTMLElement;
  private _popoverElement: HTMLElement;
  private _panel: ColorPickerPanel;
  private _isOpen: boolean = false;
  private _abortController!: AbortController;
  /** Guard flag to prevent echoing upstream changes back down into the {@link ColorPickerPanel panel}. */
  private _isInternalChange: boolean = false;

  constructor() {
    super();

    this._shadowRoot.appendChild(template.content.cloneNode(true));

    this._triggerBtn = this._shadowRoot.querySelector<HTMLElement>("#trigger")!;
    this._triggerColor = this._shadowRoot.querySelector<HTMLElement>("#triggerColor")!;
    this._popoverElement = this._shadowRoot.querySelector<HTMLElement>("#popover")!;
    this._panel = this._shadowRoot.querySelector<ColorPickerPanel>("#panel")!;
  }

  get value(): string {
    return this.getAttribute("value") || FALLBACK_COLOR;
  }

  set value(v: string) {
    if (this.value.toLowerCase() === v.toLowerCase()) return;
    this.setAttribute("value", v);
  }

  connectedCallback() {
    this._abortController = new AbortController();
    const { signal } = this._abortController;

    this._attachEventListeners(signal);
    this._setInitialColor();
  }

  disconnectedCallback() {
    this._abortController.abort();
  }

  attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null) {
    if (name === "value" && oldValue?.toLowerCase() !== newValue?.toLowerCase()) {
      this._handleColorValueAttrChanges(oldValue, newValue);
    }
  }

  toggle() {
    if (this._isOpen) {
      this.close();
    } else {
      this.open();
    }
  }

  open() {
    this._isOpen = true;
    const popover = this._popoverElement;
    if (typeof popover.showPopover === "function") popover.showPopover();
    else popover.classList.add("visible");
    this._updatePosition();
    window.addEventListener("resize", this._reposition);
    window.addEventListener("scroll", this._reposition, true);
  }

  close() {
    this._isOpen = false;
    const popover = this._popoverElement;
    if (typeof popover.hidePopover === "function" && popover.matches(":popover-open")) {
      popover.hidePopover();
    }
    popover.classList.remove("visible");
    window.removeEventListener("resize", this._reposition);
    window.removeEventListener("scroll", this._reposition, true);
  }

  private _reposition = () => {
    if (this._isOpen) this._updatePosition();
  };

  /**
   * Places the panel below the trigger (or above it when there's no room),
   * left-aligned with it, and always inside the viewport.
   */
  private _updatePosition() {
    const gap = 8;
    const trigger = this._triggerBtn.getBoundingClientRect();
    const panel = this._popoverElement.getBoundingClientRect();
    const roomBelow = window.innerHeight - trigger.bottom;
    let top =
      roomBelow >= panel.height + gap || trigger.top < panel.height + gap
        ? trigger.bottom + gap
        : trigger.top - panel.height - gap;
    let left = trigger.left;
    left = Math.max(gap, Math.min(left, window.innerWidth - panel.width - gap));
    top = Math.max(gap, Math.min(top, window.innerHeight - panel.height - gap));
    this._popoverElement.style.top = `${top}px`;
    this._popoverElement.style.left = `${left}px`;
  }

  private _setInitialColor() {
    const initialColor = this.getAttribute("value");
    this._handleColorValueAttrChanges(null, initialColor);
  }

  private _attachEventListeners(signal?: AbortSignal) {
    this._triggerBtn.addEventListener("click", this._handleToggleBtnClick, { signal });
    // Close on outside click
    document.addEventListener("click", this._handleOutsideClick, { signal });
    // Listen for internal panel changes to update the trigger color button
    this._panel.addEventListener(ColorPickerEvents.ColorChanged, this._onColorChange, { signal });
  }

  /** Upstream Event: Triggered when the user interacts with the {@link ColorPickerPanel panel}. */
  private _onColorChange = (ev: CustomEvent<ColorChangedEventShape>) => {
    const { hex } = ev.detail;

    // Update trigger switch color style immediately
    this._triggerColor.style.background = hex;

    // Synchronize "value" attr while suppresing downstream callback
    this._isInternalChange = true;
    this.setAttribute("value", hex);
    this._isInternalChange = false;
  };

  private _handleToggleBtnClick = (ev: PointerEvent) => {
    ev.stopPropagation();

    this.toggle();
  };

  private _handleOutsideClick = (ev: PointerEvent) => {
    if (!this._isOpen || ev.composedPath().includes(this)) return;

    this.close();
  };

  /**
   * Downstram Handler: Triggered when external code mutates "value" attribute or property.
   *
   * Updates the active color UI and delegates the chosen color value to the color panel component.
   *
   * Uses fallback if color value is invalid or not supported format. By default switches
   * back to previous color value if available, otherwise uses the {@link FALLBACK_COLOR fallback color}.
   *
   * @param oldColorValue
   * @param newColorValue
   * @returns
   */
  private _handleColorValueAttrChanges(oldColorValue: string | null, newColorValue: string | null) {
    if (this._isInternalChange) return;

    const parsedNewColor = ColorUtils.parseColor(newColorValue);

    if (!newColorValue || !parsedNewColor) {
      console.warn(`"${newColorValue}" is not valid/supported color format.`);

      const fallbackColor = ColorUtils.parseColor(oldColorValue) ? oldColorValue : FALLBACK_COLOR;
      this.setAttribute("value", fallbackColor!);

      return;
    }

    this._panel.setColor(newColorValue);
    this._triggerColor.style.background = newColorValue;
  }
}
