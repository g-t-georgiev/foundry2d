import { expect, type Page } from "@playwright/test";

/**
 * Both apps expose their composition root as `window.foundry` for debugging.
 * Tests read state through it but drive the UI with real mouse and keyboard
 * events, so pointer capture, hit-testing and key bindings are exercised.
 */
type Point = { x: number; y: number };

interface Camera {
  worldToLocal(x: number, y: number): Point;
}

interface Session {
  state: { dirty: boolean; fileName: string | null; libraryId: string | null };
  loadRecovery(): Promise<unknown>;
}

/** The members the tests read; see each app's `Application`. */
export interface FoundryApp {
  workspace: { camera: Camera; zoom: number };
  session: Session;
  history: { canUndo: boolean };
}

declare global {
  interface Window {
    foundry?: FoundryApp;
  }
}

/** Waits until the app has booted, started its session and drawn once. */
export async function openApp(
  page: Page,
  path = "./",
  options: { tour?: boolean } = {}
): Promise<void> {
  // Confirmations are accepted: tests reload and delete on purpose.
  // Prompts are accepted with their suggested value.
  page.on("dialog", (dialog) => void dialog.accept(dialog.defaultValue()));
  // The first-run tour would cover the app; it has tests of its own.
  if (!options.tour) {
    await page.addInitScript(() => {
      for (const app of ["pixel", "levels", "packer"]) {
        localStorage.setItem(`gs2d.tours.${app}`, JSON.stringify(["intro"]));
      }
    });
  }
  await page.goto(path);
  await page.waitForFunction(() => window.foundry !== undefined);
}

/** Screen position of a world point (sprite pixels, or level pixels) on the canvas. */
export async function toScreen(page: Page, canvas: string, world: Point): Promise<Point> {
  const local = await page.evaluate(
    ({ x, y }) => window.foundry!.workspace.camera.worldToLocal(x, y),
    world
  );
  const box = await page.locator(canvas).boundingBox();
  if (!box) throw new Error(`Canvas ${canvas} is not visible`);
  return { x: box.x + local.x, y: box.y + local.y };
}

/** Presses at `from` and releases at `to`, moving in steps like a real drag. */
export async function drag(page: Page, from: Point, to: Point, steps = 8): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps });
  await page.mouse.up();
}

/** Waits for the debounced crash-recovery snapshot, then reloads the page. */
export async function reloadAfterRecovery(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(async () => (await window.foundry!.session.loadRecovery()) !== null))
    .toBe(true);
  await page.reload();
  await page.waitForFunction(() => window.foundry !== undefined);
}

/**
 * Saves the open work in the browser, then starts the app with a copy of it
 * as a file double-clicked in the OS: first at startup, then while the start
 * screen is open. Either way the file is what the user sees.
 */
export async function expectLaunchedFileOpens(page: Page, name: string): Promise<void> {
  const state = () => page.evaluate(() => window.foundry!.session.state);
  const dialog = page.locator("project-browser dialog");
  await page.keyboard.press("Control+s");
  await expect.poll(async () => (await state()).libraryId).not.toBeNull();
  const content = await page.evaluate(() =>
    JSON.stringify(
      (
        window.foundry!.session as unknown as { options: { serialize(): unknown } }
      ).options.serialize()
    )
  );
  // Stands in for the launch queue of an installed app.
  await page.addInitScript(
    ({ name, content }) => {
      const file = new File([content], name);
      const handle = { kind: "file", name, getFile: () => Promise.resolve(file) };
      const setConsumer = (consumer: (params: { files: unknown[] }) => void) => {
        const launch = () => consumer({ files: [handle] });
        Object.assign(window, { launchNow: launch });
        if (location.search === "?launched") launch();
      };
      Object.defineProperty(window, "launchQueue", { value: { setConsumer } });
    },
    { name, content }
  );

  await page.goto("./?launched");
  await expect.poll(async () => (await state()).fileName).toBe(name);
  await expect(dialog).toBeHidden();

  await page.goto("./");
  await expect(dialog).toBeVisible();
  await page.evaluate(() => (window as unknown as { launchNow(): void }).launchNow());
  await expect.poll(async () => (await state()).fileName).toBe(name);
  await expect(dialog).toBeHidden();
}

/**
 * Saves the open work as a file, reloads, opens that file again and saves:
 * the file's copy in the browser is updated, not added again.
 */
export async function expectOneCopyPerFile(page: Page): Promise<void> {
  const state = () => page.evaluate(() => window.foundry!.session.state);
  const library = () =>
    page.evaluate(async () => {
      const session = window.foundry!.session as unknown as {
        listLibrary(): Promise<{ id: string; updatedAt: number }[]>;
      };
      return session.listLibrary();
    });
  // The browser's private file system stands in for the pickers.
  const stubPickers = () => {
    const pick = async () => {
      const root = await navigator.storage.getDirectory();
      return root.getFileHandle("work.json", { create: true });
    };
    Object.assign(window, {
      showSaveFilePicker: pick,
      showOpenFilePicker: async () => [await pick()],
    });
  };
  await page.addInitScript(stubPickers);
  await page.evaluate(stubPickers);
  await page.keyboard.press("Control+Shift+s");
  await expect.poll(async () => (await state()).fileName).toBe("work.json");
  const [before] = await library();

  await page.reload();
  await page.waitForFunction(() => window.foundry !== undefined);
  const browser = page.locator("project-browser");
  await expect(browser.locator("dialog")).toBeVisible();
  await browser.getByRole("button", { name: "Open file" }).click();
  await expect.poll(async () => (await state()).libraryId).toBe(before.id);
  await page.keyboard.press("Control+s");
  await expect.poll(async () => (await library())[0].updatedAt).toBeGreaterThan(before.updatedAt);
  expect(await library()).toHaveLength(1);
}

/**
 * The first-run tour: it starts by itself in a fresh browser, steps through
 * with the keyboard and buttons, isn't shown again once done, and comes back
 * from the Help menu, which also links to the manual.
 */
export async function expectFirstRunTour(shared: Page): Promise<void> {
  // A page of its own: the usual setup marks the tour as seen on every load.
  const page = await shared.context().newPage();
  await openApp(page, "./", { tour: true });
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForFunction(() => window.foundry !== undefined);
  const card = page.locator("guided-tour").getByRole("dialog");
  await expect(card).toBeVisible();
  const count = card.locator("#count");
  await expect(count).toHaveText(/^1 of \d+$/);
  const total = Number((await count.textContent())!.split(" of ")[1]);
  // App shortcuts wait while the tour runs: Ctrl+O would open the start screen.
  await page.keyboard.press("Control+o");
  await expect(page.locator("project-browser dialog")).toBeHidden();

  await page.keyboard.press("ArrowRight");
  await expect(count).toHaveText(`2 of ${total}`);
  await card.getByRole("button", { name: "Back" }).click();
  await expect(count).toHaveText(`1 of ${total}`);
  for (let i = 1; i < total; i++) await card.getByRole("button", { name: "Next" }).click();
  await expect(count).toHaveText(`${total} of ${total}`);
  // Every step's card stays inside the window.
  const box = (await card.boundingBox())!;
  const view = page.viewportSize()!;
  expect(box.x >= 0 && box.y >= 0 && box.x + box.width <= view.width).toBe(true);
  expect(box.y + box.height).toBeLessThanOrEqual(view.height);
  await card.getByRole("button", { name: "Done" }).click();
  await expect(card).toBeHidden();

  await page.reload();
  await page.waitForFunction(() => window.foundry !== undefined);
  await page.waitForTimeout(500);
  await expect(card).toBeHidden();

  const help = page.locator("help-button");
  await help.getByRole("button", { name: "Help" }).click();
  await expect(help.getByRole("menuitem", { name: /Manual/ })).toHaveAttribute(
    "href",
    /\/docs\/#[a-z-]+\/tour$/
  );
  await expect(help.getByRole("menuitem", { name: /Keyboard shortcuts/ })).toHaveAttribute(
    "href",
    /#[a-z-]+\/shortcuts$/
  );
  await help.getByRole("menuitem", { name: "Take the tour" }).click();
  await expect(count).toHaveText(`1 of ${total}`);
  await page.keyboard.press("Escape");
  await expect(card).toBeHidden();
}
