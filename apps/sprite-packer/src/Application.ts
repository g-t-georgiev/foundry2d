import type { Atlas, RgbaImage } from "@foundry2d/atlas";
import { pruneUnusedAssets, type Storage } from "@foundry2d/core";
import {
  bindProjectBrowser,
  el,
  SplitButtonEvents,
  type ProjectBrowser,
  type SplitButton,
} from "@foundry2d/ui";
import { downloadBlob, ProjectFiles, ProjectSession, Workspace } from "@foundry2d/workspace";
import { toCanvas } from "./canvas";
import { frameName, spriteOfFrame } from "./export";
import { externalizeSprites, internalizeSprites } from "./io/assets";
import {
  filesFromDrop,
  filesFromInput,
  ImageStore,
  IMPORT_ACCEPT,
  isImportPath,
  type ImportFile,
} from "./io/images";
import {
  fromPackFile,
  PACK_EXTENSION,
  PACK_MIME,
  PackFormatError,
  toPackFile,
} from "./io/packFile";
import {
  LiveFolder,
  pickLiveFolder,
  supportsLiveFolders,
  type DirectoryLike,
} from "./io/liveFolder";
import { detectAnimations, frameTags, packOrder, type Animation } from "./model/animations";
import { DEFAULT_NAME, PackProject } from "./model/PackProject";
import { atlasOptions, DEFAULT_SETTINGS, writesPivots, type PackSettings } from "./model/settings";
import { bindKeys } from "./keys";
import { Packer } from "./pack/Packer";
import { SheetScene } from "./SheetScene";
import { AnimationPreview } from "./ui/AnimationPreview";
import { PivotEditor } from "./ui/PivotEditor";
import { SettingsPanel } from "./ui/SettingsPanel";
import { SpriteList } from "./ui/SpriteList";

const $ = <T extends Element = HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;

type PackWork = ReturnType<typeof fromPackFile>;

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

/** A folder kept in sync, and the sprites each of its files gave. */
interface Watched {
  folder: LiveFolder;
  names: Map<string, string[]>;
}

/** How often live folders are checked, in ms. */
const LIVE_INTERVAL = 1500;

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

  readonly packer = new Packer();
  private readonly images = new ImageStore();
  private readonly scene: SheetScene;
  private readonly list: SpriteList;
  private readonly settings: SettingsPanel;
  /** The animations found among the sprites at the last packing. */
  animations: Animation[] = [];

  private readonly preview: AnimationPreview;
  private readonly pivots: PivotEditor;
  private watched: Watched[] = [];
  private scanning = false;
  private selected = new Set<string>();
  /** Frame names of the selected sprites, for the sheet's outlines. */
  private selectedFrames = new Set<string>();
  private packTimer: ReturnType<typeof setTimeout> | undefined;
  /** Bumped per packing run, so a run overtaken by a newer edit is dropped. */
  private packRun = 0;
  /** A packing run is on its way; the next one waits for it. */
  private running = false;
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

    this.preview = new AnimationPreview(
      $<HTMLCanvasElement>("#previewCanvas"),
      $<HTMLSelectElement>("#previewSelect"),
      $<HTMLButtonElement>("#previewToggle")
    );
    this.pivots = new PivotEditor($("#selection"), (pivot) =>
      project.setPivot(this.selected, pivot)
    );

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
      toStored: (json) => externalizeSprites(json, storage.assets),
      fromStored: (json) => internalizeSprites(json, storage.assets),
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
      afterDelete: async () => {
        // Unsaved work may use images too: refresh its snapshot first.
        if (this.session.state.dirty) await this.session.flushRecovery();
        await pruneUnusedAssets(storage);
      },
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
    this.files.bindLaunchQueue();
    void this.files.startup();
  }

  get history() {
    return this.project.history;
  }

  // ------------------------------------------------------------------ sprites

  /** Imports files (other file types are ignored) as one undo step. */
  async importFiles(files: readonly ImportFile[]): Promise<void> {
    const usable = files.filter((f) => isImportPath(f.path));
    if (usable.length === 0) {
      if (files.length) {
        this.notify("No images there (PNG, WebP, JPEG, GIF, BMP or a Foundry2D sprite).", 4000);
      }
      return;
    }
    const { images, failed } = await this.images.read(usable);
    if (this.project.sprites.length === 0) this.fitNext = true;
    const result = this.project.addImages(images);
    this.notify(
      summary(result, failed) || "Nothing new: these sprites are already here.",
      failed.length ? 8000 : 4000
    );
  }

  // ------------------------------------------------------------------ live folders

  /** Keeps a folder's images in the pack until it is stopped or another pack opens. */
  async watch(handle: DirectoryLike): Promise<void> {
    this.watched.push({ folder: new LiveFolder(handle), names: new Map() });
    this.renderWatched();
    await this.scanFolders();
  }

  private stopWatching(entry: Watched): void {
    this.watched = this.watched.filter((w) => w !== entry);
    this.renderWatched();
  }

  /** Applies what changed in the live folders, one undo step per folder. */
  private async scanFolders(): Promise<void> {
    if (this.scanning) return;
    this.scanning = true;
    try {
      for (const entry of this.watched) {
        try {
          await this.scanFolder(entry);
        } catch (error) {
          // Moved, deleted or no longer allowed: its sprites stay as they are.
          this.stopWatching(entry);
          this.notify(`Stopped watching ${entry.folder.name}: ${(error as Error).message}`, 8000);
        }
      }
    } finally {
      this.scanning = false;
    }
  }

  private async scanFolder(entry: Watched): Promise<void> {
    const { changed, removed } = await entry.folder.scan();
    if (changed.length === 0 && removed.length === 0) return;
    const { images, failed, names } = await this.images.read(changed);
    // Stopped (or another pack opened) while reading.
    if (!this.watched.includes(entry)) return;
    const gone = removed.flatMap((path) => entry.names.get(path) ?? []);
    for (const path of removed) entry.names.delete(path);
    for (const [path, now] of names) {
      // A sprite saved with fewer frames gives fewer names than before.
      gone.push(...(entry.names.get(path) ?? []).filter((n) => !now.includes(n)));
      entry.names.set(path, now);
    }
    // A name another file still gives stays (e.g. a.png replaced by a.webp).
    const given = new Set(this.watched.flatMap((w) => [...w.names.values()].flat()));
    const lost = gone.filter((name) => !given.has(name));
    if (this.project.sprites.length === 0) this.fitNext = true;
    const text = summary(this.project.sync(images, lost), failed);
    if (text) this.notify(`${entry.folder.name}: ${text}`, failed.length ? 8000 : 4000);
  }

  private renderWatched(): void {
    const list = $("#liveFolders");
    list.hidden = this.watched.length === 0;
    list.replaceChildren(
      ...this.watched.map((entry) => {
        const stop = el("button", {
          className: "btn btn-icon btn-small",
          textContent: "✕",
          title: `Stop watching ${entry.folder.name} (its sprites stay)`,
        });
        stop.setAttribute("aria-label", stop.title);
        stop.addEventListener("click", () => this.stopWatching(entry));
        return el("li", {}, el("span", { textContent: `● ${entry.folder.name}` }), stop);
      })
    );
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
    this.pivots.render(
      sprites.filter((s) => this.selected.has(s.id)),
      writesPivots(this.project.settings)
    );
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
    if (this.running) return; // the run on its way starts the next one
    this.running = true;
    const run = this.packRun;
    try {
      await this.runPack(run);
    } finally {
      this.running = false;
    }
    if (run !== this.packRun) {
      clearTimeout(this.packTimer);
      void this.pack();
    }
  }

  private async runPack(run: number): Promise<void> {
    const { sprites, settings } = this.project;
    const animations = settings.animations ? detectAnimations(sprites.map((s) => s.name)) : [];
    const byName = new Map(sprites.map((s) => [s.name, s]));
    const pixels = new Map<string, RgbaImage>();
    let atlas: Atlas | null = null;
    let problem: string | null = null;
    try {
      for (const s of sprites) {
        try {
          pixels.set(s.name, await this.images.get(s.dataUrl));
        } catch {
          throw new Error(`The image of "${s.name}" can't be read.`);
        }
      }
      if (run !== this.packRun) return; // overtaken by a newer edit
      const order = packOrder(
        sprites.map((s) => s.name),
        animations
      );
      const inputs = order.map((name) => ({
        name: frameName(name),
        image: pixels.get(name)!,
        duration: 1000 / settings.fps,
        pivot: byName.get(name)!.pivot,
      }));
      if (inputs.length) atlas = await this.packer.pack(inputs, atlasOptions(settings));
      if (run !== this.packRun) return;
    } catch (error) {
      if (run !== this.packRun) return;
      problem = (error as Error).message;
    }
    this.animations = animations;
    this.images.keepOnly(sprites.map((s) => s.dataUrl));
    this.atlas = atlas;
    this.packing = false;
    this.scene.setAtlas(atlas);
    this.renderStats(problem);
    // After the panel is shown, so the preview has its size.
    this.preview.setClips(
      animations.map((a) => ({
        name: a.name,
        frames: a.frames.flatMap((name) => {
          const image = pixels.get(name);
          return image ? [{ image, pivot: byName.get(name)?.pivot }] : [];
        }),
      })),
      settings.fps
    );
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
    $("#animationPreview").hidden = this.animations.length === 0;
    // Data formats describe an animation within one sheet.
    const tagged = new Set(
      atlas?.sheets.flatMap((s) =>
        frameTags(
          s.frames.map((f) => spriteOfFrame(f.filename)),
          this.animations
        ).map((t) => t.name)
      )
    );
    const split = atlas ? this.animations.filter((a) => !tagged.has(a.name)) : [];
    const warning = $("#animationHint");
    warning.hidden = split.length === 0;
    warning.textContent = `Spread over several sheets, so not exported as animations: ${split
      .map((a) => a.name)
      .join(", ")}.`;
  }

  // ------------------------------------------------------------------ files

  private load(work: PackWork): void {
    this.loading = true;
    this.selected.clear();
    this.watched = [];
    this.renderWatched();
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
      this.notify("Exporting…", 60_000);
      const files = await this.packer.export({
        name,
        sheets: this.atlas.sheets,
        settings,
        animations: this.animations,
        output: output === "files" ? "files" : "zip",
      });
      for (const { name, mime, bytes } of files) {
        downloadBlob(new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mime }), name);
      }
      this.notify(`Exported ${files.map((f) => f.name).join(", ")}`, 4000);
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
      '#projectName, #sidePanel input[type="number"]'
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
      if (input === "#imageInput") picker.accept = IMPORT_ACCEPT;
      $(button).addEventListener("click", () => picker.click());
      picker.addEventListener("change", () => {
        const files = filesFromInput(picker.files!);
        picker.value = ""; // the same files can be picked again
        void this.importFiles(files);
      });
    }
    const live = $("#addLive");
    live.hidden = !supportsLiveFolders();
    live.addEventListener("click", () => {
      void pickLiveFolder().then(
        (handle) => handle && this.watch(handle),
        (error: Error) => this.notify(`Could not open the folder: ${error.message}`, 5000)
      );
    });
    setInterval(() => {
      if (this.watched.length && document.visibilityState === "visible") void this.scanFolders();
    }, LIVE_INTERVAL);
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
    bindKeys(this.workspace.keymap, {
      undo: () => void this.history.undo(),
      redo: () => void this.history.redo(),
      save: () => void this.files.save(),
      saveAs: () => void this.files.saveAs(),
      open: () => void this.files.showBrowser(),
      export: () => void this.export($<SplitButton>("#exportButton").value),
      fit: () => void this.workspace.fitToView(),
      removeSelected: () => this.remove([...this.selected]),
      deselect: () => this.select([]),
    });
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

/** "Added 3 sprites, updated 1, could not read x.png"; empty when nothing happened. */
function summary(
  result: { added: number; updated: number; removed?: number },
  failed: readonly string[]
): string {
  const { added, updated, removed = 0 } = result;
  const parts = [
    added ? `added ${added} sprite${added === 1 ? "" : "s"}` : "",
    updated ? `updated ${updated}` : "",
    removed ? `removed ${removed}` : "",
    failed.length ? `could not read ${failed.join(", ")}` : "",
  ].filter(Boolean);
  const text = parts.join(", ");
  return text.charAt(0).toUpperCase() + text.slice(1);
}
