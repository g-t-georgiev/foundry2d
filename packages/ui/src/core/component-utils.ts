import type { TemplateFactory, TemplateValue, WebComponentConstructor } from "./types";

/** A tagged template utility for creating typed HTML string factories.*/
export function html<T = Record<string, unknown>>(
  strings: TemplateStringsArray,
  ...values: TemplateValue<T>[]
): TemplateFactory<T> {
  return (props: T) => {
    return strings.reduce((result, str, i) => {
      const val = values[i - 1];
      // If the interpolated value is a function, pass it the props. Otherwise, use it directly.
      const resolved = typeof val === "function" ? val(props) : val;
      return result + (resolved ?? "") + str;
    });
  };
}

/**
 * Decorator factory that registers a custom HTML element.
 * Accepts the element's tag name as an argument.
 */
export function customElement(tagName: string) {
  return function (target: WebComponentConstructor) {
    customElements.define(tagName, target);
  };
}
