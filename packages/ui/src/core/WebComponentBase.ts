import type { WebComponent } from "./types";

/** Web Component base class */
export default function WebComponentBase<
  EventMap extends HTMLElementEventMap = HTMLElementEventMap,
>(shadowRootInit: ShadowRootInit) {
  return class WebComponentBase extends HTMLElement implements WebComponent {
    public readonly _shadowRoot: ShadowRoot;

    constructor() {
      super();

      if (new.target === WebComponentBase) {
        throw new Error(`Cannot construct abstract class ${this.constructor.name} directly.`);
      }

      this._shadowRoot = this.attachShadow(shadowRootInit);
    }

    public addEventListener<K extends keyof EventMap>(
      type: K,
      listener: (this: this, event: EventMap[K]) => void,
      options?: boolean | AddEventListenerOptions
    ): void;
    public addEventListener(
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions
    ): void;
    public addEventListener(
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions
    ) {
      super.addEventListener(type, listener, options);
    }

    public removeEventListener<K extends keyof EventMap>(
      type: K,
      listener: (this: this, event: EventMap[K]) => void,
      options?: boolean | EventListenerOptions
    ): void;
    public removeEventListener(
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | EventListenerOptions
    ): void;
    public removeEventListener(
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | EventListenerOptions
    ) {
      super.removeEventListener(type, listener, options);
    }
  };
}
