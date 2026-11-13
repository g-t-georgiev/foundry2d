import type { LevelProject } from "../model/LevelProject";

export interface LevelsListHooks {
  select: (uid: number) => void;
  open: (uid: number) => void;
  add: () => void;
  duplicate: (uid: number) => void;
  remove: (uid: number) => void;
  move: (uid: number, direction: "up" | "down") => void;
  rename: (uid: number, identifier: string) => void;
}

/**
 * Levels list for the world view: click to select (and frame), double-click
 * to open, double-click the name or press F2 to rename. The rail acts on the
 * selected level. Pure view: all changes go through the hooks.
 */
export default class LevelsListView {
  private editingUid: number | null = null;
  private project: LevelProject | null = null;
  private selectedUid: number | null = null;

  constructor(
    private readonly list: HTMLElement,
    private readonly rail: HTMLElement,
    private readonly hooks: LevelsListHooks
  ) {
    rail.addEventListener("click", (ev) => {
      const button = (ev.target as Element).closest<HTMLButtonElement>("[data-level-action]");
      if (!button || button.disabled) return;
      const uid = this.selectedUid;
      switch (button.dataset.levelAction) {
        case "add":
          hooks.add();
          break;
        case "duplicate":
          if (uid !== null) hooks.duplicate(uid);
          break;
        case "up":
          if (uid !== null) hooks.move(uid, "up");
          break;
        case "down":
          if (uid !== null) hooks.move(uid, "down");
          break;
        case "delete":
          if (uid !== null) hooks.remove(uid);
          break;
      }
    });

    list.addEventListener("click", (ev) => {
      const item = (ev.target as Element).closest<HTMLElement>("[data-uid]");
      if (item && this.editingUid === null) hooks.select(Number(item.dataset.uid));
    });
    list.addEventListener("dblclick", (ev) => {
      const item = (ev.target as Element).closest<HTMLElement>("[data-uid]");
      if (!item) return;
      const uid = Number(item.dataset.uid);
      if ((ev.target as Element).closest(".level-name")) this.startRename(uid);
      else hooks.open(uid);
    });
    list.addEventListener("keydown", (ev) => {
      if (this.editingUid !== null || this.selectedUid === null || !this.project) return;
      const levels = this.project.levels;
      const index = levels.findIndex((l) => l.uid === this.selectedUid);
      if (ev.key === "ArrowDown" || ev.key === "ArrowUp") {
        ev.preventDefault();
        const next = levels[index + (ev.key === "ArrowDown" ? 1 : -1)];
        if (next) hooks.select(next.uid);
      } else if (ev.key === "Enter") {
        ev.preventDefault();
        hooks.open(this.selectedUid);
      } else if (ev.key === "F2") {
        ev.preventDefault();
        this.startRename(this.selectedUid);
      }
    });
  }

  render(project: LevelProject, selectedUid: number | null): void {
    this.project = project;
    this.selectedUid = selectedUid;
    if (this.editingUid !== null) return;

    const linear = project.worldLayout === "linearH" || project.worldLayout === "linearV";
    const items = project.levels.map((level, index) => {
      const li = document.createElement("li");
      li.dataset.uid = String(level.uid);
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", String(level.uid === selectedUid));
      li.title = "Double-click to open · double-click the name to rename";

      const order = document.createElement("span");
      order.className = "level-order";
      order.textContent = linear ? String(index + 1) : "";

      const name = document.createElement("span");
      name.className = "level-name";
      name.textContent = level.identifier;

      const size = document.createElement("span");
      size.className = "level-size";
      size.textContent = `${level.width}×${level.height}`;

      li.append(order, name, size);
      return li;
    });
    this.list.replaceChildren(...items);

    const index = project.levels.findIndex((l) => l.uid === selectedUid);
    const has = index !== -1;
    const set = (action: string, enabled: boolean) => {
      const button = this.rail.querySelector<HTMLButtonElement>(`[data-level-action="${action}"]`);
      if (button) button.disabled = !enabled;
    };
    set("duplicate", has);
    set("delete", has && project.levels.length > 1);
    set("up", has && index > 0);
    set("down", has && index < project.levels.length - 1);
  }

  startRename(uid: number): void {
    const project = this.project;
    const level = project?.getLevel(uid);
    const nameCell = this.list.querySelector<HTMLElement>(`[data-uid="${uid}"] .level-name`);
    if (!project || !level || !nameCell) return;

    this.editingUid = uid;
    const input = document.createElement("input");
    input.className = "input";
    input.value = level.identifier;
    input.spellcheck = false;
    input.setAttribute("aria-label", "Level name");
    nameCell.replaceChildren(input);
    input.focus();
    input.select();

    let done = false;
    const finish = (commit: boolean) => {
      if (done) return;
      done = true;
      this.editingUid = null;
      const value = input.value.trim();
      if (commit && value && value !== level.identifier) this.hooks.rename(uid, value);
      this.render(project, this.selectedUid);
    };
    input.addEventListener("keydown", (ev) => {
      ev.stopPropagation();
      if (ev.key === "Enter") finish(true);
      else if (ev.key === "Escape") finish(false);
    });
    input.addEventListener("blur", () => finish(true));
  }
}
