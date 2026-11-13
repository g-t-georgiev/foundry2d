import type { LevelProject } from "../model/LevelProject";
import type { LayerDef } from "../model/types";

export interface SettingsDialogHooks {
  /** Called after edits that make existing undo steps unsafe (removing data). */
  onDestructiveChange: () => void;
  confirm: (message: string) => boolean;
}

/**
 * Project settings: grid size and layer definitions (IntGrid layers and
 * their values). Edits apply immediately to the live project.
 */
export default class SettingsDialog {
  private project: LevelProject | null = null;
  private selectedUid: number | null = null;
  private readonly gridSizeInput: HTMLInputElement;
  private readonly defsList: HTMLElement;
  private readonly editor: HTMLElement;

  constructor(
    private readonly dialog: HTMLDialogElement,
    private readonly hooks: SettingsDialogHooks
  ) {
    this.gridSizeInput = dialog.querySelector("#gridSizeInput")!;
    this.defsList = dialog.querySelector("#defsList")!;
    this.editor = dialog.querySelector("#defEditor")!;

    this.gridSizeInput.addEventListener("change", () => {
      const size = Number(this.gridSizeInput.value);
      if (this.project && Number.isInteger(size) && size >= 1 && size <= 256) {
        this.project.setGridSize(size);
      } else if (this.project) {
        this.gridSizeInput.value = String(this.project.gridSize);
      }
    });

    dialog.querySelector("#addLayerDef")!.addEventListener("click", () => {
      if (!this.project) return;
      const def = this.project.addIntGridLayer("intgrid");
      this.selectedUid = def.uid;
      this.render();
    });

    this.defsList.addEventListener("click", (ev) => {
      const item = (ev.target as Element).closest<HTMLElement>("[data-uid]");
      if (!item) return;
      this.selectedUid = Number(item.dataset.uid);
      this.render();
    });
  }

  open(project: LevelProject, layerDefUid: number | null = null): void {
    this.project = project;
    this.selectedUid = layerDefUid ?? project.defs.layers.at(-1)?.uid ?? null;
    this.render();
    if (!this.dialog.open) this.dialog.showModal();
  }

  close(): void {
    if (this.dialog.open) this.dialog.close();
  }

  private render(): void {
    const project = this.project;
    if (!project) return;
    this.gridSizeInput.value = String(project.gridSize);

    if (!project.getLayerDef(this.selectedUid ?? -1)) {
      this.selectedUid = project.defs.layers.at(-1)?.uid ?? null;
    }

    // Top of the stack first, like the layers panel.
    const items = [...project.defs.layers].reverse().map((def) => {
      const li = document.createElement("li");
      li.dataset.uid = String(def.uid);
      li.setAttribute("role", "option");
      li.setAttribute("aria-selected", String(def.uid === this.selectedUid));
      li.textContent = def.identifier;
      const meta = document.createElement("small");
      meta.textContent = `${def.type} · ${def.intGridValues.length}`;
      li.append(meta);
      return li;
    });
    this.defsList.replaceChildren(...items);

    const def = project.getLayerDef(this.selectedUid ?? -1);
    this.editor.replaceChildren(...(def ? this.renderEditor(project, def) : []));
  }

  private renderEditor(project: LevelProject, def: LayerDef): HTMLElement[] {
    const nameField = document.createElement("label");
    nameField.className = "field";
    const nameLabel = document.createElement("span");
    nameLabel.className = "label";
    nameLabel.textContent = "Identifier (used as the export key)";
    const nameInput = document.createElement("input");
    nameInput.className = "input";
    nameInput.value = def.identifier;
    nameInput.spellcheck = false;
    nameInput.addEventListener("change", () => {
      project.renameLayerDef(def.uid, nameInput.value);
      this.render();
    });
    nameField.append(nameLabel, nameInput);

    const valuesTitle = document.createElement("span");
    valuesTitle.className = "label";
    valuesTitle.textContent = "Values (0 is always empty)";

    const table = document.createElement("div");
    table.className = "values-table";
    for (const entry of def.intGridValues) {
      const row = document.createElement("div");
      row.className = "value-row";

      const number = document.createElement("span");
      number.className = "value-number";
      number.textContent = String(entry.value);

      const id = document.createElement("input");
      id.className = "input";
      id.value = entry.identifier;
      id.spellcheck = false;
      id.setAttribute("aria-label", `Name of value ${entry.value}`);
      id.addEventListener("change", () => {
        const identifier = id.value.trim();
        if (identifier) project.updateIntGridValue(def.uid, entry.value, { identifier });
        else id.value = entry.identifier;
      });

      const color = document.createElement("input");
      color.type = "color";
      color.value = entry.color.length === 7 ? entry.color : "#ff00ff";
      color.setAttribute("aria-label", `Color of value ${entry.value}`);
      color.addEventListener("input", () =>
        project.updateIntGridValue(def.uid, entry.value, { color: color.value })
      );

      const remove = document.createElement("button");
      remove.className = "btn btn-icon btn-danger";
      remove.textContent = "✕";
      remove.title = `Remove value ${entry.value}`;
      remove.setAttribute("aria-label", remove.title);
      remove.addEventListener("click", () => {
        const message = `Remove "${entry.identifier}"? Cells using it are cleared in every level. This can't be undone.`;
        if (!this.hooks.confirm(message)) return;
        project.removeIntGridValue(def.uid, entry.value);
        this.hooks.onDestructiveChange();
        this.render();
      });

      row.append(number, id, color, remove);
      table.append(row);
    }

    const footer = document.createElement("div");
    footer.className = "def-editor-footer";

    const addValue = document.createElement("button");
    addValue.className = "btn btn-small";
    addValue.textContent = "+ Value";
    addValue.addEventListener("click", () => {
      project.addIntGridValue(def.uid);
      this.render();
    });

    const deleteLayer = document.createElement("button");
    deleteLayer.className = "btn btn-small btn-danger";
    deleteLayer.textContent = "Delete layer";
    deleteLayer.disabled = project.defs.layers.length <= 1;
    deleteLayer.addEventListener("click", () => {
      const message = `Delete layer "${def.identifier}" and its data in every level? This can't be undone.`;
      if (!this.hooks.confirm(message)) return;
      project.removeLayerDef(def.uid);
      this.hooks.onDestructiveChange();
      this.render();
    });

    footer.append(addValue, deleteLayer);
    return [nameField, valuesTitle, table, footer];
  }
}
