import type { LevelProject } from "../model/LevelProject";
import { tilesetGrid } from "../model/tiles";
import type { LayerDef, TilesetDef } from "../model/types";
import { isPixelSpriteFile, sheetToDataUrl, spriteToSheet } from "../io/spriteImport";
import EntityDefsEditor from "./EntityDefsEditor";

export interface SettingsDialogHooks {
  /** Called after edits that make existing undo steps unsafe (removing data). */
  onDestructiveChange: () => void;
  confirm: (message: string) => boolean;
  /** Reports problems such as an unreadable image. */
  notify: (message: string) => void;
}

const el = <K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: (Node | string)[]
): HTMLElementTagNameMap[K] => {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

const field = (label: string, control: HTMLElement): HTMLLabelElement =>
  el(
    "label",
    { className: "field" },
    el("span", { className: "label", textContent: label }),
    control
  );

/** Reads an image file into a PNG/whatever data URL plus its pixel size. */
export async function readImageFile(
  file: File
): Promise<{ dataUrl: string; width: number; height: number }> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      typeof reader.result === "string"
        ? resolve(reader.result)
        : reject(new Error("Unexpected file reader result"));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read file"));
    reader.readAsDataURL(file);
  });
  const image = new Image();
  image.src = dataUrl;
  await image.decode();
  return { dataUrl, width: image.naturalWidth, height: image.naturalHeight };
}

/**
 * Project settings: grid size, layer definitions (IntGrid and Tiles) and
 * tilesets. Edits apply immediately to the live project; they are not undo
 * steps (like LDtk), and data-removing edits ask for confirmation.
 */
export default class SettingsDialog {
  private project: LevelProject | null = null;
  private selectedLayerUid: number | null = null;
  private selectedTilesetUid: number | null = null;
  private readonly gridSizeInput: HTMLInputElement;
  private readonly defsList: HTMLElement;
  private readonly defEditor: HTMLElement;
  private readonly tilesetsList: HTMLElement;
  private readonly tilesetEditor: HTMLElement;
  private readonly fileInput: HTMLInputElement;
  private readonly entityDefs: EntityDefsEditor;

  constructor(
    private readonly dialog: HTMLDialogElement,
    private readonly hooks: SettingsDialogHooks
  ) {
    const $ = <T extends Element>(sel: string) => dialog.querySelector<T>(sel)!;
    this.gridSizeInput = $("#gridSizeInput");
    this.defsList = $("#defsList");
    this.defEditor = $("#defEditor");
    this.tilesetsList = $("#tilesetsList");
    this.tilesetEditor = $("#tilesetEditor");
    this.fileInput = $("#tilesetFileInput");
    this.entityDefs = new EntityDefsEditor(
      {
        entitiesList: $("#entityDefsList"),
        entityEditor: $("#entityDefEditor"),
        enumsList: $("#enumsList"),
        enumEditor: $("#enumEditor"),
        addEntity: $("#addEntityDef"),
        addEnum: $("#addEnumDef"),
      },
      hooks
    );

    this.gridSizeInput.addEventListener("change", () => {
      const size = Number(this.gridSizeInput.value);
      if (this.project && Number.isInteger(size) && size >= 1 && size <= 256) {
        this.project.setGridSize(size);
      } else if (this.project) {
        this.gridSizeInput.value = String(this.project.gridSize);
      }
    });

    $("#addLayerDef").addEventListener("click", () => {
      if (!this.project) return;
      this.selectedLayerUid = this.project.addIntGridLayer("intgrid").uid;
      this.render();
    });
    $("#addTilesLayerDef").addEventListener("click", () => {
      if (!this.project) return;
      const tileset = this.project.defs.tilesets[0];
      this.selectedLayerUid = this.project.addTilesLayer("tiles", tileset?.uid ?? null).uid;
      this.render();
    });
    $("#addEntitiesLayerDef").addEventListener("click", () => {
      if (!this.project) return;
      this.selectedLayerUid = this.project.addEntitiesLayer("entities").uid;
      this.render();
    });
    $("#importTileset").addEventListener("click", () => this.fileInput.click());
    this.fileInput.addEventListener("change", () => {
      const file = this.fileInput.files?.[0];
      this.fileInput.value = "";
      if (file) void this.importTileset(file);
    });

    this.defsList.addEventListener("click", (ev) => {
      const item = (ev.target as Element).closest<HTMLElement>("[data-uid]");
      if (!item) return;
      this.selectedLayerUid = Number(item.dataset.uid);
      this.render();
    });
    this.tilesetsList.addEventListener("click", (ev) => {
      const item = (ev.target as Element).closest<HTMLElement>("[data-uid]");
      if (!item) return;
      this.selectedTilesetUid = Number(item.dataset.uid);
      this.render();
    });
  }

  open(project: LevelProject, layerDefUid: number | null = null): void {
    this.project = project;
    this.selectedLayerUid = layerDefUid ?? project.defs.layers.at(-1)?.uid ?? null;
    this.selectedTilesetUid = project.defs.tilesets[0]?.uid ?? null;
    this.render();
    this.entityDefs.open(project);
    if (!this.dialog.open) this.dialog.showModal();
  }

  close(): void {
    if (this.dialog.open) this.dialog.close();
  }

  private async importTileset(file: File): Promise<void> {
    const project = this.project;
    if (!project) return;
    try {
      const isSprite = /\.json$/i.test(file.name);
      let image: { dataUrl: string; width: number; height: number };
      let tileSize = project.gridSize;
      if (isSprite) {
        // A pixel-editor sprite: frames side by side. Square frames become
        // one tile each; otherwise slice by the project grid.
        const json: unknown = JSON.parse(await file.text());
        if (!isPixelSpriteFile(json)) throw new Error("Not a Foundry2D sprite file.");
        const sheet = spriteToSheet(json);
        image = { dataUrl: sheetToDataUrl(sheet), width: sheet.width, height: sheet.height };
        if (sheet.frameWidth === sheet.frameHeight) tileSize = sheet.frameWidth;
      } else {
        image = await readImageFile(file);
      }
      const tileset = project.addTileset({
        identifier: file.name.replace(/(\.f2d)?\.[^.]+$/, "").replace(/\W+/g, "_") || "tileset",
        tileSize,
        spacing: 0,
        padding: 0,
        image: { ...image, fileName: file.name },
      });
      this.selectedTilesetUid = tileset.uid;
      // Bind the first Tiles layer that has no tileset yet.
      const unbound = project.defs.layers.find((d) => d.type === "Tiles" && !d.tilesetUid);
      if (unbound) project.setLayerTileset(unbound.uid, tileset.uid);
      this.render();
    } catch (error) {
      console.error(error);
      this.hooks.notify(`Could not load "${file.name}" as a tileset: ${(error as Error).message}`);
    }
  }

  private render(): void {
    const project = this.project;
    if (!project) return;
    this.gridSizeInput.value = String(project.gridSize);

    if (!project.getLayerDef(this.selectedLayerUid ?? -1)) {
      this.selectedLayerUid = project.defs.layers.at(-1)?.uid ?? null;
    }
    if (!project.getTileset(this.selectedTilesetUid)) {
      this.selectedTilesetUid = project.defs.tilesets[0]?.uid ?? null;
    }

    // Layers, top of the stack first like the layers panel.
    this.defsList.replaceChildren(
      ...[...project.defs.layers].reverse().map((def) => {
        const meta =
          def.type === "IntGrid"
            ? `IntGrid · ${def.intGridValues.length}`
            : def.type === "Entities"
              ? "Entities"
              : `Tiles · ${project.getTileset(def.tilesetUid)?.identifier ?? "no tileset"}`;
        const li = el("li", { textContent: def.identifier }, el("small", { textContent: meta }));
        li.dataset.uid = String(def.uid);
        li.setAttribute("role", "option");
        li.setAttribute("aria-selected", String(def.uid === this.selectedLayerUid));
        return li;
      })
    );
    const def = project.getLayerDef(this.selectedLayerUid ?? -1);
    this.defEditor.replaceChildren(...(def ? this.renderLayerEditor(project, def) : []));

    this.tilesetsList.replaceChildren(
      ...project.defs.tilesets.map((tileset) => {
        const { columns, rows } = tilesetGrid(tileset);
        const li = el(
          "li",
          { textContent: tileset.identifier },
          el("small", { textContent: `${tileset.tileSize}px · ${columns}×${rows}` })
        );
        li.dataset.uid = String(tileset.uid);
        li.setAttribute("role", "option");
        li.setAttribute("aria-selected", String(tileset.uid === this.selectedTilesetUid));
        return li;
      })
    );
    if (project.defs.tilesets.length === 0) {
      this.tilesetsList.append(
        el("li", { className: "empty", textContent: "No tilesets yet. Import a PNG sheet." })
      );
    }
    const tileset = project.getTileset(this.selectedTilesetUid);
    this.tilesetEditor.replaceChildren(
      ...(tileset ? this.renderTilesetEditor(project, tileset) : [])
    );
    // Tilesets feed the entity tile picker, so keep that section in step.
    this.entityDefs.render();
  }

  private renderLayerEditor(project: LevelProject, def: LayerDef): HTMLElement[] {
    const nameInput = el("input", { className: "input", value: def.identifier, spellcheck: false });
    nameInput.addEventListener("change", () => {
      project.renameLayerDef(def.uid, nameInput.value);
      this.render();
    });

    const footer = el("div", { className: "def-editor-footer" });
    const deleteLayer = el("button", {
      className: "btn btn-small btn-danger",
      textContent: "Delete layer",
      disabled: project.defs.layers.length <= 1,
    });
    deleteLayer.addEventListener("click", () => {
      const message = `Delete layer "${def.identifier}" and its data in every level? This can't be undone.`;
      if (!this.hooks.confirm(message)) return;
      project.removeLayerDef(def.uid);
      this.hooks.onDestructiveChange();
      this.render();
    });

    const parts: HTMLElement[] = [field("Identifier (used as the export key)", nameInput)];

    if (def.type === "Entities") {
      const placed = project.levels.reduce(
        (n, level) => n + level.entities.filter((e) => e.layerUid === def.uid).length,
        0
      );
      parts.push(
        el("p", {
          className: "hint",
          textContent: `Holds entity instances (${placed} placed). Entity types are defined under Entities below.`,
        })
      );
      footer.append(el("span"), deleteLayer);
      parts.push(footer);
      return parts;
    }

    if (def.type === "Tiles") {
      const select = el("select", { className: "input" });
      select.append(new Option("— none —", ""));
      for (const tileset of project.defs.tilesets) {
        select.append(
          new Option(tileset.identifier, String(tileset.uid), false, tileset.uid === def.tilesetUid)
        );
      }
      select.addEventListener("change", () => {
        project.setLayerTileset(def.uid, select.value ? Number(select.value) : null);
        this.render();
      });
      parts.push(field("Tileset", select));
      footer.append(el("span"), deleteLayer);
      parts.push(footer);
      return parts;
    }

    const table = el("div", { className: "values-table" });
    for (const entry of def.intGridValues) {
      const id = el("input", { className: "input", value: entry.identifier, spellcheck: false });
      id.setAttribute("aria-label", `Name of value ${entry.value}`);
      id.addEventListener("change", () => {
        const identifier = id.value.trim();
        if (identifier) project.updateIntGridValue(def.uid, entry.value, { identifier });
        else id.value = entry.identifier;
      });

      const color = el("input", {
        type: "color",
        value: entry.color.length === 7 ? entry.color : "#ff00ff",
      });
      color.setAttribute("aria-label", `Color of value ${entry.value}`);
      color.addEventListener("input", () =>
        project.updateIntGridValue(def.uid, entry.value, { color: color.value })
      );

      const remove = el("button", {
        className: "btn btn-icon btn-danger",
        textContent: "✕",
        title: `Remove value ${entry.value}`,
      });
      remove.setAttribute("aria-label", remove.title);
      remove.addEventListener("click", () => {
        const message = `Remove "${entry.identifier}"? Cells using it are cleared in every level. This can't be undone.`;
        if (!this.hooks.confirm(message)) return;
        project.removeIntGridValue(def.uid, entry.value);
        this.hooks.onDestructiveChange();
        this.render();
      });

      table.append(
        el(
          "div",
          { className: "value-row" },
          el("span", { className: "value-number", textContent: String(entry.value) }),
          id,
          color,
          remove
        )
      );
    }

    const addValue = el("button", { className: "btn btn-small", textContent: "+ Value" });
    addValue.addEventListener("click", () => {
      project.addIntGridValue(def.uid);
      this.render();
    });
    footer.append(addValue, deleteLayer);
    parts.push(
      el("span", { className: "label", textContent: "Values (0 is always empty)" }),
      table,
      footer
    );
    return parts;
  }

  private renderTilesetEditor(project: LevelProject, tileset: TilesetDef): HTMLElement[] {
    const nameInput = el("input", {
      className: "input",
      value: tileset.identifier,
      spellcheck: false,
    });
    nameInput.addEventListener("change", () => {
      const identifier = nameInput.value.trim();
      if (identifier) project.updateTileset(tileset.uid, { identifier });
      this.render();
    });

    const numberInput = (key: "tileSize" | "spacing" | "padding", min: number) => {
      const input = el("input", {
        className: "input",
        type: "number",
        min: String(min),
        step: "1",
        value: String(tileset[key]),
      });
      input.addEventListener("change", () => {
        const value = Number(input.value);
        if (Number.isInteger(value) && value >= min)
          project.updateTileset(tileset.uid, { [key]: value });
        this.render();
      });
      return input;
    };

    const { columns, rows } = tilesetGrid(tileset);
    const preview = el("img", {
      className: "tileset-preview",
      src: tileset.image.dataUrl,
      alt: "",
    });
    const info = el("p", {
      className: "hint",
      textContent: `${tileset.image.fileName ?? "embedded image"} · ${tileset.image.width}×${tileset.image.height}px · ${columns}×${rows} tiles`,
    });

    const used = project.defs.layers.filter((d) => d.tilesetUid === tileset.uid);
    const remove = el("button", {
      className: "btn btn-small btn-danger",
      textContent: "Delete tileset",
    });
    remove.addEventListener("click", () => {
      const message = used.length
        ? `Delete "${tileset.identifier}"? ${used.length} layer(s) use it and will show placeholders until another tileset is assigned.`
        : `Delete "${tileset.identifier}"?`;
      if (!this.hooks.confirm(message)) return;
      project.removeTileset(tileset.uid);
      this.render();
    });

    return [
      field("Identifier", nameInput),
      el(
        "div",
        { className: "tileset-fields" },
        field("Tile size", numberInput("tileSize", 1)),
        field("Spacing", numberInput("spacing", 0)),
        field("Padding", numberInput("padding", 0))
      ),
      preview,
      info,
      el("div", { className: "def-editor-footer" }, el("span"), remove),
    ];
  }
}
