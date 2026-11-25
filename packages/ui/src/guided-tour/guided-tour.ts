import { customElement, type WebComponent, WebComponentBase } from "../core";
import type { Tour, TourResult, TourStep } from "./types";

const template = document.createElement("template");
template.innerHTML = `
  <style>
    :host {
      --_bg: var(--theme-bg-panel, #18181c);
      --_border: var(--theme-border-color, #2a2a32);
      --_text: var(--theme-text-main, #f4f4f5);
      --_muted: var(--theme-text-muted, #a1a1aa);
      --_primary: var(--theme-color-primary, #2563eb);
      --_accent: var(--theme-color-accent, #38bdf8);
      font: 13px/1.45 var(--theme-font, system-ui, sans-serif);
    }
    /* A manual popover: in the top layer, over dialogs and menus too. */
    .layer {
      position: fixed;
      inset: 0;
      width: 100vw;
      height: 100vh;
      max-width: none;
      max-height: none;
      margin: 0;
      padding: 0;
      border: 0;
      background: transparent;
      overflow: hidden;
      color: var(--_text);
    }
    .layer:not(:popover-open):not(.open) { display: none; }
    /* The spotlight: a hole in a dark veil, around what the step points at. */
    .spot {
      position: absolute;
      border-radius: 8px;
      box-shadow: 0 0 0 200vmax rgba(0, 0, 0, 0.55);
      outline: 2px solid var(--_accent);
      outline-offset: 2px;
      transition: all 0.2s ease;
      pointer-events: none;
    }
    .spot.centred { width: 0; height: 0; outline: none; }
    .card {
      position: absolute;
      width: min(340px, calc(100vw - 24px));
      padding: 14px 16px 12px;
      background: var(--_bg);
      border: 1px solid var(--_border);
      border-radius: 10px;
      box-shadow: 0 16px 40px rgba(0, 0, 0, 0.5);
    }
    .count { color: var(--_muted); font-size: 11px; letter-spacing: 0.04em; text-transform: uppercase; }
    h2 { margin: 2px 0 6px; font-size: 15px; }
    p { margin: 0 0 10px; }
    a { color: var(--_accent); }
    .actions { display: flex; align-items: center; gap: 8px; margin-top: 4px; }
    .spacer { flex: 1; }
    button {
      font: inherit;
      color: var(--_text);
      background: var(--theme-bg-card, #222228);
      border: 1px solid var(--_border);
      border-radius: 6px;
      padding: 5px 12px;
      cursor: pointer;
    }
    button:hover:not(:disabled) { background: var(--theme-bg-card-hover, #2d2d35); }
    button:disabled { opacity: 0.45; cursor: default; }
    button:focus-visible { outline: 2px solid var(--_accent); outline-offset: 1px; }
    .next { background: var(--_primary); border-color: var(--_primary); color: #fff; }
    .skip { background: none; border-color: transparent; color: var(--_muted); padding-left: 4px; }
  </style>
  <div class="layer" popover="manual">
    <div class="spot centred"></div>
    <div class="card" role="dialog" aria-modal="true" aria-labelledby="title">
      <div class="count" id="count"></div>
      <h2 id="title"></h2>
      <p id="text"></p>
      <p id="more" hidden><a id="link" target="_blank" rel="noopener"></a></p>
      <div class="actions">
        <button class="skip" data-action="skip">Skip tour</button>
        <span class="spacer"></span>
        <button data-action="back">Back</button>
        <button class="next" data-action="next">Next</button>
      </div>
    </div>
  </div>
`;

const Base = WebComponentBase({ mode: "open" });

/** Room between the target and the card, and to the window's edges. */
const GAP = 12;

/**
 * A guided tour: a spotlight on part of the page with a message card
 * (Back, Next, Skip). Steps whose target isn't on screen are shown centred.
 * Keys: → or Enter next, ← back, Esc skip; other shortcuts are held back
 * while the tour runs, so the app behind it doesn't react.
 */
@customElement("guided-tour")
export default class GuidedTour extends Base implements WebComponent {
  declare _shadowRoot: ShadowRoot;
  private readonly layer: HTMLElement;
  private steps: TourStep[] = [];
  private index = 0;
  private finish: ((result: TourResult) => void) | null = null;
  private readonly onKey = (ev: KeyboardEvent) => this.key(ev);
  private readonly reposition = () => this.place();

  constructor() {
    super();
    this._shadowRoot.appendChild(template.content.cloneNode(true));
    this.layer = this._shadowRoot.querySelector(".layer")!;
    this.layer.addEventListener("click", (ev) => {
      const action = (ev.target as Element).closest<HTMLElement>("[data-action]")?.dataset.action;
      if (action === "next") this.go(this.index + 1);
      else if (action === "back") this.go(this.index - 1);
      else if (action === "skip") this.end("skipped");
    });
  }

  /** Whether a tour is showing. */
  get running(): boolean {
    return this.finish !== null;
  }

  /** Runs a tour; resolves when it is finished or skipped. A running tour is skipped first. */
  start(tour: Tour): Promise<TourResult> {
    if (this.finish) this.end("skipped");
    this.steps = tour.steps;
    this.index = 0;
    const done = new Promise<TourResult>((resolve) => (this.finish = resolve));
    if (typeof this.layer.showPopover === "function") this.layer.showPopover();
    else this.layer.classList.add("open");
    window.addEventListener("keydown", this.onKey, true);
    window.addEventListener("resize", this.reposition);
    window.addEventListener("scroll", this.reposition, true);
    this.go(0);
    return done;
  }

  /** Ends the tour as skipped. */
  stop(): void {
    if (this.finish) this.end("skipped");
  }

  private go(index: number): void {
    if (index >= this.steps.length) {
      this.end("done");
      return;
    }
    this.index = Math.max(0, index);
    const step = this.steps[this.index];
    const $ = (id: string) => this._shadowRoot.getElementById(id)!;
    $("count").textContent = `${this.index + 1} of ${this.steps.length}`;
    $("title").textContent = step.title;
    $("text").textContent = step.text;
    $("more").hidden = !step.link;
    if (step.link) {
      const link = $("link") as HTMLAnchorElement;
      link.textContent = `${step.link.label} ↗`;
      link.href = step.link.href;
    }
    const back = this.button("back");
    back.disabled = this.index === 0;
    const last = this.index === this.steps.length - 1;
    this.button("next").textContent = last ? "Done" : "Next";
    this.button("skip").hidden = last;
    this.target()?.scrollIntoView({ block: "nearest", inline: "nearest" });
    this.place();
    this.button("next").focus();
  }

  private button(action: string): HTMLButtonElement {
    return this._shadowRoot.querySelector(`[data-action="${action}"]`)!;
  }

  /** The current step's target, when it is on screen. */
  private target(): HTMLElement | null {
    const selector = this.steps[this.index]?.target;
    const element = selector ? document.querySelector<HTMLElement>(selector) : null;
    if (!element) return null;
    const box = element.getBoundingClientRect();
    return box.width > 0 && box.height > 0 ? element : null;
  }

  /** Puts the spotlight on the target and the card next to it, inside the window. */
  private place(): void {
    if (!this.finish) return;
    const spot = this._shadowRoot.querySelector<HTMLElement>(".spot")!;
    const card = this._shadowRoot.querySelector<HTMLElement>(".card")!;
    const view = { width: window.innerWidth, height: window.innerHeight };
    const size = card.getBoundingClientRect();
    const element = this.target();
    if (!element) {
      spot.classList.add("centred");
      Object.assign(spot.style, { left: `${view.width / 2}px`, top: `${view.height / 2}px` });
      card.style.left = `${Math.max(GAP, (view.width - size.width) / 2)}px`;
      card.style.top = `${Math.max(GAP, (view.height - size.height) / 2)}px`;
      return;
    }
    const pad = 4;
    const raw = element.getBoundingClientRect();
    // Clipped to the window, so a huge target (a canvas) still leaves room.
    const box = {
      left: Math.max(raw.left, 0),
      top: Math.max(raw.top, 0),
      right: Math.min(raw.right, view.width),
      bottom: Math.min(raw.bottom, view.height),
    };
    spot.classList.remove("centred");
    Object.assign(spot.style, {
      left: `${box.left - pad}px`,
      top: `${box.top - pad}px`,
      width: `${box.right - box.left + pad * 2}px`,
      height: `${box.bottom - box.top + pad * 2}px`,
    });
    const fits = {
      below: view.height - box.bottom - GAP >= size.height + GAP,
      above: box.top - GAP >= size.height + GAP,
      right: view.width - box.right - GAP >= size.width + GAP,
      left: box.left - GAP >= size.width + GAP,
    };
    const centreX = (box.left + box.right) / 2 - size.width / 2;
    const centreY = (box.top + box.bottom) / 2 - size.height / 2;
    let x: number;
    let y: number;
    if (fits.below) [x, y] = [centreX, box.bottom + GAP];
    else if (fits.above) [x, y] = [centreX, box.top - GAP - size.height];
    else if (fits.right) [x, y] = [box.right + GAP, centreY];
    else if (fits.left) [x, y] = [box.left - GAP - size.width, centreY];
    else [x, y] = [centreX, centreY]; // over a target as big as the window
    card.style.left = `${Math.min(Math.max(GAP, x), view.width - size.width - GAP)}px`;
    card.style.top = `${Math.min(Math.max(GAP, y), view.height - size.height - GAP)}px`;
  }

  private key(ev: KeyboardEvent): void {
    // Tab moves between the card's buttons.
    if (ev.key === "Tab") return;
    const inCard = ev.composedPath().includes(this.layer);
    if (ev.key === "Escape") this.end("skipped");
    else if (ev.key === "ArrowRight") this.go(this.index + 1);
    else if (ev.key === "ArrowLeft") this.go(this.index - 1);
    else if ((ev.key === "Enter" || ev.key === " ") && inCard) return; // the focused button acts
    else if (ev.key === "Enter") this.go(this.index + 1);
    ev.preventDefault();
    ev.stopPropagation();
  }

  private end(result: TourResult): void {
    const finish = this.finish;
    this.finish = null;
    window.removeEventListener("keydown", this.onKey, true);
    window.removeEventListener("resize", this.reposition);
    window.removeEventListener("scroll", this.reposition, true);
    if (typeof this.layer.hidePopover === "function" && this.layer.matches(":popover-open")) {
      this.layer.hidePopover();
    }
    this.layer.classList.remove("open");
    finish?.(result);
  }
}
