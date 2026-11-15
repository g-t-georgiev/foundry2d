import { el, fieldRow as field } from "@foundry2d/ui";
import type { LevelProject } from "../model/LevelProject";
import { tilesetGrid } from "../model/tiles";
import type { LayerDef, TilesetDef } from "../model/types";
import { isPixelSpriteFile, sheetToDataUrl, spriteToSheet } from "../io/spriteImport";
import EntityDefsEditor from "./EntityDefsEditor";
import { fieldDefsTable } from "./fieldDefsTable";
import { FIELD_TYPES, type FieldType } from "../model/types";

export interface SettingsDialogHooks {
  confirm: (message: string) => boolean;
  /** Reports problems such as an unreadable image. */
  notify: (message: string) => void;
  /** Opens the rules editor of an auto-layer. */
  editRules: (layerDefUid: number) => void;
}

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
export type SettingsTab = "layers" | "tilesets" | "entities" | "enums" | "levels";

export default class SettingsDialog {
  private project: LevelProject | null = null;
  private tab: SettingsTab = "layers";
  private selectedLayerUid: number | null = null;
  private selectedTilesetUid: number | null = null;
  private readonly gridSizeInput: HTMLInputElement;
  private readonly defsList: HTMLElement;
  private readonly defEditor: HTMLElement;
  private readonly tilesetsList: HTMLElement;
  private readonly tilesetEditor: HTMLElement;
  private readonly fileInput: HTMLInputElement;
  /** Set while the file picker is open for "Re-import" of this tileset. */
  private reimportUid: number | null = null;
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

    const typeSelect = $<HTMLSelectElement>("#levelFieldType");
    for (const t of FIELD_TYPES) typeSelect.append(new Option(t, t));
    $("#addLevelField").addEventListener("click", () => {
      this.project?.addLevelField(typeSelect.value as FieldType);
      this.render();
    });
    const defaultBg = $<HTMLInputElement>("#defaultLevelBg");
    defaultBg.addEventListener("change", () => this.project?.setDefaultLevelBg(defaultBg.value));

    for (const button of dialog.querySelectorAll<HTMLButtonElement>("[data-tab]")) {
      button.addEventListener("click", () => this.showTab(button.dataset.tab as SettingsTab));
    }
    dialog.querySelector(".dialog-tabs")!.addEventListener("keydown", (ev) => {
      const key = (ev as KeyboardEvent).key;
      if (key !== "ArrowLeft" && key !== "ArrowRight") return;
      const tabs = [...dialog.querySelectorAll<HTMLButtonElement>("[data-tab]")];
      const index = tabs.findIndex((t) => t.dataset.tab === this.tab);
      const next = tabs[(index + (key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
      this.showTab(next.dataset.tab as SettingsTab);
      next.focus();
    });

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
    const packaged = $<HTMLInputElement>("#packagedToggle");
    packaged.addEventListener("change", () => this.project?.setPackaged(packaged.checked));
    $("#importTileset").addEventListener("click", () => {
      this.reimportUid = null;
      this.fileInput.click();
    });
    this.fileInput.addEventListener("change", () => {
      const file = this.fileInput.files?.[0];
      this.fileInput.value = "";
      const uid = this.reimportUid;
      this.reimportUid = null;
      if (!file) return;
      void (uid === null ? this.importTileset(file) : this.reimportTileset(uid, file));
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

  /** Switches the visible section (keeps edits; they apply immediately anyway). */
  showTab(tab: SettingsTab): void {
    this.tab = tab;
    for (const button of this.dialog.querySelectorAll<HTMLButtonElement>("[data-tab]")) {
      const selected = button.dataset.tab === tab;
      button.setAttribute("aria-selected", String(selected));
      button.tabIndex = selected ? 0 : -1;
    }
    for (const panel of this.dialog.querySelectorAll<HTMLElement>("[data-panel]")) {
      panel.hidden = panel.dataset.panel !== tab;
    }
  }

  open(
    project: LevelProject,
    layerDefUid: number | null = null,
    tab: SettingsTab = "layers"
  ): void {
    this.project = project;
    this.showTab(tab);
    this.selectedLayerUid = layerDefUid ?? project.defs.layers.at(-1)?.uid ?? null;
    this.selectedTilesetUid = project.defs.tilesets[0]?.uid ?? null;
    this.render();
    this.entityDefs.open(project);
    if (!this.dialog.open) this.dialog.showModal();
  }

  /** Redraws when open (after undo or redo changed the definitions). */
  refresh(): void {
    if (this.dialog.open) this.render();
  }

  close(): void {
    if (this.dialog.open) this.dialog.close();
  }

  /**
   * Reads a PNG/WebP/GIF sheet, or a pixel-editor sprite (frames side by
   * side; square frames suggest the tile size).
   */
  private async readTilesetSource(
    file: File,
    gridSize: number
  ): Promise<{ image: { dataUrl: string; width: number; height: number }; tileSize: number }> {
    if (/\.(f2dsprite|json)$/i.test(file.name)) {
      const json: unknown = JSON.parse(await file.text());
      if (!isPixelSpriteFile(json)) throw new Error("Not a Foundry2D sprite file.");
      const sheet = spriteToSheet(json);
      return {
        image: { dataUrl: sheetToDataUrl(sheet), width: sheet.width, height: sheet.height },
        tileSize: sheet.frameWidth === sheet.frameHeight ? sheet.frameWidth : gridSize,
      };
    }
    return { image: await readImageFile(file), tileSize: gridSize };
  }

  /**
   * Replaces a tileset's image with an updated file, keeping its identity,
   * tile size and every placed tile (tile ids refer to positions in the
   * sheet, so updated art shows up everywhere at once).
   */
  private async reimportTileset(uid: number, file: File): Promise<void> {
    const project = this.project;
    const tileset = project?.getTileset(uid);
    if (!project || !tileset) return;
    try {
      const { image } = await this.readTilesetSource(file, project.gridSize);
      const resized = image.width !== tileset.image.width || image.height !== tileset.image.height;
      project.updateTileset(uid, { image: { ...image, fileName: file.name } });
      this.hooks.notify(
        resized
          ? `Re-imported "${tileset.identifier}" from ${file.name} (size changed: check the tile layout)`
          : `Re-imported "${tileset.identifier}" from ${file.name}`
      );
      this.render();
    } catch (error) {
      console.error(error);
      this.hooks.notify(`Could not re-import "${file.name}": ${(error as Error).message}`);
    }
  }

  private async importTileset(file: File): Promise<void> {
    const project = this.project;
    if (!project) return;
    try {
      const { image, tileSize } = await this.readTilesetSource(file, project.gridSize);
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

  /** Levels tab: default background and the level field definitions. */
  private renderLevelsTab(project: LevelProject): void {
    const $ = <T extends Element>(sel: string) => this.dialog.querySelector<T>(sel)!;
    $<HTMLInputElement>("#defaultLevelBg").value = project.defaultLevelBg;
    $("#levelFieldsTable").replaceChildren(
      fieldDefsTable(
        project,
        {
          fields: project.defs.levelFields,
          update: (uid, patch) => project.updateLevelField(uid, patch),
          remove: (uid) => project.removeLevelField(uid),
          emptyHint: "No level fields yet. Examples: music, time limit, a spawn point.",
        },
        { confirm: (m) => this.hooks.confirm(m), rerender: () => this.render() }
      )
    );
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
        const auto = project.autoSourceOf(def);
        const meta = auto
          ? `Auto · from ${auto.identifier} · ${def.autoRules?.length ?? 0} rules`
          : def.type === "IntGrid"
            ? `IntGrid · ${def.intGridValues.length}`
            : def.type === "Entities"
              ? "Entities"
              : `Tiles · ${project.getTileset(def.tilesetUid)?.identifier ?? "no tileset"}`;
        const grid = def.gridSize === undefined ? "" : ` · ${def.gridSize}px grid`;
        const li = el(
          "li",
          { textContent: def.identifier },
          el("small", { textContent: meta + grid })
        );
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
    this.dialog.querySelector<HTMLInputElement>("#packagedToggle")!.checked = project.packaged;
    // Tilesets feed the entity tile picker, so keep that section in step.
    this.entityDefs.render();
    this.renderLevelsTab(project);
  }

  /** The layer's own grid size (LDtk's per-layer grid); empty uses the project grid. */
  private layerGridField(project: LevelProject, def: LayerDef): HTMLElement {
    const source = project.autoSourceOf(def);
    const input = el("input", {
      className: "input input-small",
      type: "number",
      min: "1",
      step: "1",
      placeholder: String(project.gridSize),
      value: def.gridSize === undefined ? "" : String(def.gridSize),
      disabled: source !== undefined,
    });
    input.setAttribute("aria-label", "Layer grid size in pixels");
    input.addEventListener("change", () => {
      const text = input.value.trim();
      const size = Number(text);
      if (text !== "" && !(Number.isInteger(size) && size > 0)) {
        input.value = def.gridSize === undefined ? "" : String(def.gridSize);
        return;
      }
      project.setLayerGridSize(def.uid, text === "" ? null : size);
      this.render();
    });
    const hint = source
      ? `Follows its source layer "${source.identifier}".`
      : def.type === "Entities"
        ? "Entities snap to this grid. Empty: the project grid."
        : "Empty: the project grid. Changing it resamples painted cells; Ctrl+Z undoes it.";
    return field(
      "Grid size (px)",
      el(
        "span",
        { className: "button-row" },
        input,
        el("span", { className: "hint", textContent: hint })
      )
    );
  }

  /** Helper lines over the layer (LDtk's guide grid); display only. */
  private guideGridField(project: LevelProject, def: LayerDef): HTMLElement {
    const input = (axis: "width" | "height") => {
      const el2 = el("input", {
        className: "input input-small",
        type: "number",
        min: "1",
        step: "1",
        placeholder: "none",
        value: def.guideGrid ? String(def.guideGrid[axis]) : "",
      });
      el2.setAttribute("aria-label", `Guide grid ${axis} in pixels`);
      return el2;
    };
    const w = input("width");
    const h = input("height");
    const apply = () => {
      const width = Number(w.value.trim() || h.value.trim());
      const height = Number(h.value.trim() || w.value.trim());
      const valid = Number.isInteger(width) && width > 0 && Number.isInteger(height) && height > 0;
      project.setLayerGuideGrid(def.uid, valid ? { width, height } : null);
      this.render();
    };
    w.addEventListener("change", apply);
    h.addEventListener("change", apply);
    return field(
      "Guide grid (px)",
      el(
        "span",
        { className: "button-row" },
        w,
        el("span", { textContent: "×" }),
        h,
        el("span", {
          className: "hint",
          textContent: "Helper lines while this layer is active, e.g. a room size. Display only.",
        })
      )
    );
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
      const message = `Delete layer "${def.identifier}" and its data in every level? Ctrl+Z undoes it.`;
      if (!this.hooks.confirm(message)) return;
      project.removeLayerDef(def.uid);
      this.render();
    });

    const parts: HTMLElement[] = [
      field("Identifier (used as the export key)", nameInput),
      this.layerGridField(project, def),
      this.guideGridField(project, def),
    ];

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

      // Auto-tiling: generate this layer from an IntGrid layer.
      const sources = project.defs.layers.filter((d) => d.type === "IntGrid");
      const auto = el("select", { className: "input" });
      auto.append(new Option("— none: paint tiles by hand —", ""));
      for (const source of sources) {
        auto.append(
          new Option(source.identifier, String(source.uid), false, source.uid === def.autoSourceUid)
        );
      }
      auto.addEventListener("change", () => {
        const sourceUid = auto.value ? Number(auto.value) : null;
        const painted = project.levels.some((level) =>
          level.doc.getLayer(`def_${def.uid}`)?.data.some((v) => v !== 0)
        );
        if (
          sourceUid !== null &&
          !project.isAutoLayer(def) &&
          painted &&
          !this.hooks.confirm(
            `Generate "${def.identifier}" from rules? Its painted tiles are replaced in every level. Ctrl+Z undoes it.`
          )
        ) {
          this.render();
          return;
        }
        project.setAutoSource(def.uid, sourceUid);
        this.render();
      });
      parts.push(field("Auto-tiling: generate from IntGrid layer", auto));
      if (project.isAutoLayer(def)) {
        const count = def.autoRules?.length ?? 0;
        const edit = el("button", {
          className: "btn btn-small btn-primary",
          textContent: `Edit rules (${count})…`,
        });
        edit.addEventListener("click", () => this.hooks.editRules(def.uid));
        parts.push(
          el(
            "div",
            { className: "button-row" },
            edit,
            el("span", {
              className: "hint",
              textContent: "Tiles follow the source layer; paint there instead.",
            })
          )
        );
      }
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
        const message = `Remove "${entry.identifier}"? Cells using it are cleared in every level. Ctrl+Z undoes it.`;
        if (!this.hooks.confirm(message)) return;
        project.removeIntGridValue(def.uid, entry.value);
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

    const reimport = el("button", {
      className: "btn btn-small",
      textContent: "Re-import…",
      title: "Replace the image with an updated PNG or .f2dsprite; placed tiles stay",
    });
    reimport.addEventListener("click", () => {
      this.reimportUid = tileset.uid;
      this.fileInput.click();
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
      el("div", { className: "def-editor-footer" }, reimport, remove),
    ];
  }
}
