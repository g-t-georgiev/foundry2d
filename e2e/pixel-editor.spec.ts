import { expect, test, type Page } from "@playwright/test";
import { drag, openApp, reloadAfterRecovery, toScreen, type FoundryApp } from "./helpers";

const CANVAS = "#paintCanvas";

interface PixelApp extends FoundryApp {
  sprite: { doc: { getActiveLayer(): { get(x: number, y: number): number } | null } };
}

/** Packed RGBA value of a sprite pixel on the active layer (0 = transparent). */
const pixel = (page: Page, x: number, y: number) =>
  page.evaluate(
    ({ x, y }) => (window.foundry as PixelApp).sprite.doc.getActiveLayer()?.get(x, y) ?? -1,
    { x, y }
  );

/** Screen position of the centre of sprite pixel (x, y). */
const at = (page: Page, x: number, y: number) => toScreen(page, CANVAS, { x: x + 0.5, y: y + 0.5 });

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test("draws with the pen, then undoes and redoes", async ({ page }) => {
  const p = await at(page, 5, 5);
  await page.mouse.click(p.x, p.y);
  await expect.poll(() => pixel(page, 5, 5)).not.toBe(0);

  await page.keyboard.press("Control+z");
  await expect.poll(() => pixel(page, 5, 5)).toBe(0);
  await page.keyboard.press("Control+y");
  await expect.poll(() => pixel(page, 5, 5)).not.toBe(0);
});

test("shows the actual zoom from the first frame", async ({ page }) => {
  const zoom = await page.evaluate(() => window.foundry!.workspace.zoom);
  expect(zoom).not.toBe(1);
  await expect(page.locator("#zoomDisplay")).toHaveText(`Zoom: ${Math.round(zoom * 100)}%`);
});

test("restores unsaved work after a reload", async ({ page }) => {
  await drag(page, await at(page, 2, 2), await at(page, 8, 2));
  await expect.poll(() => pixel(page, 8, 2)).not.toBe(0);

  await reloadAfterRecovery(page);
  await expect(page.locator("#messageDisplay")).toContainText("Restored");
  expect(await pixel(page, 5, 2)).not.toBe(0);
});

test("a locked layer can't be drawn on", async ({ page }) => {
  const lock = page.locator("layers-panel .row .lock").first();
  await lock.click();
  await expect(lock).toHaveAttribute("aria-pressed", "true");

  const p = await at(page, 6, 6);
  await page.mouse.click(p.x, p.y);
  expect(await pixel(page, 6, 6)).toBe(0);

  await lock.click();
  await page.mouse.click(p.x, p.y);
  await expect.poll(() => pixel(page, 6, 6)).not.toBe(0);
});

test("selects and moves pixels in one undo step", async ({ page }) => {
  const p = await at(page, 5, 5);
  await page.mouse.click(p.x, p.y);
  await expect.poll(() => pixel(page, 5, 5)).not.toBe(0);

  await page.keyboard.press("m");
  await drag(page, await at(page, 4, 4), await at(page, 6, 6));
  await drag(page, p, await at(page, 10, 5));
  await expect.poll(() => pixel(page, 10, 5)).not.toBe(0);
  expect(await pixel(page, 5, 5)).toBe(0);

  await page.keyboard.press("Control+z");
  await expect.poll(() => pixel(page, 5, 5)).not.toBe(0);
  expect(await pixel(page, 10, 5)).toBe(0);
});

test("saves to the browser library and lists it on the start screen", async ({ page }) => {
  const p = await at(page, 3, 3);
  await page.mouse.click(p.x, p.y);
  await page.keyboard.press("Control+s");
  await expect(page.locator("#messageDisplay")).toContainText("Saved");

  await page.reload();
  // With saved work and nothing to recover, the start screen opens.
  const browser = page.locator("project-browser");
  await expect(browser.getByText("sprite", { exact: true })).toBeVisible();
});
