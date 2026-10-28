import "../eyedropper";
import { type WebComponent, WebComponentBase, customElement } from "../../core";
import {
  type ColorPickerEventMap,
  type ColorChangedEventShape,
  ColorFormat,
  type SupportedColorFormat,
  type onMoveCallback,
  ColorPickerEvents,
} from "../types";
import { ColorUtils, SUPPORTED_COLOR_FORMATS } from "../utils";

const template = document.createElement("template");
template.innerHTML = `
  <style>
    :host {
      display: block;
      width: 260px;
      background-color: var(--picker-bg, #252526);
      border: 1px solid var(--picker-border, #454545);
      border-radius: 5px;
      box-shadow: 0 4px 12px rgba(0,0,0,0.4);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      color: #cccccc;
      padding: 10px;
      box-sizing: border-box;
      user-select: none;
    }

    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 10px;
      gap: 8px;
    }

    .format-wrapper {
      position: relative;
      flex-grow: 1;
      height: 24px;
    }

    .format-list {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      background: #3c3c3c;
      border: 1px solid #3c3c3c;
      border-radius: 3px;
      display: flex;
      flex-direction: column;
      box-sizing: border-box;
      cursor: pointer;
      z-index: 100;
    }

    /* Collapsed State */
    .format-list:not(.expanded) {
      height: 24px;
    }

    .format-list:not(.expanded):hover {
      background: #444;
    }

    .format-list:not(.expanded) .format-option:not(.selected) {
      display: none;
    }

    /* Expanded State */
    .format-list.expanded {
      background: #252526;
      box-shadow: 0 4px 12px rgba(0,0,0,0.4);
    }

    .format-option {
      height: 22px; /* 24px total - 2px border */
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 6px;
      font-size: 11px;
      color: #ccc;
      border-radius: 2px;
    }

    .format-list.expanded .format-option.selected {
      background: #3c3c3c;
      color: #fff;
    }

    .format-list.expanded .format-option:not(.selected):hover {
      background: #094771;
      color: #fff;
    }

    .format-arrows {
      box-sizing: border-box;
      position: absolute;
      z-index: 100;
      right: 0;
      width: auto;
      height: 24px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 6px;
      color: #999;
      font-size: 11px;
      border-radius: 2px;
      pointer-events: none;
    }

    .arrows-icon {
      display: flex;
      color: inherit;
    }

    .format-list.expanded ~ .format-arrows,
    .format-list:has(.format-option.selected:hover) ~ .format-arrows {
      color: #fff;
    }

    .icon-btn {
      background: transparent;
      border: none;
      color: #ccc;
      cursor: pointer;
      padding: 4px;
      border-radius: 4px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.2s, color 0.2s;
    }

    .icon-btn:hover {
      background: #3c3c3c;
      color: #fff;
    }

    .icon-btn svg { display: block; width: 16px; height: 16px; fill: currentColor; }

    .icon-btn-copy .icon-copied { display: none; }
    .icon-btn-copy.copied .icon-copy { display: none; }
    .icon-btn-copy.copied .icon-copied { display: block; }

    .color-display {
      font-size: 13px;
      font-family: "Consolas", "Courier New", monospace;
      text-align: center;
      width: calc(100% + 12px);
      translate: -10px -10px;
      margin: 0;
      padding: 4px;
      background: #1e1e1e;
      border-radius: 5px;
    }

    /* Palette Area */
    .palette-wrapper {
      width: 100%;
      height: 140px;
      position: relative;
      border-radius: 2px;
      margin-bottom: 10px;
      cursor: crosshair;
      background-color: #ff0000;
      background-image:
        linear-gradient(to top, #000, transparent),
        linear-gradient(to right, #fff, transparent);
    }

    .palette-handle {
      width: 12px;
      height: 12px;
      border-radius: 50%;
      box-shadow: 0 0 3px 2px rgba(0,0,0,0.5), inset 0 0 0 1px #fff;
      position: absolute;
      transform: translate(-50%, -50%);
      pointer-events: none;
    }

    /* Sliders */
    .sliders {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .slider-track {
      width: 100%;
      height: 12px;
      border-radius: 6px;
      position: relative;
      cursor: pointer;
    }

    .hue-track {
      background: linear-gradient(
        to right,
        #f00 0%, #ff0 17%, #0f0 33%, #0ff 50%, #00f 67%, #f0f 83%, #f00 100%
      );
    }
    .opacity-track {
      background-image:
        linear-gradient(45deg, #444 25%, transparent 25%, transparent 75%, #444 75%, #444),
        linear-gradient(45deg, #444 25%, transparent 25%, transparent 75%, #444 75%, #444);
      background-size: 10px 10px;
      background-position: 0 0, 5px 5px;
    }

    .opacity-overlay {
      position: absolute;
      inset: 0;
      border-radius: 6px;
    }

    .slider-handle {
      width: 14px;
      height: 14px;
      background: #fff;
      border-radius: 50%;
      box-shadow: 0 1px 4px rgba(0,0,0,0.5);
      position: absolute;
      top: -1px;
      transform: translateX(-50%);
      pointer-events: none;
    }
  </style>

  <div class="color-display" id="colorDisplay">#ff0000</div>

  <div class="header">
    <button class="icon-btn" id="eyedropperBtn" title="EyeDropper">
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <path d="M20.602 0q.703 0 1.324.27t1.078.727.727 1.078.27 1.324q0 .68-.258 1.307t-.738 1.107l-2.813 2.813q.387.375.598.85t.211 1.025q0 .539-.205 1.008t-.58.844l-1.84 1.84-1.875-1.887-9.434 9.434-.305.012q-.598.023-1.025.199t-.75.428-.586.533-.557.527-.645.404-.855.158q-.48 0-.908-.187t-.75-.51-.504-.744T0 21.656q0-.504.158-.861t.404-.645.527-.551.533-.586.428-.75.199-1.025l.012-.305 9.434-9.434-1.887-1.875 1.84-1.84q.375-.375.844-.58t1.008-.205q.551 0 1.025.211t.85.598l2.813-2.813q.48-.48 1.107-.738T20.602 0zm-5.168 11.25L12.75 8.566 3.75 17.566q-.059.598-.223 1.066t-.422.873-.604.773-.604.65-.27.598q0 .34.246.586t.586.246.598-.246q.41-.398.785-.744t.773-.604.867-.422 1.066-.223zm6.504-6.504q.563-.563.563-1.336 0-.387-.152-.738t-.41-.609-.609-.41-.738-.152q-.773 0-1.336.563l-3.879 3.867-1.102-1.102q-.328-.328-.773-.328-.246 0-.463.117t-.41.293-.369.369-.328.346l6.445 6.445.797-.797q.328-.328.328-.773 0-.234-.088-.428t-.217-.334l-1.09-1.09z"/>
    </svg>
    </button>
    <div class="format-wrapper" id="formatWrapper">
      <div class="format-list" id="formatList">
        <div class="format-option selected" data-value="hex">HEX</div>
        <div class="format-option" data-value="rgb">RGB</div>
        <div class="format-option" data-value="hsl">HSL</div>
      </div>
      <div class="format-arrows">
        <div class="arrows-icon">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M4 6L8 2L12 6M4 10L8 14L12 10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </div>
      </div>
    </div>
    <button class="icon-btn icon-btn-copy" id="copyBtn" title="Copy to clipboard">
      <svg viewBox="0 0 24 24" class="icon-copy">
        <path d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/>
      </svg>
      <svg viewBox="0 0 24 24" class="icon-copied"><path d="M9 16.17L4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z"/></svg>
    </button>
  </div>

  <div class="palette-wrapper" id="palette">
    <div class="palette-handle" id="paletteHandle"></div>
  </div>

  <div class="sliders">
    <div class="slider-track hue-track" id="hueTrack">
      <div class="slider-handle" id="hueHandle"></div>
    </div>
    <div class="slider-track opacity-track" id="opacityTrack">
      <div class="opacity-overlay" id="opacityOverlay"></div>
      <div class="slider-handle" id="opacityHandle"></div>
    </div>
  </div>
`;

const ColorPickerPanelBase = WebComponentBase<ColorPickerEventMap>({ mode: "open" });

@customElement("color-picker-panel")
export default class ColorPickerPanel extends ColorPickerPanelBase implements WebComponent {
  declare _shadowRoot: ShadowRoot;

  private _hsv: [number, number, number] = [0, 1, 1];
  private _alpha: number = 1;
  private displayString!: string;
  private _format: SupportedColorFormat = ColorFormat.HEX;
  private _formatOptionsList = SUPPORTED_COLOR_FORMATS;
  private _formatListExpanded: boolean = false;

  private _elemsMap: {
    palette: HTMLElement;
    paletteHandle: HTMLElement;
    hueTrack: HTMLElement;
    hueHandle: HTMLElement;
    opacityTrack: HTMLElement;
    opacityOverlay: HTMLElement;
    opacityHandle: HTMLElement;
    colorDisplay: HTMLElement;
    formatWrapper: HTMLElement;
    formatList: HTMLElement;
    formatOptions: NodeListOf<HTMLElement>;
    copyBtn: HTMLElement;
    eyedropperBtn: HTMLElement;
  };

  private _abortController!: AbortController;

  constructor() {
    super();

    this._shadowRoot.appendChild(template.content.cloneNode(true));

    this._elemsMap = {
      palette: this._shadowRoot.getElementById("palette")!,
      paletteHandle: this._shadowRoot.getElementById("paletteHandle")!,
      hueTrack: this._shadowRoot.getElementById("hueTrack")!,
      hueHandle: this._shadowRoot.getElementById("hueHandle")!,
      opacityTrack: this._shadowRoot.getElementById("opacityTrack")!,
      opacityOverlay: this._shadowRoot.getElementById("opacityOverlay")!,
      opacityHandle: this._shadowRoot.getElementById("opacityHandle")!,
      colorDisplay: this._shadowRoot.getElementById("colorDisplay")!,
      formatWrapper: this._shadowRoot.getElementById("formatWrapper")!,
      formatList: this._shadowRoot.getElementById("formatList")!,
      formatOptions: this._shadowRoot.querySelectorAll<HTMLElement>(".format-option"),
      copyBtn: this._shadowRoot.getElementById("copyBtn")!,
      eyedropperBtn: this._shadowRoot.getElementById("eyedropperBtn")!,
    };
  }

  connectedCallback() {
    this._abortController = new AbortController();
    const { signal } = this._abortController;

    this._checkEyedropperApiSupport();
    this._attachEventListeners(signal);
    this._updateUI();
  }

  disconnectedCallback() {
    this._abortController.abort();
  }

  private _checkEyedropperApiSupport() {
    if ("EyeDropper" in window) return;

    console.warn("EyeDropper API not supported.");
    this._elemsMap.eyedropperBtn.style.display = "none";
  }

  private _attachEventListeners(signal: AbortSignal) {
    this._setupDrag(
      this._elemsMap.palette,
      (x: number, y: number) => {
        this._hsv[1] = Math.max(0, Math.min(1, x));
        this._hsv[2] = Math.max(0, Math.min(1, 1 - y));
        this._updateUI();
      },
      signal
    );
    this._setupDrag(
      this._elemsMap.hueTrack,
      (x: number) => {
        this._hsv[0] = Math.max(0, Math.min(360, x * 360));
        this._updateUI();
      },
      signal
    );
    this._setupDrag(
      this._elemsMap.opacityTrack,
      (x: number) => {
        this._alpha = Math.max(0, Math.min(1, x));
        this._updateUI();
      },
      signal
    );

    this._elemsMap.formatList.addEventListener("click", this._handleFormatListClick, { signal });
    this._shadowRoot.addEventListener("click", this._handleOutsideClick, { signal });
    document.addEventListener("click", this._handleDocumentClick, { signal });
    this._elemsMap.copyBtn.addEventListener("click", this._handleCopyBtnClick, { signal });
    this._elemsMap.eyedropperBtn.addEventListener("click", this._handleEyedropperClick, { signal });
  }

  private _closeFormatList() {
    this._formatListExpanded = false;
    this._elemsMap.formatList.classList.remove("expanded");
    this._elemsMap.formatList.style.top = "0px";
  }

  private _setupDrag(element: HTMLElement, onMove: onMoveCallback, signal?: AbortSignal) {
    let isDragging = false;
    const update = (ev: PointerEvent) => {
      const rect = element.getBoundingClientRect();
      const x = (ev.clientX - rect.left) / rect.width;
      const y = (ev.clientY - rect.top) / rect.height;
      onMove(x, y);
    };
    const onPointerDown = (ev: PointerEvent) => {
      isDragging = true;
      element.setPointerCapture(ev.pointerId);
      update(ev);
    };
    const onPointerMove = (ev: PointerEvent) => {
      if (!isDragging) return;
      update(ev);
    };
    const onPointerUp = (ev: PointerEvent) => {
      isDragging = false;
      element.releasePointerCapture(ev.pointerId);
      this._emitChange();
    };

    element.addEventListener("pointerdown", onPointerDown, { signal });
    element.addEventListener("pointermove", onPointerMove, { signal });
    element.addEventListener("pointerup", onPointerUp, { signal });
  }

  private _updateUI() {
    const [h, s, v] = this._hsv;
    const [r, g, b] = ColorUtils.hsvToRgb(h, s, v);
    const rgbBase = ColorUtils.hsvToRgb(h, 1, 1); // Pure hue color

    // Output formatting
    let output = "";
    if (this._format === ColorFormat.HEX) {
      output = ColorUtils.rgbToHex(r, g, b, this._alpha);
    } else if (this._format === ColorFormat.RGB) {
      output = ColorUtils.getRgbString(r, g, b, this._alpha);
    } else if (this._format === ColorFormat.HSL) {
      const [h, s, l] = ColorUtils.rgbToHsl(r, g, b);
      output = ColorUtils.getHslString(h, s, l, this._alpha);
    }

    if (!output) return;

    this.displayString = output;

    // Update elements
    this._elemsMap.colorDisplay.textContent = output;
    this._elemsMap.palette.style.backgroundColor = `rgb(${rgbBase[0]}, ${rgbBase[1]}, ${rgbBase[2]})`;

    this._elemsMap.paletteHandle.style.left = `${s * 100}%`;
    this._elemsMap.paletteHandle.style.top = `${(1 - v) * 100}%`;

    this._elemsMap.hueHandle.style.left = `${(h / 360) * 100}%`;
    this._elemsMap.opacityHandle.style.left = `${this._alpha * 100}%`;

    this._elemsMap.opacityOverlay.style.background = `linear-gradient(to right, transparent, rgb(${r}, ${g}, ${b}))`;
  }

  private _emitChange() {
    const [h, s, v] = this._hsv;
    const [r, g, b] = ColorUtils.hsvToRgb(h, s, v);
    const hex = ColorUtils.rgbToHex(r, g, b, this._alpha);

    this.dispatchEvent(
      new CustomEvent<ColorChangedEventShape>(ColorPickerEvents.ColorChanged, {
        bubbles: true,
        composed: true,
        detail: {
          hex,
          r,
          g,
          b,
          alpha: this._alpha,
          displayString: this.displayString,
        },
      })
    );
  }

  private _handleFormatListClick = (ev: PointerEvent) => {
    const target = ev.target! as HTMLElement;
    const option = target.closest(".format-option")! as HTMLElement | null;

    if (!this._formatListExpanded) {
      this._handleFormatListExpand();
    } else {
      this._handleFormatListCollapse(option);
    }
  };

  private _handleFormatListExpand() {
    // Expand the dropdown
    this._formatListExpanded = true;
    this._elemsMap.formatList.classList.add("expanded");

    // Calculate vertical shift so the selected option stays exactly where the wrapper is
    const index = this._formatOptionsList.indexOf(this._format);
    this._elemsMap.formatList.style.top = `-${index * 22}px`;
  }

  private _handleFormatListCollapse(option: HTMLElement | null) {
    // Option selected
    if (option) {
      const value = option.getAttribute("data-value") as SupportedColorFormat;
      this.setFormat(value);
    }
    this._closeFormatList();
  }

  /** Close dropdown when clicking outside (on Document) */
  private _handleDocumentClick = (ev: PointerEvent) => {
    if (!this._formatListExpanded || ev.composedPath().includes(this)) return;

    this._closeFormatList();
  };

  /** Close dropdown when clicking outside (on ColorPickerPanel) */
  private _handleOutsideClick = (ev: Event) => {
    if (this._formatListExpanded && !ev.composedPath().includes(this._elemsMap.formatList)) {
      this._closeFormatList();
    }
  };

  private _handleCopyBtnClick = () => {
    this._handleCopy().catch((_err) => {
      //
    });
  };

  private async _handleCopy() {
    try {
      await navigator.clipboard.writeText(this._elemsMap.colorDisplay.textContent ?? "");

      this._elemsMap.copyBtn.classList.add("copied");

      setTimeout(() => {
        const { signal } = this._abortController;

        if (signal.aborted) return;

        this._elemsMap.copyBtn.classList.remove("copied");
      }, 1000);
    } catch {
      //
    }
  }

  private _handleEyedropperClick = () => {
    this._useEyerDropper().catch((_err) => {
      //
    });
  };

  private async _useEyerDropper() {
    if (!window.EyeDropper) return;

    try {
      const dropper = new EyeDropper();
      const result = await dropper.open();
      const value = result.sRGBHex as ColorFormat.HEX;

      this.setColor(value);
      this._emitChange();
    } catch {
      // User canceled selection
    }
  }

  setFormat(value: SupportedColorFormat) {
    this._format = value;
    // Update selected HTML classes for styling
    this._elemsMap.formatOptions.forEach((opt) => {
      if (opt.getAttribute("data-value") === value) {
        opt.classList.add("selected");
      } else {
        opt.classList.remove("selected");
      }
    });
    this._updateUI();
  }

  setColor(value: string) {
    const parsedColor = ColorUtils.parseColor(value);

    if (!parsedColor) return;

    const { hsv, alpha, format } = parsedColor;

    this._hsv = hsv;
    this._alpha = alpha;

    this.setFormat(format);
  }
}
