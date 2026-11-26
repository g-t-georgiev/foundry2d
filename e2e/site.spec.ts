import { expect, test } from "@playwright/test";

/**
 * The site as a whole (roadmap 11.2): the studio at the root, every app
 * under its path on the same origin, sharing the browser's storage.
 */
test.beforeEach(async ({ page }) => {
  // The first-run tours would cover the apps.
  await page.addInitScript(() => {
    for (const app of ["pixel", "levels", "packer"]) {
      localStorage.setItem(`gs2d.tours.${app}`, JSON.stringify(["intro"]));
    }
  });
});

test("the studio links every tool, each under its path of the site", async ({ page }) => {
  await page.goto("./");
  for (const [name, path, title] of [
    ["Pixel", "/pixel/", "Game Studio 2D · Pixel"],
    ["Levels", "/levels/", "Game Studio 2D · Levels"],
    ["Packer", "/packer/", "Game Studio 2D · Packer"],
    ["Manual", "/docs/", "Game Studio 2D · Manual"],
  ]) {
    await page.goto("./");
    await page.getByRole("link", { name: new RegExp(`^${name}`) }).click();
    await expect(page).toHaveURL(new RegExp(`${path}$`));
    await expect(page).toHaveTitle(new RegExp(title));
  }
  // Without the slash, the path still leads to the app.
  await page.goto("./levels");
  await expect(page).toHaveURL(/\/levels\/$/);
});

test("the tools share one browser storage", async ({ page }) => {
  await page.goto("./pixel/");
  await page.waitForFunction(() => "foundry" in window);
  await page.locator("#spriteName").fill("shared hero");
  await page.keyboard.press("Control+s");
  await expect(page.locator("#fileDisplay")).toContainText("browser");

  await page.goto("./levels/");
  await page.waitForFunction(() => "foundry" in window);
  const library = await page.evaluate(async () => {
    const app = window as unknown as {
      foundry: {
        session: { storage: { projects: { list(): Promise<{ app: string; name: string }[]> } } };
      };
    };
    return (await app.foundry.session.storage.projects.list()).map((p) => `${p.app}: ${p.name}`);
  });
  expect(library).toContain("pixel: shared hero");
});
