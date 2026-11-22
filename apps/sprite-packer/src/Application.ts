import { buildAtlas, type Atlas } from "@foundry2d/atlas";
import type { Storage } from "@foundry2d/core";
import {
  bindProjectBrowser,
  SplitButtonEvents,
  type ProjectBrowser,
  type SplitButton,
} from "@foundry2d/ui";
import { ProjectFiles, ProjectSession, Workspace } from "@foundry2d/workspace";
import { exportSheets, sheetFiles, toCanvas } from "./export";
import {
  filesFromDrop,
  filesFromInput,
  IMAGE_ACCEPT,
  ImageStore,
  isImagePath,
  type ImportFile,
} from "./io/images";
import {
  fromPackFile,
  PACK_EXTENSION,
  PACK_MIME,
  PackFormatError,
  toPackFile,
} from "./io/packFile";
import { DEFAULT_NAME, PackProject, type SpriteImage } from "./model/PackProject";
import { atlasOptions, DEFAULT_SETTINGS, type PackSettings } from "./model/settings";
import { SheetScene } from "./SheetScene";
import { SettingsPanel } from "./ui/SettingsPanel";
import { SpriteList } from "./ui/SpriteList";

const $ = <T extends Element = HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;

interface PackWork {
  name: string;
  settings: PackSettings;
  images: SpriteImage[];
}

/** Start-screen templates: an empty pack set up for an engine. */
const TEMPLATES: {
  id: string;
  label: string;
  description: string;
  settings: Partial<PackSettings>;
}[] = [
  {
    id: "empty",
    label: "Empty pack",
    description: "TexturePacker JSON (Phaser, PixiJS), tight MaxRects packing.",
    settings: {},
  },
  {
    id: "godot",
    label: "Godot 4",
    description: "SpriteFrames resource next to the sheet.",
    settings: { dataFormat: "godot-tres" },
  },
  {
    id: "libgdx",
    label: "LibGDX",
    description: "TextureAtlas file, power-of-two sheets.",
    settings: { dataFormat: "libgdx-atlas", powerOfTwo: true },
  },
  {
    id: "css",
    label: "Web (CSS sprites)",
    description: "One class per sprite.",
    settings: { dataFormat: "css" },
  },
];

/** The frame key of a sprite in the data files. */
const frameName = (name: string) => `${name}.png`;

/** Composition root of the sprite packer. */
export default class Application {
  readonly project = new PackProject();
  readonly workspace: Workspace;
  readonly session: ProjectSession;
  readonly files: ProjectFiles<PackWork>;
  /** The last packing result; `null` with no sprites or when packing failed. */
  atlas: Atlas | null = null;
  /** True from an edit until its packing result is shown. */
  packing = false;

  private readonly images = new ImageStore();
  private readonly scene: SheetScene;
  private readonly list: SpriteList;
  private readonly settings: SettingsPanel;
  private selected = new Set<string>();
  /** Frame names of the selected sprites, for the sheet's outlines. */
  private selectedFrames = new Set<string>();
  private packTimer: ReturnType<typeof setTimeout> | undefined;
  /** Bumped per packing run, so a run overtaken by a newer edit is dropped. */
  private packRun = 0;
  private fitNext = true;
  private loading = false;
  private messageTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(storage: Storage) {
    const { project } = this;
    this.scene = new SheetScene({
      isSelected: (name) => this.selectedFrames.has(name),
      showOutlines: () => $<HTMLInputElement>("#outlinesToggle").checked,
      onPick: (names, additive) => this.pickOnSheet(names, additive),
    });
    this.workspace = new Workspace($("#viewport"), {
      canvas: $<HTMLCanvasElement>("#sheetCanvas"),
      theme: { workspaceBackground: "#0e0e11", checkerLight: "#1c1c22", checkerDark: "#18181c" },
    });
    void this.workspace.setScene(this.scene);
    this.list = new SpriteList($("#spriteList"), $<HTMLInputElement>("#spriteSearch"), {
      select: (ids) => this.select(ids),
      remove: (ids) => this.remove(ids),
      rename: (id, name) => {
        const ok = project.rename(id, name);
        if (!ok) this.notify(`There is already a sprite called "${name.trim()}".`, 4000);
        return ok;
      },
    });
    this.settings = new SettingsPanel($("#settings"), (patch) => {
      project.setSettings(patch);
      // A refused value (out of range, emptied) shows the stored one again.
      this.settings.render(project.settings);
    });

    this.session = new ProjectSession({
      app: "pack",
      storage,
      titleSuffix: "Foundry2D Sprite Packer",
      fileType: {
        description: "Foundry2D sprite pack",
        mimeType: PACK_MIME,
        extensions: [PACK_EXTENSION],
      },
      serialize: () => toPackFile(project),
      getName: () => project.name,
      thumbnail: () => this.thumbnail(),
      onChange: (state) => {
        const where = state.fileName ?? (state.libraryId ? "browser library" : "not saved yet");
        $("#statFile").textContent = `${state.dirty ? "● " : ""}${where}`;
      },
    });
    this.session.installUnloadGuard();
    const browser = $<ProjectBrowser>("#projectBrowser");
    this.files = new ProjectFiles<PackWork>({
      session: this.session,
      startScreen: browser,
      noun: { one: "pack", title: "Sprite packs" },
      parse: (opened) => {
        const work = fromPackFile(opened.json);
        return { ...work, name: work.name || opened.name };
      },
      load: (work) => this.load(work),
      templates: () => TEMPLATES.map(({ id, label, description }) => ({ id, label, description })),
      createFromTemplate: (id) => {
        const template = TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0];
        return {
          project: {
            name: DEFAULT_NAME,
            settings: { ...DEFAULT_SETTINGS, ...template.settings },
            images: [],
          },
          message: `New pack (${template.label})`,
        };
      },
      isUserFacingError: (error) => error instanceof PackFormatError,
      notify: (message, timeout) => this.notify(message, timeout),
      setName: (name) => project.setName(name),
    });
    bindProjectBrowser(browser, this.files);

    project.events.on("changed", () => this.onChanged());
    project.events.on("renamed", () => {
      $<HTMLInputElement>("#projectName").value = project.name;
      if (!this.loading) this.session.markDirty();
      this.session.refresh();
    });
    project.history.onChange(({ canUndo, canRedo }) => {
      $<HTMLButtonElement>('[data-command="undo"]').disabled = !canUndo;
      $<HTMLButtonElement>('[data-command="redo"]').disabled = !canRedo;
    });
    this.bindDom();
    this.bindKeys();
    this.bindDrop();
    this.load({ name: DEFAULT_NAME, settings: { ...DEFAULT_SETTINGS }, images: [] });
    this.session.refresh();
    void this.files.startup().then(() => this.files.bindLaunchQueue());
  }

  get history() {
    return this.project.history;
  }

  // ------------------------------------------------------------------ sprites

  /** Imports files (other file types are ignored) as one undo step. */
  async importFiles(files: readonly ImportFile[]): Promise<void> {
    const usable = files.filter((f) => isImagePath(f.path));
    if (usable.length === 0) {
      if (files.length) this.notify("No images there (PNG, WebP, JPEG, GIF or BMP).", 4000);
      return;
    }
    const { images, failed } = await this.images.read(usable);
    const wasEmpty = this.project.sprites.length === 0;
    if (wasEmpty) this.fitNext = true;
    const { added, updated } = this.project.addImages(images);
    const parts = [
      added ? `Added ${added} sprite${added === 1 ? "" : "s"}` : "",
      updated ? `updated ${updated}` : "",
      failed.length ? `could not read ${failed.join(", ")}` : "",
    ].filter(Boolean);
    this.notify(parts.join(", ") || "Nothing new: these sprites are already here.", 4000);
  }

  private remove(ids: string[]): void {
    const count = this.project.remove(ids);
    if (count) this.notify(`Removed ${count} sprite${count === 1 ? "" : "s"} (Ctrl+Z to undo)`);
  }

  private select(ids: string[]): void {
    this.selected = new Set(ids);
    this.renderList();
    this.workspace.requestRender();
  }

  private pickOnSheet(names: string[], additive: boolean): void {
    const ids = this.project.sprites.filter((s) => names.includes(frameName(s.name)));
    const next = new Set(additive ? this.selected : []);
    const remove = additive && ids.length > 0 && ids.every((s) => next.has(s.id));
    for (const { id } of ids) {
      if (remove) next.delete(id);
      else next.add(id);
    }
    this.select([...next]);
    if (ids[0] && !remove) this.list.reveal(ids[0].id);
  }

  private renderList(): void {
    const { sprites } = this.project;
    this.selectedFrames = new Set(
      sprites.filter((s) => this.selected.has(s.id)).map((s) => frameName(s.name))
    );
    this.list.render(sprites, this.selected);
    $("#spriteCount").textContent = String(sprites.length);
    $("#emptyHint").hidden = sprites.length > 0;
    $<HTMLButtonElement>("#removeSprites").disabled = this.selected.size === 0;
  }

  // ------------------------------------------------------------------ packing

  private onChanged(): void {
    const { project } = this;
    const ids = new Set(project.sprites.map((s) => s.id));
    this.selected = new Set([...this.selected].filter((id) => ids.has(id)));
    this.renderList();
    this.settings.render(project.settings);
    if (!this.loading) this.session.markDirty();
    this.schedulePack();
  }

  /** Packs soon; edits in quick succession pack once. */
  private schedulePack(): void {
    this.packing = true;
    this.packRun++;
    clearTimeout(this.packTimer);
    this.packTimer = setTimeout(() => void this.pack(), 60);
  }

  private async pack(): Promise<void> {
    const run = this.packRun;
    const { sprites, settings } = this.project;
    let atlas: Atlas | null = null;
    let problem: string | null = null;
    try {
      const inputs = [];
      for (const s of sprites) {
        let image;
        try {
          image = await this.images.get(s.dataUrl);
        } catch {
          throw new Error(`The image of "${s.name}" can't be read.`);
        }
        inputs.push({ name: frameName(s.name), image });
      }
      if (run !== this.packRun) return; // overtaken by a newer edit
      if (inputs.length) atlas = buildAtlas(inputs, atlasOptions(settings));
    } catch (error) {
      if (run !== this.packRun) return;
      problem = (error as Error).message;
    }
    this.images.keepOnly(sprites.map((s) => s.dataUrl));
    this.atlas = atlas;
    this.packing = false;
    this.scene.setAtlas(atlas);
    this.renderStats(problem);
    if (atlas && this.fitNext) {
      this.fitNext = false;
      void this.workspace.fitToView();
    }
    this.workspace.requestRender();
  }

  private renderStats(problem: string | null): void {
    const { atlas } = this;
    const error = $("#packError");
    error.textContent = problem ?? "";
    error.hidden = problem === null;
    $<SplitButton>("#exportButton").toggleAttribute("disabled", atlas === null);
    $("#statSheets").textContent = atlas
      ? atlas.sheets.map((s) => `${s.image.width}×${s.image.height}`).join(", ")
      : "—";
    $("#statFill").textContent = atlas ? `${Math.round(atlas.fillRate * 100)}%` : "—";
    $("#statShared").textContent = atlas ? String(atlas.aliased) : "—";
  }

  // ------------------------------------------------------------------ files

  private load(work: PackWork): void {
    this.loading = true;
    this.selected.clear();
    this.fitNext = true;
    this.project.load(work.name, work.images, work.settings);
    this.loading = false;
  }

  /** Runs the export with the sheets as shown. */
  async export(output: string): Promise<void> {
    if (!this.atlas || this.packing) {
      this.notify(this.packing ? "Still packing…" : "Nothing to export yet.");
      return;
    }
    try {
      const { name, settings } = this.project;
      const files = sheetFiles(name, this.atlas.sheets, settings.dataFormat);
      const summary = await exportSheets(name, files, output === "files" ? "files" : "zip");
      this.notify(`Exported ${summary}`, 4000);
    } catch (error) {
      this.notify(`Export failed: ${(error as Error).message}`, 6000);
    }
  }

  private thumbnail(): string | undefined {
    const image = this.atlas?.sheets[0]?.image;
    if (!image) return undefined;
    const scale = Math.min(1, 160 / Math.max(image.width, image.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.width * scale));
    canvas.height = Math.max(1, Math.round(image.height * scale));
    canvas.getContext("2d")?.drawImage(toCanvas(image), 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  }

  private notify(message: string, timeout = 2500): void {
    const target = $("#statMessage");
    target.textContent = message;
    clearTimeout(this.messageTimer);
    this.messageTimer = setTimeout(() => (target.textContent = ""), timeout);
  }

  // ------------------------------------------------------------------ bindings

  private bindDom(): void {
    const commands: Record<string, () => unknown> = {
      open: () => this.files.showBrowser(),
      save: () => this.files.save(),
      undo: () => this.history.undo(),
      redo: () => this.history.redo(),
      fit: () => this.workspace.fitToView(),
    };
    for (const button of document.querySelectorAll<HTMLElement>("[data-command]")) {
      button.addEventListener("click", () => void commands[button.dataset.command!]?.());
    }
    $<SplitButton>("#saveAsButton").addEventListener(SplitButtonEvents.Action, (ev) => {
      if (ev.detail.value === "browser") void this.files.saveCopyInBrowser(this.project.name);
      else void this.files.saveAs();
    });
    $<SplitButton>("#exportButton").addEventListener(
      SplitButtonEvents.Action,
      (ev) => void this.export(ev.detail.value)
    );
    const name = $<HTMLInputElement>("#projectName");
    name.addEventListener("change", () => {
      this.project.setName(name.value);
      name.value = this.project.name;
    });
    // Enter commits a name or number and gives the keyboard back to the shortcuts.
    for (const field of document.querySelectorAll<HTMLInputElement>(
      '#projectName, #settings input[type="number"]'
    )) {
      field.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") field.blur();
      });
    }
    for (const [button, input] of [
      ["#addImages", "#imageInput"],
      ["#addFolder", "#folderInput"],
    ]) {
      const picker = $<HTMLInputElement>(input);
      if (input === "#imageInput") picker.accept = IMAGE_ACCEPT;
      $(button).addEventListener("click", () => picker.click());
      picker.addEventListener("change", () => {
        const files = filesFromInput(picker.files!);
        picker.value = ""; // the same files can be picked again
        void this.importFiles(files);
      });
    }
    $("#removeSprites").addEventListener("click", () => this.remove([...this.selected]));
    $("#outlinesToggle").addEventListener("change", () => this.workspace.requestRender());
    const zoom = (z: number) => ($("#zoomHud").textContent = `${Math.round(z * 100)}%`);
    this.workspace.events.on("camera:changed", (state) => zoom(state.zoom));
    zoom(this.workspace.zoom);
    this.workspace.events.on("pointer:move", ({ world, inside }) => {
      $("#statSprite").textContent = (inside && this.scene.describe(world)) || "—";
    });
  }

  private bindKeys(): void {
    const { keymap } = this.workspace;
    keymap.bind("mod+z", () => void this.history.undo(), { repeat: true });
    keymap.bind("mod+shift+z", () => void this.history.redo(), { repeat: true });
    keymap.bind("mod+y", () => void this.history.redo(), { repeat: true });
    keymap.bind("mod+s", () => void this.files.save(), { whileTyping: true });
    keymap.bind("mod+shift+s", () => void this.files.saveAs(), { whileTyping: true });
    keymap.bind("mod+o", () => void this.files.showBrowser(), { whileTyping: true });
    keymap.bind("mod+e", () => void this.export($<SplitButton>("#exportButton").value), {
      whileTyping: true,
    });
    keymap.bind("f", () => void this.workspace.fitToView());
    keymap.bind("delete", () => this.remove([...this.selected]));
    keymap.bind("escape", () => this.select([]));
  }

  /** Drop images or folders anywhere on the page. */
  private bindDrop(): void {
    const hasFiles = (ev: DragEvent) => ev.dataTransfer?.types.includes("Files") ?? false;
    window.addEventListener("dragover", (ev) => {
      if (!hasFiles(ev)) return;
      ev.preventDefault();
      document.body.classList.add("dropping");
    });
    window.addEventListener("dragleave", (ev) => {
      if (ev.relatedTarget === null) document.body.classList.remove("dropping");
    });
    window.addEventListener("drop", (ev) => {
      document.body.classList.remove("dropping");
      if (!hasFiles(ev)) return;
      ev.preventDefault();
      void filesFromDrop(ev.dataTransfer!).then((files) => this.importFiles(files));
    });
  }
}
