import { Marked, type Tokens } from "marked";

/**
 * Turns the Markdown manual (`docs/manual`) into chapters of rendered
 * articles for the site. Pure: no DOM, so it is tested in Node.
 *
 * Folders are chapters and files are articles, both numbered in reading
 * order ("02-pixel-editor/03-selections.md"). Chapter titles come from the
 * manual's README, the article titles from their first heading. Links
 * between articles become in-page anchors, so the site is one document.
 */

export interface Article {
  /** Anchor and URL hash, e.g. "pixel-editor/selections". */
  id: string;
  title: string;
  /** Rendered HTML, the title included (as an `h2`). */
  html: string;
  /** Lower-case plain text, for search. */
  text: string;
  /** Section headings inside the article. */
  headings: { id: string; title: string }[];
}

export interface Chapter {
  /** e.g. "pixel-editor". */
  id: string;
  /** 1-based, as in the manual's README. */
  number: number;
  title: string;
  articles: Article[];
}

export interface Manual {
  chapters: Chapter[];
  /** Links and images that point nowhere, as "article: target". */
  problems: string[];
}

/** Where documents outside the manual are linked to. */
export const REPOSITORY = "https://github.com/g-t-georgiev/foundry2d/blob/dev/";

/** "02-pixel-editor" → "pixel-editor"; "Pen size" → "pen-size". */
export const slug = (text: string) =>
  text
    .replace(/^\d+-/, "")
    .replace(/\.md$/, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** Joins and normalises a POSIX path ("a/b/../c" → "a/c"); `null` above the root. */
function resolve(from: string, relative: string): string | null {
  const parts = from.split("/").slice(0, -1);
  for (const part of relative.split("/")) {
    if (part === "..") {
      if (parts.length === 0) return null;
      parts.pop();
    } else if (part !== "." && part !== "") parts.push(part);
  }
  return parts.join("/");
}

const escapeHtml = (text: string) =>
  text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const plain = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();

/** Chapter titles in order, from the README's numbered list ("1. **Getting started**"). */
function chapterTitles(readme: string): string[] {
  return [...readme.matchAll(/^\d+\.\s+\*\*(.+?)\*\*/gm)].map((m) => m[1]);
}

/**
 * Builds the manual.
 * @param sources Markdown by path inside `docs/manual` ("README.md" included).
 * @param images Image URLs by path inside `docs` ("images/apps.png").
 */
export function buildManual(
  sources: Readonly<Record<string, string>>,
  images: Readonly<Record<string, string>>
): Manual {
  const problems: string[] = [];
  const titles = chapterTitles(sources["README.md"] ?? "");
  const paths = Object.keys(sources)
    .filter((p) => p.includes("/") && p.endsWith(".md"))
    .sort();
  const articleId = (path: string) => {
    const [folder, file] = path.split("/");
    return `${slug(folder)}/${slug(file)}`;
  };
  const known = new Set(paths);

  const render = (path: string): Article => {
    const id = articleId(path);
    const headings: Article["headings"] = [];
    let title = "";
    const marked = new Marked({
      gfm: true,
      renderer: {
        heading(this: { parser: { parseInline(t: Tokens.Heading["tokens"]): string } }, token) {
          const inner = this.parser.parseInline(token.tokens);
          if (token.depth === 1 && !title) {
            title = token.text.replace(/`/g, "");
            return `<h2 class="article-title" id="${escapeHtml(id)}">${inner}</h2>\n`;
          }
          const hid = `${id}/${slug(token.text)}`;
          if (token.depth === 2) headings.push({ id: hid, title: token.text });
          const level = Math.min(6, token.depth + 1);
          return `<h${level} id="${escapeHtml(hid)}">${inner}</h${level}>\n`;
        },
        link(this: { parser: { parseInline(t: Tokens.Link["tokens"]): string } }, token) {
          const inner = this.parser.parseInline(token.tokens);
          const href = token.href;
          if (/^[a-z]+:/i.test(href)) {
            return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener">${inner}</a>`;
          }
          const [target, fragment] = href.split("#");
          if (!target) return `<a href="#${escapeHtml(`${id}/${fragment}`)}">${inner}</a>`;
          const resolved = resolve(path, target);
          const inManual = resolved !== null && known.has(resolved);
          if (inManual) {
            const anchor = fragment ? `${articleId(resolved)}/${fragment}` : articleId(resolved);
            return `<a href="#${escapeHtml(anchor)}">${inner}</a>`;
          }
          if (resolved === "README.md" || resolved === "") return `<a href="#">${inner}</a>`;
          // Outside the manual: the rest of the docs, on the repository.
          const fromDocs = resolve(`manual/${path}`, target);
          if (fromDocs !== null && !fromDocs.startsWith("manual/")) {
            return `<a href="${REPOSITORY}docs/${escapeHtml(fromDocs)}" target="_blank" rel="noopener">${inner}</a>`;
          }
          problems.push(`${path}: ${href}`);
          return inner;
        },
        image(token) {
          const fromDocs = resolve(`manual/${path}`, token.href);
          const url = fromDocs !== null ? images[fromDocs] : undefined;
          if (!url) problems.push(`${path}: ${token.href}`);
          return `<img src="${escapeHtml(url ?? "")}" alt="${escapeHtml(token.text)}" loading="lazy" />`;
        },
      },
    });
    const html = marked.parse(sources[path], { async: false });
    if (!title) problems.push(`${path}: no title`);
    return { id, title, html, text: plain(html), headings };
  };

  const folders = [...new Set(paths.map((p) => p.split("/")[0]))];
  const chapters = folders.map((folder, i) => ({
    id: slug(folder),
    number: i + 1,
    title: titles[i] ?? slug(folder),
    articles: paths.filter((p) => p.startsWith(`${folder}/`)).map(render),
  }));
  if (titles.length !== folders.length) {
    problems.push(`README.md: ${titles.length} chapter titles for ${folders.length} folders`);
  }
  return { chapters, problems };
}

/** Articles matching every word of a search, in manual order. */
export function search(chapters: readonly Chapter[], query: string): Set<string> {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const found = new Set<string>();
  for (const chapter of chapters) {
    for (const article of chapter.articles) {
      const haystack = `${article.title.toLowerCase()} ${article.text}`;
      if (words.every((w) => haystack.includes(w))) found.add(article.id);
    }
  }
  return found;
}
