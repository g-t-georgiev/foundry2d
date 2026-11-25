import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vite-plus/test";
import { buildManual, search, slug } from "../src/manual";

const docs = fileURLToPath(new URL("../../../docs/", import.meta.url));

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)]
  );
}

const posix = (path: string) => path.replace(/\\/g, "/");
const sources = Object.fromEntries(
  files(join(docs, "manual")).map((f) => [
    posix(relative(join(docs, "manual"), f)),
    readFileSync(f, "utf8"),
  ])
);
const images = Object.fromEntries(
  files(join(docs, "images")).map((f) => [posix(relative(docs, f)), `/img/${f}`])
);

describe("the manual", () => {
  const manual = buildManual(sources, images);

  it("has the README's chapters, every article titled, and no broken links or images", () => {
    expect(manual.problems).toEqual([]);
    expect(manual.chapters.map((c) => c.title)).toEqual([
      "Getting started",
      "Pixel Editor",
      "Level Designer",
      "Sprite Packer",
      "File formats",
    ]);
    const ids = manual.chapters.flatMap((c) => c.articles.map((a) => a.id));
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("pixel-editor/shortcuts");
  });

  it("links between articles point at anchors that exist", () => {
    const anchors = new Set<string>();
    for (const article of manual.chapters.flatMap((c) => c.articles)) {
      for (const [, id] of article.html.matchAll(/ id="([^"]+)"/g)) anchors.add(id);
    }
    const targets = manual.chapters
      .flatMap((c) => c.articles)
      .flatMap((a) => [...a.html.matchAll(/href="#([^"]+)"/g)].map((m) => m[1]));
    expect(targets.length).toBeGreaterThan(10);
    for (const target of targets) expect(anchors, target).toContain(target);
  });
});

describe("rendering", () => {
  const manual = buildManual(
    {
      "README.md": "1. **One**\n2. **Two**\n",
      "01-one/01-first.md": [
        "# First `thing`",
        "",
        "See [the second](../02-two/01-second.md#a-part), [this part](#more), [the roadmap](../../ROADMAP.md) and [a site](https://example.com).",
        "",
        "![Picture](../../images/a.png)",
        "",
        "## More",
      ].join("\n"),
      "02-two/01-second.md": "# Second\n\n## A part\n\n[gone](missing.md)\n",
    },
    { "images/a.png": "/a.png" }
  );
  const [first, second] = manual.chapters.flatMap((c) => c.articles);

  it("makes ids, titles and headings from the paths and text", () => {
    expect(manual.chapters.map((c) => [c.id, c.number, c.title])).toEqual([
      ["one", 1, "One"],
      ["two", 2, "Two"],
    ]);
    expect(first).toMatchObject({ id: "one/first", title: "First thing" });
    expect(first.html).toContain('<h2 class="article-title" id="one/first">');
    expect(first.headings).toEqual([{ id: "one/first/more", title: "More" }]);
    expect(second.html).toContain('<h3 id="two/second/a-part">');
  });

  it("turns links into anchors, the rest of the docs into repository links", () => {
    expect(first.html).toContain('href="#two/second/a-part"');
    expect(first.html).toContain('href="#one/first/more"');
    expect(first.html).toContain(
      'href="https://github.com/g-t-georgiev/foundry2d/blob/dev/docs/ROADMAP.md"'
    );
    expect(first.html).toContain('href="https://example.com" target="_blank"');
    expect(first.html).toContain('<img src="/a.png" alt="Picture"');
    expect(manual.problems).toEqual(["02-two/01-second.md: missing.md"]);
  });

  it("searches titles and text for every word", () => {
    expect([...search(manual.chapters, "second gone")]).toEqual(["two/second"]);
    expect([...search(manual.chapters, "FIRST")]).toEqual(["one/first"]);
    expect(search(manual.chapters, "nowhere").size).toBe(0);
    expect(slug("02-Pixel Editor")).toBe("pixel-editor");
  });
});
