import { el } from "@gs2d/ui";
import type { PackSprite } from "../model/PackProject";

export interface SpriteListHooks {
  /** The selection changed (ids in list order). */
  select: (ids: string[]) => void;
  remove: (ids: string[]) => void;
  /** Returns false when the name is taken. */
  rename: (id: string, name: string) => boolean;
}

/**
 * The sprite list with a search box: click, Ctrl+click and Shift+click
 * select, arrows move, F2 or a double-click renames and Delete removes.
 * Pure view: changes go through the hooks.
 */
export class SpriteList {
  private sprites: readonly PackSprite[] = [];
  private selected: ReadonlySet<string> = new Set();
  /** Where Shift+click ranges start. */
  private anchor: string | null = null;
  private editing = false;

  constructor(
    private readonly list: HTMLElement,
    private readonly search: HTMLInputElement,
    private readonly hooks: SpriteListHooks
  ) {
    search.addEventListener("input", () => this.render(this.sprites, this.selected));
    list.addEventListener("click", (ev) => {
      const id = this.idOf(ev.target);
      if (!id || this.editing) return;
      this.click(id, ev.ctrlKey || ev.metaKey, ev.shiftKey);
    });
    list.addEventListener("dblclick", (ev) => {
      const id = this.idOf(ev.target);
      if (id) this.startRename(id);
    });
    list.addEventListener("keydown", (ev) => this.onKey(ev));
  }

  render(sprites: readonly PackSprite[], selected: ReadonlySet<string>): void {
    this.sprites = sprites;
    this.selected = selected;
    this.editing = false;
    const visible = this.visible();
    this.list.replaceChildren(
      ...visible.map((sprite) => {
        const item = el(
          "li",
          { className: "sprite-item", title: sprite.name },
          el("img", { src: sprite.dataUrl, alt: "", loading: "lazy" }),
          el("span", { className: "sprite-name", textContent: sprite.name }),
          el("small", { textContent: `${sprite.width}×${sprite.height}` })
        );
        item.dataset.id = sprite.id;
        item.setAttribute("role", "option");
        item.setAttribute("aria-selected", String(selected.has(sprite.id)));
        return item;
      })
    );
    if (visible.length === 0 && sprites.length > 0) {
      this.list.append(el("li", { className: "empty", textContent: "No sprite matches." }));
    }
  }

  /** Scrolls a sprite into view (e.g. picked on the sheet). */
  reveal(id: string): void {
    this.item(id)?.scrollIntoView({ block: "nearest" });
  }

  private visible(): readonly PackSprite[] {
    const query = this.search.value.trim().toLowerCase();
    return query ? this.sprites.filter((s) => s.name.toLowerCase().includes(query)) : this.sprites;
  }

  private click(id: string, toggle: boolean, range: boolean): void {
    const ids = this.visible().map((s) => s.id);
    const from = this.anchor === null ? -1 : ids.indexOf(this.anchor);
    if (range && from !== -1) {
      const to = ids.indexOf(id);
      this.hooks.select(ids.slice(Math.min(from, to), Math.max(from, to) + 1));
      return;
    }
    this.anchor = id;
    if (!toggle) {
      this.hooks.select([id]);
      return;
    }
    const next = new Set(this.selected);
    if (!next.delete(id)) next.add(id);
    this.hooks.select(this.sprites.map((s) => s.id).filter((s) => next.has(s)));
  }

  private onKey(ev: KeyboardEvent): void {
    if (this.editing) return;
    const ids = this.visible().map((s) => s.id);
    const current = this.anchor ?? ids.find((id) => this.selected.has(id)) ?? "";
    if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
      const step = ev.key === "ArrowDown" ? 1 : -1;
      const at = ids.indexOf(current);
      const next = ids[at === -1 ? 0 : Math.min(ids.length - 1, Math.max(0, at + step))];
      if (next === undefined) return;
      this.anchor = next;
      this.hooks.select([next]);
      this.reveal(next);
    } else if (ev.key === "Delete") {
      this.hooks.remove([...this.selected]);
    } else if (ev.key === "F2" && this.selected.size === 1) {
      this.startRename([...this.selected][0]);
    } else if (ev.key.toLowerCase() === "a" && (ev.ctrlKey || ev.metaKey)) {
      this.hooks.select(ids);
    } else {
      return;
    }
    ev.preventDefault();
    ev.stopPropagation();
  }

  private startRename(id: string): void {
    const sprite = this.sprites.find((s) => s.id === id);
    const label = this.item(id)?.querySelector<HTMLElement>(".sprite-name");
    if (!sprite || !label) return;
    this.editing = true;
    const input = el("input", { className: "input input-small", value: sprite.name });
    input.setAttribute("aria-label", "Sprite name");
    label.replaceWith(input);
    input.focus();
    input.select();
    let done = false;
    const finish = (save: boolean) => {
      if (done) return;
      done = true;
      this.editing = false;
      // A taken name is refused: the list goes back to the old one.
      if (save) this.hooks.rename(id, input.value);
      this.render(this.sprites, this.selected);
      this.list.focus();
    };
    input.addEventListener("keydown", (ev) => {
      ev.stopPropagation();
      if (ev.key === "Enter") finish(true);
      else if (ev.key === "Escape") finish(false);
    });
    input.addEventListener("blur", () => finish(true));
  }

  private item(id: string): HTMLElement | undefined {
    return [...this.list.querySelectorAll<HTMLElement>("[data-id]")].find(
      (i) => i.dataset.id === id
    );
  }

  private idOf(target: EventTarget | null): string | undefined {
    return (target as Element | null)?.closest<HTMLElement>("[data-id]")?.dataset.id;
  }
}
