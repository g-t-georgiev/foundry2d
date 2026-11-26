import { expect, test, type Page } from "@playwright/test";

/** Where the top of an element is in the window, in CSS pixels. */
const topOf = (page: Page, id: string) =>
  page.evaluate((id) => Math.round(document.getElementById(id)!.getBoundingClientRect().top), id);

const current = (page: Page) => page.locator('#tree a[aria-current="true"]');

test.beforeEach(async ({ page }) => {
  await page.goto("./");
  await expect(page.locator(".article-title").first()).toBeVisible();
});

test("the contents lead to articles, and the URL keeps the place", async ({ page }) => {
  await expect(page.locator(".tree-toggle")).toHaveText([
    "1. Getting started",
    "2. Pixel",
    "3. Levels",
    "4. Packer",
    "5. File formats",
  ]);
  // Every image of the manual loads.
  for (const image of await page.locator(".article img").all()) {
    // Images load lazily, when they come near the view.
    await image.scrollIntoViewIfNeeded();
    await expect
      .poll(() => image.evaluate((img: HTMLImageElement) => img.naturalWidth))
      .toBeGreaterThan(0);
  }
  await page.evaluate(() => scrollTo(0, 0));

  // Scrolling through opened every chapter; close one, then open it again.
  const chapter = page.getByRole("button", { name: "3. Levels" });
  const autoLayers = page.locator("#tree").getByRole("link", { name: "Auto-layers" });
  await page.reload();
  await page.evaluate(() => scrollTo(0, 0));
  await chapter.click();
  if (!(await autoLayers.isVisible())) await chapter.click();
  await expect(autoLayers).toBeVisible();
  await chapter.click();
  await expect(autoLayers).toBeHidden();
  await chapter.click();
  await autoLayers.click();
  await expect(page).toHaveURL(/#levels\/auto-layers$/);
  await expect.poll(() => topOf(page, "levels/auto-layers")).toBeLessThan(100);
  await expect(current(page)).toHaveText("Auto-layers");

  // Scrolling on marks the next article and moves the URL with it.
  const next = await topOf(page, "levels/entities");
  await page.mouse.move(800, 500);
  await page.mouse.wheel(0, next - 60);
  await expect(current(page)).toHaveText("Entities, fields and enums");
  await expect(page).toHaveURL(/#levels\/entities$/);

  // A reload comes back to the same article.
  await page.reload();
  await expect.poll(() => topOf(page, "levels/entities")).toBeLessThan(100);
  await expect.poll(() => topOf(page, "levels/entities")).toBeGreaterThan(0);
  await expect(current(page)).toHaveText("Entities, fields and enums");
});

test("links inside articles jump to other articles and their sections", async ({ page }) => {
  await page
    .locator("article")
    .first()
    .getByRole("link", { name: "A sprite as a tileset" })
    .click();
  await expect(page).toHaveURL(/#levels\/workflow-tileset$/);
  await expect.poll(() => topOf(page, "levels/workflow-tileset")).toBeLessThan(100);
  await expect(current(page)).toHaveText("Workflow: a sprite as a tileset");

  await page.goto("./#packer/settings/sheet");
  await expect.poll(() => topOf(page, "packer/settings/sheet")).toBeLessThan(100);
  await expect(current(page)).toHaveText("Packing settings");
});

test("search narrows the contents, and Enter opens the first match", async ({ page }) => {
  const search = page.getByRole("searchbox", { name: "Search the manual" });
  await page.keyboard.press("/");
  await expect(search).toBeFocused();
  await search.fill("magic wand");
  await expect(page.locator("#searchStatus")).toHaveText(/\d+ articles?/);
  const shown = page.locator("#tree .tree-articles li:not([hidden]) a");
  await expect(shown.first()).toBeVisible();
  const titles = await shown.allTextContents();
  expect(titles).toContain("Selections, clipboard and transforms");
  expect(titles).not.toContain("Auto-layers");
  await search.press("Enter");
  await expect(page).toHaveURL(new RegExp(`#[a-z-]+/[a-z-]+$`));
  await expect(current(page)).toHaveText(titles[0]);

  await search.fill("zzzz");
  await expect(page.locator("#searchStatus")).toHaveText("Nothing found");
  await search.press("Escape");
  await expect(page.locator(".tree-chapter")).toHaveCount(5);
});

test("chapters link to their app; themes switch and stay; print shows only the text", async ({
  page,
}) => {
  await expect(page.getByRole("link", { name: "Open Levels ↗" })).toHaveAttribute(
    "href",
    /\/levels\/$/
  );
  const theme = page.locator("#themeToggle");
  const root = page.locator("html");
  await expect(theme).toHaveText("Theme: system");
  await theme.click();
  await expect(theme).toHaveText("Theme: light");
  await expect(root).toHaveAttribute("data-theme", "light");
  const background = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  const light = await background();
  await theme.click();
  await expect(root).toHaveAttribute("data-theme", "dark");
  expect(await background()).not.toBe(light);
  await page.reload();
  await expect(root).toHaveAttribute("data-theme", "dark");

  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".sidebar")).toBeHidden();
  await expect(page.locator(".topbar")).toBeHidden();
  await expect(page.locator(".article-title").first()).toBeVisible();
});

test("on a narrow screen the contents open from the menu button", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  const sidebar = page.locator(".sidebar");
  const onScreen = () => sidebar.evaluate((el) => el.getBoundingClientRect().right > 10);
  // It slides away when the window gets narrow.
  await expect.poll(onScreen).toBe(false);
  await page.getByRole("button", { name: "Contents" }).click();
  await expect.poll(onScreen).toBe(true);
  await page.getByRole("button", { name: "4. Packer" }).click();
  await page.locator("#tree").getByRole("link", { name: "Exporting sheets" }).click();
  await expect.poll(onScreen).toBe(false);
  await expect(page).toHaveURL(/#packer\/exporting$/);
  // No sideways scrolling.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
