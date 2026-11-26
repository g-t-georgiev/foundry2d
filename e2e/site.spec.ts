import { expect, test, type Page } from "@playwright/test";

/**
 * The site as a whole (roadmap 11.2, 11.3): the studio's hub at the root,
 * every tool under its path on the same origin, sharing the browser's
 * storage, and opened from the hub with what to open in its address.
 */
test.beforeEach(async ({ page }) => {
  // The first-run tours would cover the pages; the hub's has its own test.
  await page.addInitScript(() => {
    for (const app of ["studio", "pixel", "levels", "packer"]) {
      localStorage.setItem(`gs2d.tours.${app}`, JSON.stringify(["intro"]));
    }
  });
});

interface Window2 {
  studio: { ready: Promise<unknown> };
  foundry: {
    session: {
      loadRecovery(): Promise<unknown>;
      storage: { projects: { list(): Promise<{ app: string; name: string }[]> } };
    };
  };
}

const hubReady = async (page: Page) => {
  await page.waitForFunction(() => "studio" in window);
  await page.evaluate(async () => {
    await (window as unknown as Window2).studio.ready;
  });
};

const toolReady = (page: Page) => page.waitForFunction(() => "foundry" in window);

test("the hub links every tool, each under its path of the site", async ({ page }) => {
  for (const [name, path, title] of [
    ["Pixel", "/pixel/", "Game Studio 2D · Pixel"],
    ["Levels", "/levels/", "Game Studio 2D · Levels"],
    ["Packer", "/packer/", "Game Studio 2D · Packer"],
    ["Manual", "/docs/", "Game Studio 2D · Manual"],
  ]) {
    await page.goto("./");
    await page.locator("#toolLinks").getByRole("link", { name }).click();
    // The manual adds the article being read to its address.
    await expect(page).toHaveURL(new RegExp(`${path}(#.*)?$`));
    await expect(page).toHaveTitle(new RegExp(title));
  }
  // Without the slash, the path still leads to the tool.
  await page.goto("./levels");
  await expect(page).toHaveURL(/\/levels\/$/);
});

test("new work starts from the hub, and saved work comes back to it", async ({ page }) => {
  page.on("dialog", (dialog) => void dialog.accept());
  await page.goto("./");
  await hubReady(page);
  await expect(page.locator("#libraryEmpty")).toContainText("Nothing saved");
  await page
    .locator("#newList")
    .getByRole("link", { name: /Pac-Man/ })
    .click();
  await toolReady(page);
  // The tool opened the template, without its start panel, and the address is clean again.
  await expect(page.locator("#projectName")).toHaveValue("pacman");
  await expect(page).toHaveURL(/\/levels\/$/);
  await expect(page.locator("project-browser dialog")).toBeHidden();
  await page.keyboard.press("Control+s");
  await expect(page.locator("#statFile")).toContainText("browser");

  await page.goto("./pixel/?new=16");
  await toolReady(page);
  await expect(page.locator("#documentSizeSelect")).toHaveValue("16x16");
  await page.locator("#spriteName").fill("hero");
  await page.locator("#spriteName").press("Enter");
  await page.keyboard.press("Control+s");
  await expect(page.locator("#fileDisplay")).toContainText("browser");

  // Unsaved work in Packer.
  await page.goto("./packer/");
  await toolReady(page);
  await page.locator("#projectName").fill("unsaved pack");
  await page.locator("#projectName").press("Enter");
  await expect
    .poll(() =>
      page.evaluate(
        async () => (await (window as unknown as Window2).foundry.session.loadRecovery()) !== null
      )
    )
    .toBe(true);

  await page.goto("./");
  await hubReady(page);
  await expect(page.locator("#continueList")).toContainText("unsaved pack");
  const cards = page.locator("#libraryList .card");
  await expect(cards).toHaveCount(2);
  await page.locator("#libraryFilters").getByRole("button", { name: "Pixel" }).click();
  await expect(cards).toHaveText([/hero/]);
  await page.locator("#libraryFilters").getByRole("button", { name: "All" }).click();
  const search = page.getByRole("searchbox", { name: "Search saved projects" });
  await search.fill("pac");
  await expect(cards).toHaveText([/pacman/]);
  await search.fill("");

  // A saved project opens in its tool, straight from the hub.
  await cards.filter({ hasText: "hero" }).click();
  await toolReady(page);
  await expect(page.locator("#spriteName")).toHaveValue("hero");
  await expect(page.locator("#fileDisplay")).toContainText("browser");
  await expect(page.locator("project-browser dialog")).toBeHidden();

  // Continue goes back to the unsaved pack.
  await page.goto("./");
  await hubReady(page);
  await page.locator("#continueList .card").click();
  await toolReady(page);
  await expect(page.locator("#projectName")).toHaveValue("unsaved pack");

  // Deleting from the hub asks first (accepted here).
  await page.goto("./");
  await hubReady(page);
  await page.locator(".card-wrap", { hasText: "hero" }).hover();
  await page.getByRole("button", { name: 'Delete "hero" from this browser' }).click();
  await expect(cards).toHaveText([/pacman/]);
});

test("recent files open in their tool from the hub", async ({ page }) => {
  // The browser's private file system stands in for the save picker.
  await page.addInitScript(() => {
    Object.assign(window, {
      showSaveFilePicker: async () =>
        (await navigator.storage.getDirectory()).getFileHandle("maze.gs2dlevel", { create: true }),
    });
  });
  await page.goto("./levels/");
  await toolReady(page);
  await page.keyboard.press("Control+Shift+s");
  await expect(page.locator("#statFile")).toContainText("maze.gs2dlevel");

  await page.goto("./");
  await hubReady(page);
  await page.locator("#recentList .recent-open", { hasText: "maze.gs2dlevel" }).click();
  await toolReady(page);
  await expect(page.locator("#statFile")).toContainText("maze.gs2dlevel");
  await expect(page).toHaveURL(/\/levels\/$/);
});

test("the tools share one browser storage", async ({ page }) => {
  await page.goto("./pixel/");
  await toolReady(page);
  await page.locator("#spriteName").fill("shared hero");
  await page.keyboard.press("Control+s");
  await expect(page.locator("#fileDisplay")).toContainText("browser");

  await page.goto("./levels/");
  await toolReady(page);
  const library = await page.evaluate(async () =>
    (await (window as unknown as Window2).foundry.session.storage.projects.list()).map(
      (p) => `${p.app}: ${p.name}`
    )
  );
  expect(library).toContain("pixel: shared hero");
});

test("the hub has its own first-run tour", async ({ page: shared }) => {
  // A page of its own: the usual setup marks the tours as seen.
  const page = await shared.context().newPage();
  await page.goto("./");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  const card = page.locator("guided-tour").getByRole("dialog");
  await expect(card).toBeVisible();
  await expect(card).toContainText("Welcome to Game Studio 2D");
  await page.keyboard.press("Escape");
  await expect(card).toBeHidden();
  await page.reload();
  await hubReady(page);
  await page.waitForTimeout(300);
  await expect(card).toBeHidden();
});

test("storage: unused images and the copy from before Game Studio 2D can be removed", async ({
  page,
}) => {
  page.on("dialog", (dialog) => void dialog.accept());
  // An old database, as the tools wrote it before the rename.
  await page.goto("./docs/");
  await page.evaluate(async () => {
    const request = indexedDB.open("foundry2d", 2);
    request.onupgradeneeded = () => request.result.createObjectStore("projects", { keyPath: "id" });
    await new Promise((resolve) => (request.onsuccess = resolve));
    request.result.close();
  });
  await page.goto("./");
  await hubReady(page);
  await expect(page.locator("#storageUsage")).toContainText("used");
  const legacy = page.getByRole("button", { name: "Remove the copy from before Game Studio 2D" });
  await legacy.click();
  await expect(page.locator("#storageMessage")).toHaveText("The old copy is removed.");
  await expect(legacy).toBeHidden();
  await page.getByRole("button", { name: "Remove unused images" }).click();
  await expect(page.locator("#storageMessage")).toHaveText("Every stored image is in use.");
});
