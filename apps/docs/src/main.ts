import { el } from "@foundry2d/ui";
import { APP_LINKS, manual } from "./content";
import { search, type Chapter } from "./manual";

const $ = <T extends HTMLElement = HTMLElement>(selector: string) =>
  document.querySelector<T>(selector)!;

/** "light", "dark" or "auto" (follow the system); remembered per browser. */
type Theme = "light" | "dark" | "auto";
const THEME_KEY = "foundry2d.docs.theme";

function storedTheme(): Theme {
  try {
    const value = localStorage.getItem(THEME_KEY);
    return value === "light" || value === "dark" ? value : "auto";
  } catch {
    return "auto";
  }
}

function applyTheme(theme: Theme): void {
  const dark =
    theme === "dark" || (theme === "auto" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  const button = $("#themeToggle");
  button.textContent =
    theme === "auto" ? "Theme: system" : theme === "dark" ? "Theme: dark" : "Theme: light";
  button.dataset.theme = theme;
}

/** The articles, one after another. */
function renderContent(chapters: readonly Chapter[]): void {
  $("#content").replaceChildren(
    ...chapters.map((chapter) => {
      const section = el("section", { className: "chapter", id: chapter.id });
      const heading = el("div", { className: "chapter-heading" });
      heading.append(el("h1", { textContent: `${chapter.number}. ${chapter.title}` }));
      const app = APP_LINKS[chapter.id];
      if (app) {
        const link = el("a", {
          className: "btn open-app",
          href: app.url,
          textContent: `${app.label} ↗`,
        });
        link.target = "_blank";
        link.rel = "noopener";
        heading.append(link);
      }
      section.append(heading);
      for (const article of chapter.articles) {
        const node = el("article", { className: "article" });
        node.innerHTML = article.html;
        section.append(node);
      }
      return section;
    })
  );
}

/** The chapter and article tree. */
function renderTree(chapters: readonly Chapter[]): void {
  $("#tree").replaceChildren(
    ...chapters.map((chapter) => {
      const item = el("li", { className: "tree-chapter" });
      item.dataset.chapter = chapter.id;
      const toggle = el("button", {
        className: "tree-toggle",
        textContent: `${chapter.number}. ${chapter.title}`,
      });
      toggle.setAttribute("aria-expanded", "false");
      toggle.addEventListener("click", () =>
        toggle.setAttribute(
          "aria-expanded",
          String(toggle.getAttribute("aria-expanded") !== "true")
        )
      );
      const list = el("ul", { className: "tree-articles" });
      for (const article of chapter.articles) {
        const link = el("a", { href: `#${article.id}`, textContent: article.title });
        link.dataset.article = article.id;
        list.append(el("li", {}, link));
      }
      item.append(toggle, list);
      return item;
    })
  );
}

const expand = (chapterId: string) =>
  document
    .querySelector(`[data-chapter="${chapterId}"] .tree-toggle`)
    ?.setAttribute("aria-expanded", "true");

/** Scrolls the contents (only them, never the page) so a link is in view. */
function revealInTree(link: HTMLElement): void {
  const tree = $("#tree").parentElement!;
  const box = link.getBoundingClientRect();
  const view = tree.getBoundingClientRect();
  if (box.top < view.top + 40) tree.scrollTop -= view.top + 40 - box.top;
  else if (box.bottom > view.bottom - 8) tree.scrollTop += box.bottom - view.bottom + 8;
}

/** Marks the article being read in the tree, and keeps the URL on it. */
function setCurrent(id: string, updateHash: boolean): void {
  for (const link of document.querySelectorAll<HTMLElement>("#tree a")) {
    if (link.dataset.article === id) {
      link.setAttribute("aria-current", "true");
      expand(id.split("/")[0]);
      revealInTree(link);
    } else link.removeAttribute("aria-current");
  }
  if (updateHash && location.hash !== `#${id}`) history.replaceState(null, "", `#${id}`);
}

/**
 * Scroll-spy: the current article is the last one whose title has passed
 * the top fifth of the window.
 */
function watchScrolling(): void {
  const titles = [...document.querySelectorAll<HTMLElement>(".article-title")];
  let pending = false;
  const update = () => {
    pending = false;
    const line = window.innerHeight * 0.2;
    let current = titles[0];
    for (const title of titles) {
      if (title.getBoundingClientRect().top <= line) current = title;
      else break;
    }
    // At the very end, the last article is the one being read.
    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) {
      current = titles.at(-1) ?? current;
    }
    if (current) setCurrent(current.id, !jumping);
  };
  const schedule = () => {
    if (!pending) {
      pending = true;
      // A timer rather than a frame callback: frames pause in hidden pages and panes.
      setTimeout(update, 50);
    }
  };
  // IntersectionObserver says when a title crosses the line; scroll covers long articles.
  const observer = new IntersectionObserver(schedule, { rootMargin: "0px 0px -80% 0px" });
  for (const title of titles) observer.observe(title);
  addEventListener("scroll", schedule, { passive: true });
  update();
}

/** While jumping to a link, the URL already says where to. */
let jumping = false;

function jumpTo(id: string): void {
  const target = id ? document.getElementById(id) : null;
  if (!target) return;
  jumping = true;
  // A chapter's first article shows the chapter's heading too.
  const article = target.closest("article");
  const first = article && article === article.parentElement?.querySelector("article");
  const isTitle = target.classList.contains("article-title");
  (first && isTitle ? article.parentElement : target).scrollIntoView();
  const title = article?.querySelector(".article-title");
  if (title) setCurrent(title.id, false);
  setTimeout(() => (jumping = false), 100);
}

function bindSearch(chapters: readonly Chapter[]): void {
  const input = $<HTMLInputElement>("#search");
  const status = $("#searchStatus");
  const run = () => {
    const query = input.value.trim();
    const found = query ? search(chapters, query) : null;
    for (const link of document.querySelectorAll<HTMLElement>("#tree a")) {
      link.parentElement!.hidden = found !== null && !found.has(link.dataset.article!);
    }
    for (const item of document.querySelectorAll<HTMLElement>(".tree-chapter")) {
      const any = [...item.querySelectorAll("li")].some((li) => !li.hidden);
      item.hidden = !any;
      if (found && any) expand(item.dataset.chapter!);
    }
    status.textContent = found
      ? found.size
        ? `${found.size} article${found.size === 1 ? "" : "s"}`
        : "Nothing found"
      : "";
  };
  input.addEventListener("input", run);
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") {
      const first = document.querySelector<HTMLAnchorElement>(
        "#tree .tree-chapter:not([hidden]) .tree-articles li:not([hidden]) a"
      );
      if (first) location.hash = first.dataset.article!;
    } else if (ev.key === "Escape") {
      input.value = "";
      run();
    }
  });
  addEventListener("keydown", (ev) => {
    const typing = ev.target instanceof HTMLInputElement;
    if (!typing && (ev.key === "/" || ((ev.ctrlKey || ev.metaKey) && ev.key === "k"))) {
      ev.preventDefault();
      input.focus();
      input.select();
    }
  });
}

function bindLayout(): void {
  const body = document.body;
  $("#menuToggle").addEventListener("click", () => body.classList.toggle("nav-open"));
  // Following a link on a narrow screen closes the menu.
  $("#tree").addEventListener("click", (ev) => {
    if ((ev.target as Element).closest("a")) body.classList.remove("nav-open");
  });
  $("#themeToggle").addEventListener("click", () => {
    const order: Theme[] = ["auto", "light", "dark"];
    const next = order[(order.indexOf(storedTheme()) + 1) % order.length];
    try {
      if (next === "auto") localStorage.removeItem(THEME_KEY);
      else localStorage.setItem(THEME_KEY, next);
    } catch {
      // Storage may be unavailable; the theme still changes for this visit.
    }
    applyTheme(next);
  });
  matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () =>
    applyTheme(storedTheme())
  );
  $("#printButton").addEventListener("click", () => print());
}

// The URL's hash says where to be; the browser restoring an old position would fight it.
history.scrollRestoration = "manual";
applyTheme(storedTheme());
renderTree(manual.chapters);
renderContent(manual.chapters);
bindSearch(manual.chapters);
bindLayout();
addEventListener("hashchange", () => jumpTo(decodeURIComponent(location.hash.slice(1))));
if (location.hash) jumpTo(decodeURIComponent(location.hash.slice(1)));
else expand(manual.chapters[0]?.id ?? "");
watchScrolling();
if (manual.problems.length) console.warn("Manual problems:", manual.problems);

// Exposed for debugging and tests.
Object.assign(window, { manual });
