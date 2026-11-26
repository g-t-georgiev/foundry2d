/**
 * Small DOM builders shared by the apps' hand-built panels and dialogs.
 * The class names they use (`field`, `label`, `field-pair`) are styled by
 * `@gs2d/ui/theme/components.css`.
 */

/** Creates an element with properties and children: `el("button", { textContent: "OK" })`. */
export const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

/**
 * A labelled form row, `<label class="field">` with the label text above its
 * control. Several controls sit side by side in a `.field-pair`.
 */
export const fieldRow = (label: string, ...controls: HTMLElement[]): HTMLLabelElement =>
  el(
    "label",
    { className: "field" },
    el("span", { className: "label", textContent: label }),
    ...(controls.length === 1 ? controls : [el("span", { className: "field-pair" }, ...controls)])
  );
