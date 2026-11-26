import { readFileSync } from "node:fs";
import { describe, expect, it } from "vite-plus/test";
import { SHORTCUTS_ARTICLE, shortcutsMarkdown } from "../src/manual";

describe("manual", () => {
  it("lists the shortcuts the app binds (run `vp run docs` after changing them)", () => {
    const path = new URL(`../../../${SHORTCUTS_ARTICLE}`, import.meta.url);
    const written = readFileSync(path, "utf8").replace(/\r\n/g, "\n");
    expect(written).toBe(shortcutsMarkdown());
  });
});
