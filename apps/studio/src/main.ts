/// <reference types="vite/client" />
import {
  LEGACY_DB_NAME,
  openStorage,
  pruneUnusedAssets,
  type ProjectMeta,
  type RecentFileRecord,
  type Storage,
} from "@gs2d/core";
import { el, registerAppUpdates, setupAppHelp, type GuidedTour, type HelpButton } from "@gs2d/ui";
import {
  ensurePermission,
  sendFileToTool,
  toolForFile,
  type FileHandleLike,
} from "@gs2d/workspace";
import { TOURS } from "./help";
import { toolOf, TOOLS, toolUrl, type Tool } from "./tools";

/*
 * The hub (roadmap 11.3): the studio's start page and the entry point of
 * every tool. It reads the browser storage the tools share (they are on
 * one origin, 11.2) and opens a tool with what to open in its address.
 */

const $ = <T extends HTMLElement = HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;

const formatDate = (ms: number) =>
  new Date(ms).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

const formatBytes = (bytes: number) => {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${units[unit]}`;
};

const badge = (tool: Tool) =>
  el("span", { className: `badge badge-${tool.id}`, textContent: tool.name });

/** Unsaved work kept for crash recovery, one per tool. */
interface Unsaved {
  tool: Tool;
  name: string;
  where: string;
}

async function unsavedWork(storage: Storage): Promise<Unsaved[]> {
  const found: Unsaved[] = [];
  for (const key of await storage.recovery.listRecovery()) {
    const tool = toolOf(key.split(":")[0]);
    const bytes = tool && (await storage.recovery.loadRecovery(key));
    if (!tool || !bytes) continue;
    try {
      const snapshot = JSON.parse(new TextDecoder().decode(bytes)) as {
        fileName?: string | null;
        libraryId?: string | null;
        data?: { name?: unknown };
      };
      const name = typeof snapshot.data?.name === "string" ? snapshot.data.name : "untitled";
      const where =
        snapshot.fileName ?? (snapshot.libraryId ? "saved in this browser" : "never saved");
      found.push({ tool, name, where });
    } catch {
      // An unreadable snapshot: the tool ignores it too.
    }
  }
  return TOOLS.flatMap((tool) => found.filter((u) => u.tool === tool));
}

function renderToolLinks(): void {
  $("#toolLinks").replaceChildren(
    ...TOOLS.map((tool) => el("a", { href: toolUrl(tool.id), textContent: tool.name })),
    el("a", { href: "./docs/", textContent: "Manual" })
  );
}

function renderContinue(items: readonly Unsaved[]): void {
  $("#continueSection").hidden = items.length === 0;
  $("#continueList").replaceChildren(
    ...items.map(({ tool, name, where }) =>
      el(
        "a",
        { className: "card continue-card", href: toolUrl(tool.id) },
        badge(tool),
        el("strong", { className: "card-name", textContent: name }),
        el("span", { className: "card-meta", textContent: `Unsaved changes · ${where}` })
      )
    )
  );
}

function renderNew(): void {
  $("#newList").replaceChildren(
    ...TOOLS.map((tool) =>
      el(
        "div",
        { className: "tool-column" },
        el("h3", {}, el("a", { href: toolUrl(tool.id), textContent: tool.name })),
        el("p", { className: "hint", textContent: tool.blurb }),
        ...tool.templates.map((t) =>
          el(
            "a",
            {
              className: "template",
              href: toolUrl(tool.id, { kind: "new", id: t.id }),
              title: t.description,
            },
            el("span", { textContent: t.label }),
            el("small", { textContent: t.description })
          )
        )
      )
    )
  );
}

/** Saved projects of every tool, filtered by tool and searched by name. */
class Library {
  private projects: ProjectMeta[] = [];
  private filter: Tool["id"] | "all" = "all";

  constructor(private readonly storage: Storage) {
    $("#librarySearch").addEventListener("input", () => this.render());
    $("#libraryFilters").replaceChildren(
      ...[{ id: "all" as const, name: "All" }, ...TOOLS].map(({ id, name }) => {
        const button = el("button", { className: "btn btn-small", textContent: name });
        button.dataset.filter = id;
        button.addEventListener("click", () => {
          this.filter = id;
          this.render();
        });
        return button;
      })
    );
  }

  async load(): Promise<void> {
    this.projects = (await this.storage.projects.list()).filter((p) => toolOf(p.app));
    this.render();
  }

  private render(): void {
    for (const button of document.querySelectorAll<HTMLElement>("#libraryFilters button")) {
      button.setAttribute("aria-pressed", String(button.dataset.filter === this.filter));
    }
    const words = $<HTMLInputElement>("#librarySearch")
      .value.toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    const shown = this.projects.filter(
      (p) =>
        (this.filter === "all" || p.app === this.filter) &&
        words.every((w) => p.name.toLowerCase().includes(w))
    );
    const empty = $("#libraryEmpty");
    empty.hidden = shown.length > 0;
    empty.textContent = this.projects.length
      ? "Nothing matches."
      : "Nothing saved in this browser yet. Ctrl+S in a tool keeps work here.";
    $("#libraryList").replaceChildren(...shown.map((p) => this.card(p)));
  }

  private card(project: ProjectMeta): HTMLElement {
    const tool = toolOf(project.app)!;
    const thumb = el("span", { className: "thumb" });
    if (project.thumbnail) thumb.append(el("img", { src: project.thumbnail, alt: "" }));
    const remove = el("button", {
      className: "btn btn-icon btn-small remove",
      textContent: "✕",
      title: `Delete "${project.name}" from this browser`,
    });
    remove.setAttribute("aria-label", remove.title);
    remove.addEventListener("click", () => void this.remove(project));
    return el(
      "div",
      { className: "card-wrap" },
      el(
        "a",
        { className: "card", href: toolUrl(tool.id, { kind: "project", id: project.id }) },
        thumb,
        el("strong", { className: "card-name", textContent: project.name }),
        el("span", { className: "card-meta" }, badge(tool), ` ${formatDate(project.updatedAt)}`)
      ),
      remove
    );
  }

  private async remove(project: ProjectMeta): Promise<void> {
    if (!confirm(`Delete "${project.name}" from this browser? Files on disk are not affected.`)) {
      return;
    }
    await this.storage.projects.delete(project.id);
    await pruneUnusedAssets(this.storage);
    await this.load();
    await renderStorage(this.storage);
  }
}

/** Recent files of every tool; opening one asks for access here, on the click. */
async function renderRecent(storage: Storage): Promise<void> {
  const recent = (await storage.recentFiles.list()).filter((r) => toolOf(r.app));
  $("#recentSection").hidden = recent.length === 0;
  $("#recentList").replaceChildren(
    ...recent.map((record) => {
      const tool = toolOf(record.app)!;
      const open = el(
        "button",
        { className: "recent-open" },
        badge(tool),
        el("span", { className: "recent-name", textContent: record.name }),
        el("time", { textContent: formatDate(record.openedAt) })
      );
      open.addEventListener("click", () => void openRecent(record, tool));
      const remove = el("button", {
        className: "btn btn-icon btn-small",
        textContent: "✕",
        title: `Remove ${record.name} from recent files`,
      });
      remove.setAttribute("aria-label", remove.title);
      remove.addEventListener("click", () => {
        void storage.recentFiles.delete(record.id).then(() => renderRecent(storage));
      });
      return el("li", {}, open, remove);
    })
  );
}

async function openRecent(record: RecentFileRecord, tool: Tool): Promise<void> {
  const handle = record.handle as FileHandleLike | null;
  // Asked here, where the click happened; the tool then has access without asking again.
  if (handle?.getFile && !(await ensurePermission(handle, "readwrite"))) return;
  location.href = toolUrl(tool.id, { kind: "recent", id: record.id });
}

async function legacyDatabaseExists(): Promise<boolean> {
  try {
    return ((await indexedDB.databases?.()) ?? []).some((d) => d.name === LEGACY_DB_NAME);
  } catch {
    return false;
  }
}

async function renderStorage(storage: Storage): Promise<void> {
  let usage = "";
  try {
    const estimate = await navigator.storage?.estimate?.();
    if (estimate?.usage !== undefined) {
      usage = `${formatBytes(estimate.usage)} used${estimate.quota ? ` of ${formatBytes(estimate.quota)}` : ""}.`;
    }
  } catch {
    // Not every browser says.
  }
  $("#storageUsage").textContent =
    storage.kind === "memory"
      ? "Browser storage is unavailable (private mode?): work saved here is lost on reload. Save to files."
      : `${usage} Projects, images, recent files and unsaved work are kept in this browser for every tool.`;
  $("#removeLegacy").hidden = !(await legacyDatabaseExists());
}

function bindStorage(storage: Storage, library: Library): void {
  const message = $("#storageMessage");
  $("#pruneAssets").addEventListener("click", () => {
    void pruneUnusedAssets(storage).then(async (removed) => {
      message.textContent = removed
        ? `Removed ${removed} image${removed === 1 ? "" : "s"} nothing uses any more.`
        : "Every stored image is in use.";
      await renderStorage(storage);
    });
  });
  $("#removeLegacy").addEventListener("click", () => {
    const sure = confirm(
      "Remove the browser storage from before Game Studio 2D? Its work was copied into the studio when it first opened; this removes only the old copy."
    );
    if (!sure) return;
    const request = indexedDB.deleteDatabase(LEGACY_DB_NAME);
    request.onsuccess = () => {
      message.textContent = "The old copy is removed.";
      void renderStorage(storage).then(() => library.load());
    };
    request.onblocked = () => {
      message.textContent = "Close the other tabs of the tools first, then try again.";
    };
  });
}

/**
 * The installed studio handles every work-file type: a file it is opened
 * with goes to its tool. Files of other kinds are named in the status line.
 */
function bindLaunchQueue(storage: Storage): void {
  const queue = (
    globalThis as {
      launchQueue?: {
        setConsumer(consumer: (params: { files: readonly FileHandleLike[] }) => void): void;
      };
    }
  ).launchQueue;
  queue?.setConsumer((params) => {
    const [first] = params.files;
    if (!first) return;
    const tool = toolForFile(first.name);
    if (!tool) {
      $("#storageMessage").textContent = `${first.name} isn't a Game Studio 2D work file.`;
      return;
    }
    void sendFileToTool(storage, first, tool, new URL("./", location.href)).then((url) =>
      location.assign(url)
    );
  });
}

/**
 * The tools' offline copies: the installed studio is one app, so its first
 * visit gets every tool ready to work without a network.
 */
function prepareToolsOffline(): void {
  if (!import.meta.env.PROD || !("serviceWorker" in navigator)) return;
  for (const folder of [...TOOLS.map((t) => t.id), "docs"]) {
    void navigator.serviceWorker
      .register(`./${folder}/sw.js`, { scope: `./${folder}/` })
      .catch(() => undefined);
  }
}

registerAppUpdates({ enabled: import.meta.env.PROD, appName: "Game Studio 2D" });
prepareToolsOffline();

const storage = await openStorage();
bindLaunchQueue(storage);
renderToolLinks();
renderNew();
const library = new Library(storage);
bindStorage(storage, library);
const ready = Promise.all([
  unsavedWork(storage).then(renderContinue),
  library.load(),
  renderRecent(storage),
  renderStorage(storage),
]);

setupAppHelp({
  app: "studio",
  tours: TOURS,
  tourElement: document.querySelector<GuidedTour>("guided-tour")!,
  helpButton: document.querySelector<HelpButton>("help-button")!,
  manual: { home: "./docs/", shortcuts: "./docs/#getting-started/canvas" },
  ready,
});

// Coming back with the browser's Back button shows fresh lists.
addEventListener("pageshow", (ev) => {
  if (ev.persisted) location.reload();
});

// Exposed for debugging and tests.
Object.assign(window, { studio: { storage, ready } });
