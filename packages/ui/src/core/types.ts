export interface WebComponent extends HTMLElement {
  /**
   * Called when the element is inserted into a document-connected DOM.
   * Ideal for setup, fetching data, and rendering.
   */
  connectedCallback?(): void;

  /**
   * Called when the element is removed from a document-connected DOM.
   * Ideal for cleanups, removing event listeners, and clearing intervals.
   */
  disconnectedCallback?(): void;

  /**
   * Called when the element is moved to a new document (e.g., inside an iframe).
   */
  adoptedCallback?(): void;

  /**
   * Called when one of the attributes listed in `observedAttributes` changes.
   */
  attributeChangedCallback?(name: string, oldValue: string | null, newValue: string | null): void;
}

export interface WebComponentConstructor extends CustomElementConstructor {
  new (...args: unknown[]): HTMLElement & WebComponent;
  /**
   * @static
   * Lists the attributes that will trigger `attributeChangedCallback`.
   */
  readonly observedAttributes?: string[];
}

export type TemplateFactory<T> = (props: T) => string;

/** Allow strings, numbers, booleans, or a function that evaluates to one of those based on props */
export type TemplateValue<T> =
  | string
  | number
  | boolean
  | null
  | undefined
  | ((props: T) => string | number | boolean | null | undefined);
