import { customElement, type WebComponent, WebComponentBase } from "../core";
import {
  ProjectBrowserEvents,
  type ProjectBrowserData,
  type ProjectBrowserEventName,
  type ProjectBrowserEventPayloads,
  type ProjectBrowserEventMap,
} from "./types";

const template = document.createElement("template");
template.innerHTML = `
  <style>
    :host {
      --_bg: var(--browser-bg, #18181c);
      --_card: var(--browser-card, #222228);
      --_card-hover: var(--browser-card-hover, #2d2d35);
      --_border: var(--browser-border, #2a2a32);
      --_text: var(--browser-text, #f4f4f5);
      --_muted: var(--browser-muted, #a1a1aa);
      --_accent: var(--browser-accent, #38bdf8);
      --_primary: var(--browser-primary, #2563eb);
      --_danger: var(--browser-danger, #e5484d);
      font: 13px/1.35 var(--browser-font, system-ui, sans-serif);
    }
    dialog {
      width: min(880px, 94vw);
      max-height: 88vh;
      padding: 0;
      color: var(--_text);
      background: var(--_bg);
      border: 1px solid var(--_border);
      border-radius: 10px;
      box-shadow: 0 24px 70px rgba(0, 0, 0, 0.6);
    }
    dialog::backdrop { background: rgba(0, 0, 0, 0.6); }
    header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 12px 16px;
      border-bottom: 1px solid var(--_border);
    }
    h2 { margin: 0; font-size: 15px; }
    h3 {
      margin: 0 0 8px;
      font-size: 11px;
      font-weight: 600;
      letter-spacing: 0.05em;
      text-transform: uppercase;
      color: var(--_muted);
    }
    .body { display: flex; flex-direction: column; gap: 18px; padding: 16px; overflow-y: auto; max-height: calc(88vh - 60px); }
    .warning {
      padding: 8px 12px;
      border-radius: 6px;
      background: rgba(229, 72, 77, 0.15);
      border: 1px solid rgba(229, 72, 77, 0.5);
    }
    button {
      font: inherit;
      color: var(--_text);
      background: var(--_card);
      border: 1px solid var(--_border);
      border-radius: 6px;
      padding: 6px 12px;
      cursor: pointer;
    }
    button:hover { background: var(--_card-hover); }
    button:focus-visible { outline: 2px solid var(--_accent); outline-offset: 1px; }
    .primary { background: var(--_primary); border-color: var(--_primary); }
    .icon { padding: 2px 8px; }
    .templates { display: flex; flex-wrap: wrap; gap: 8px; }
    .template { text-align: left; max-width: 240px; }
    .template small { display: block; color: var(--_muted); margin-top: 2px; }
    .row { display: flex; align-items: center; gap: 8px; }
    .recent { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 4px; }
    .recent li { display: flex; align-items: center; gap: 8px; }
    .recent .open { flex: 1; text-align: left; display: flex; justify-content: space-between; }
    .recent time, .card time { color: var(--_muted); font-size: 11px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; }
    .card {
      position: relative;
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 8px;
      text-align: left;
    }
    .card[aria-current="true"] { border-color: var(--_accent); }
    .thumb {
      height: 96px;
      border-radius: 4px;
      background: repeating-conic-gradient(#26262c 0% 25%, #1e1e23 0% 50%) 0 0 / 12px 12px;
      display: grid;
      place-items: center;
      overflow: hidden;
    }
    .thumb img { max-width: 100%; max-height: 100%; image-rendering: pixelated; }
    .name { font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .delete {
      position: absolute;
      top: 4px;
      right: 4px;
      padding: 0 6px;
      opacity: 0;
    }
    div:hover > .delete, .delete:focus-visible { opacity: 1; }
    .delete:hover { background: var(--_danger); border-color: var(--_danger); }
    .empty { color: var(--_muted); margin: 0; }
  </style>
  <dialog aria-labelledby="title">
    <header>
      <h2 id="title">Projects</h2>
      <button class="icon" data-action="close" aria-label="Close">✕</button>
    </header>
    <div class="body">
      <div class="warning" id="warning" hidden></div>
      <section>
        <h3>New</h3>
        <div class="templates" id="templates"></div>
      </section>
      <section>
        <h3>Open</h3>
        <div class="row">
          <button class="primary" data-action="open-file">Open file…</button>
        </div>
      </section>
      <section id="recentSection">
        <h3>Recent files</h3>
        <ul class="recent" id="recent"></ul>
      </section>
      <section>
        <h3>In this browser</h3>
        <div class="grid" id="library"></div>
      </section>
    </div>
  </dialog>
`;

const Base = WebComponentBase<ProjectBrowserEventMap>({ mode: "open" });

const formatDate = (ms: number) =>
  new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

/**
 * Start screen / Open dialog. Controlled: the host sets `data` and handles the
 * events; choosing something closes the dialog (delete/remove don't).
 */
@customElement("project-browser")
export default class ProjectBrowser extends Base implements WebComponent {
  declare _shadowRoot: ShadowRoot;
  private _data: ProjectBrowserData = { title: "Projects", templates: [], library: [], recent: [] };
  private readonly dialog: HTMLDialogElement;

  constructor() {
    super();
    this._shadowRoot.appendChild(template.content.cloneNode(true));
    this.dialog = this._shadowRoot.querySelector("dialog")!;
    this.dialog.addEventListener("click", (ev) => this.onClick(ev));
  }

  get data(): ProjectBrowserData {
    return this._data;
  }

  set data(value: ProjectBrowserData) {
    this._data = value;
    this.render();
  }

  get isOpen(): boolean {
    return this.dialog.open;
  }

  show(data?: ProjectBrowserData): void {
    if (data) this.data = data;
    if (!this.dialog.open) this.dialog.showModal();
  }

  close(): void {
    if (this.dialog.open) this.dialog.close();
  }

  private emit<K extends ProjectBrowserEventName>(
    type: K,
    detail: ProjectBrowserEventPayloads[K]
  ): void {
    this.dispatchEvent(new CustomEvent(type, { detail, bubbles: true, composed: true }));
  }

  private onClick(ev: MouseEvent): void {
    // Clicking the backdrop (the dialog element itself) closes it.
    if (ev.target === this.dialog) {
      this.close();
      return;
    }
    const button = (ev.target as Element).closest<HTMLElement>("[data-action]");
    if (!button) return;
    const id = button.dataset.id ?? "";
    switch (button.dataset.action) {
      case "close":
        this.close();
        break;
      case "new":
        this.close();
        this.emit(ProjectBrowserEvents.New, { templateId: id });
        break;
      case "open-file":
        this.close();
        this.emit(ProjectBrowserEvents.OpenFile, undefined);
        break;
      case "open-recent":
        this.close();
        this.emit(ProjectBrowserEvents.OpenRecent, { id });
        break;
      case "remove-recent":
        this.emit(ProjectBrowserEvents.RemoveRecent, { id });
        break;
      case "open-library":
        this.close();
        this.emit(ProjectBrowserEvents.OpenLibrary, { id });
        break;
      case "delete-library":
        ev.stopPropagation();
        this.emit(ProjectBrowserEvents.DeleteLibrary, { id });
        break;
    }
  }

  private button(action: string, id: string, className = ""): HTMLButtonElement {
    const button = document.createElement("button");
    button.dataset.action = action;
    button.dataset.id = id;
    if (className) button.className = className;
    return button;
  }

  private render(): void {
    const $ = (id: string) => this._shadowRoot.getElementById(id)!;
    const data = this._data;
    $("title").textContent = data.title;

    const warning = $("warning");
    warning.hidden = !data.warning;
    warning.textContent = data.warning ?? "";

    $("templates").replaceChildren(
      ...data.templates.map((t) => {
        const button = this.button("new", t.id, "template");
        button.append(t.label);
        if (t.description) {
          const small = document.createElement("small");
          small.textContent = t.description;
          button.append(small);
        }
        return button;
      })
    );

    $("recentSection").hidden = data.recent.length === 0;
    $("recent").replaceChildren(
      ...data.recent.map((r) => {
        const li = document.createElement("li");
        const open = this.button("open-recent", r.id, "open");
        const name = document.createElement("span");
        name.textContent = r.name;
        const time = document.createElement("time");
        time.textContent = formatDate(r.openedAt);
        open.append(name, time);
        const remove = this.button("remove-recent", r.id, "icon");
        remove.textContent = "✕";
        remove.title = `Remove ${r.name} from recent files`;
        remove.setAttribute("aria-label", remove.title);
        li.append(open, remove);
        return li;
      })
    );

    const library = $("library");
    if (data.library.length === 0) {
      const empty = document.createElement("p");
      empty.className = "empty";
      empty.textContent = "Nothing saved yet. Press Ctrl+S to keep a project here.";
      library.replaceChildren(empty);
      return;
    }
    library.replaceChildren(
      ...data.library.map((p) => {
        const card = this.button("open-library", p.id, "card");
        card.setAttribute("aria-current", String(p.id === data.currentId));
        const thumb = document.createElement("div");
        thumb.className = "thumb";
        if (p.thumbnail) {
          const img = document.createElement("img");
          img.src = p.thumbnail;
          img.alt = "";
          thumb.append(img);
        }
        const name = document.createElement("span");
        name.className = "name";
        name.textContent = p.name;
        const time = document.createElement("time");
        time.textContent = formatDate(p.updatedAt);
        const remove = this.button("delete-library", p.id, "delete");
        remove.textContent = "✕";
        remove.title = `Delete ${p.name} from this browser`;
        remove.setAttribute("aria-label", remove.title);
        card.append(thumb, name, time);
        // A button can't contain a button: wrap the card.
        const wrap = document.createElement("div");
        wrap.style.position = "relative";
        wrap.append(card, remove);
        return wrap;
      })
    );
  }
}
