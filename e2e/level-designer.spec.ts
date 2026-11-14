import { Buffer } from "node:buffer";
import { expect, test, type Page } from "@playwright/test";
import { drag, openApp, reloadAfterRecovery, toScreen, type FoundryApp } from "./helpers";

const CANVAS = "#levelCanvas";

interface LevelApp extends FoundryApp {
  view: "world" | "level";
  project: { gridSize: number; name: string };
  level: {
    doc: { getLayer(id: string): { get(x: number, y: number): number } | undefined };
    entities: { iid: string; x: number; y: number }[];
  };
}

const app = (page: Page) => page.evaluate(() => (window.foundry as LevelApp).project.name);

/** Value of a cell on a layer (`def_<uid>`) of the open level. */
const cell = (page: Page, layerId: string, x: number, y: number) =>
  page.evaluate(
    ({ layerId, x, y }) =>
      (window.foundry as LevelApp).level.doc.getLayer(layerId)?.get(x, y) ?? -1,
    { layerId, x, y }
  );

const entity = (page: Page, iid: string) =>
  page.evaluate(
    (iid) => (window.foundry as LevelApp).level.entities.find((e) => e.iid === iid) ?? null,
    iid
  );

/** Screen position of the centre of cell (x, y) in the open level. */
const atCell = async (page: Page, x: number, y: number) => {
  const grid = await page.evaluate(() => (window.foundry as LevelApp).project.gridSize);
  return toScreen(page, CANVAS, { x: (x + 0.5) * grid, y: (y + 0.5) * grid });
};

const selectLayer = (page: Page, name: string) =>
  page.locator("#layersPanel .row").filter({ hasText: name }).locator(".name").click();

test("starts with a blank project", async ({ page }) => {
  await openApp(page);
  await expect.poll(() => app(page)).toBe("untitled");
  await expect(page.locator("#layersPanel .row .name")).toHaveText(["intgrid"]);
});

/** Opens a preset from the start screen, like a user picking New → template. */
async function openPreset(page: Page, label: RegExp, name: string): Promise<void> {
  await page.locator('[data-command="open"]').click();
  await page.locator("project-browser").getByRole("button", { name: label }).click();
  await expect.poll(() => app(page)).toBe(name);
}

test.describe("with the Pac-Man preset", () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page);
    await openPreset(page, /Pac-Man/, "pacman");
  });

  test("paints a wall on the Pac-Man maze and undoes it", async ({ page }) => {
    // The collision layer (def_1) is active and "wall" (1) is the first value.
    const p = await atCell(page, 3, 4);
    await page.mouse.click(p.x, p.y);
    await expect.poll(() => cell(page, "def_1", 3, 4)).toBe(1);
    await page.keyboard.press("Control+z");
    await expect.poll(() => cell(page, "def_1", 3, 4)).toBe(0);
  });

  test("drags an entity by whole cells and undoes the move", async ({ page }) => {
    await selectLayer(page, "entities");
    const pacman = await entity(page, "pacman-spawn");
    expect(pacman).toMatchObject({ x: 112, y: 212 });

    const from = await toScreen(page, CANVAS, { x: 112, y: 212 });
    const to = await toScreen(page, CANVAS, { x: 112 + 16, y: 212 });
    await drag(page, from, to);
    await expect.poll(async () => (await entity(page, "pacman-spawn"))?.x).toBe(128);
    await expect(page.locator("#entityInspector")).toContainText("PacMan");

    await page.keyboard.press("Control+z");
    await expect.poll(async () => (await entity(page, "pacman-spawn"))?.x).toBe(112);
  });

  test("keeps entity edits across a reload", async ({ page }) => {
    await selectLayer(page, "entities");
    const from = await toScreen(page, CANVAS, { x: 112, y: 212 });
    await drag(page, from, await toScreen(page, CANVAS, { x: 112, y: 212 - 24 }));
    await expect.poll(async () => (await entity(page, "pacman-spawn"))?.y).toBe(188);

    await reloadAfterRecovery(page);
    await expect(page.locator("#statMessage")).toContainText("Restored");
    expect((await entity(page, "pacman-spawn"))?.y).toBe(188);
  });

  test("auto-layer tiles follow painted terrain in the platformer preset", async ({ page }) => {
    await page.locator('[data-command="open"]').click();
    await page
      .locator("project-browser")
      .getByRole("button", { name: /Platformer/ })
      .click();
    await expect.poll(() => app(page)).toBe("platformer");

    // terrain (def_1) is active; the sky at (20, 5) is empty in both layers.
    expect(await cell(page, "def_2", 20, 5)).toBe(0);
    const p = await atCell(page, 20, 5);
    await page.mouse.click(p.x, p.y);
    await expect.poll(() => cell(page, "def_1", 20, 5)).toBe(1);
    await expect.poll(() => cell(page, "def_2", 20, 5)).not.toBe(0);

    // The generated layer is locked and says so.
    const lock = page
      .locator("#layersPanel .row")
      .filter({ hasText: "terrain_tiles" })
      .locator(".lock");
    await expect(lock).toBeDisabled();

    await page.keyboard.press("Control+z");
    await expect.poll(() => cell(page, "def_2", 20, 5)).toBe(0);
  });

  test("switches between the world and a level", async ({ page }) => {
    await page.locator('[data-view="world"]').click();
    await expect(page.locator("body")).toHaveAttribute("data-view", "world");
    await page.keyboard.press("Enter");
    await expect(page.locator("body")).toHaveAttribute("data-view", "level");
  });

  test("project settings open on tabs that switch with the arrow keys", async ({ page }) => {
    await page.locator('[data-command="settings"]').first().click();
    const dialog = page.locator("#settingsDialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('[data-panel="tilesets"]')).toBeHidden();

    await dialog.getByRole("tab", { name: "Entities" }).click();
    await expect(dialog.locator("#entityDefsList")).toContainText("Ghost");
    await page.keyboard.press("ArrowRight");
    await expect(dialog.getByRole("tab", { name: "Enums" })).toHaveAttribute(
      "aria-selected",
      "true"
    );
    await expect(dialog.locator("#enumsList")).toContainText("ghost");
  });

  test("adds and deletes layers from the layers panel", async ({ page }) => {
    const panel = page.locator("#layersPanel");
    await panel.getByRole("button", { name: "Add layer" }).click();
    await page
      .locator("#addLayerMenu")
      .getByRole("menuitem", { name: /Entities/ })
      .click();
    await expect(panel.locator(".row")).toHaveCount(4);
    // Added above the active layer (collision, at the bottom) and made active.
    await expect(panel.locator('.row[aria-selected="true"] .name')).toHaveText("entities_2");

    // Delete asks for confirmation (accepted by openApp's dialog handler).
    await panel.getByRole("button", { name: "Delete layer" }).click();
    await expect(panel.locator(".row")).toHaveCount(3);
    await expect(panel.locator(".row .name")).toHaveText(["entities", "collectibles", "collision"]);

    // Layer edits are undo steps now: deleting the collision layer is undone with Ctrl+Z.
    await panel.locator(".row").filter({ hasText: "collision" }).locator(".name").click();
    await panel.getByRole("button", { name: "Delete layer" }).click();
    await expect(panel.locator(".row")).toHaveCount(2);
    await page.keyboard.press("Control+z");
    await expect(panel.locator(".row .name")).toHaveText(["entities", "collectibles", "collision"]);
  });

  test("reopens with the same view, tool and zoom (work file editor state)", async ({ page }) => {
    await page.keyboard.press("r"); // rectangle tool
    await page.keyboard.press("+");
    const zoom = await page.evaluate(() => window.foundry!.workspace.zoom);
    const p = await atCell(page, 2, 2);
    await drag(page, p, await atCell(page, 3, 3)); // an edit, so unsaved work is snapshotted
    await expect.poll(() => cell(page, "def_1", 3, 3)).toBe(1);

    await reloadAfterRecovery(page);
    await expect(page.locator("#statMessage")).toContainText("Restored");
    await expect(page.locator('[data-tool="rect"]')).toHaveClass(/active/);
    await expect
      .poll(() => page.evaluate(() => window.foundry!.workspace.zoom))
      .toBeCloseTo(zoom, 5);
  });

  test("the export split button runs JSON by default and remembers CSV", async ({ page }) => {
    const exportButton = page.locator("#exportButton");
    const json = page.waitForEvent("download");
    await exportButton.getByRole("button", { name: "Export (JSON)" }).click();
    expect((await json).suggestedFilename()).toBe("pacman.json");

    // The menu floats over the page: the scrolling toolbar must not grow.
    const toolbar = page.locator(".toolbar");
    const heightBefore = await toolbar.evaluate((el) => el.scrollHeight);
    await exportButton.getByRole("button", { name: "More options" }).click();
    expect(await toolbar.evaluate((el) => el.scrollHeight)).toBe(heightBefore);
    const csv = page.waitForEvent("download");
    await exportButton.getByRole("menuitemradio", { name: /Export \(CSV\)/ }).click();
    expect((await csv).suggestedFilename()).toBe("pacman-csv.zip");
    await expect(exportButton.getByRole("button", { name: "Export (CSV)" })).toBeVisible();

    // The choice survives a reload (kept per browser).
    await page.reload();
    await expect(
      page.locator("#exportButton").getByRole("button", { name: "Export (CSV)" })
    ).toBeVisible();
  });

  test("duplicates a layer from the layers panel", async ({ page }) => {
    const panel = page.locator("#layersPanel");
    await panel.getByRole("button", { name: "Duplicate layer" }).click();
    await expect(panel.locator(".row .name")).toHaveText([
      "entities",
      "collectibles",
      "collision_copy",
      "collision",
    ]);
    await expect(panel.locator('.row[aria-selected="true"] .name')).toHaveText("collision_copy");
  });

  // 1×1 transparent PNG.
  const TINY_PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
    "base64"
  );

  test("re-imports a tileset image and keeps the placed tiles", async ({ page }) => {
    await page.locator('[data-command="open"]').click();
    await page
      .locator("project-browser")
      .getByRole("button", { name: /Platformer/ })
      .click();
    await expect.poll(() => app(page)).toBe("platformer");
    const tilesBefore = await cell(page, "def_2", 0, 18);
    expect(tilesBefore).not.toBe(0);

    await page.locator('[data-command="settings"]').first().click();
    const dialog = page.locator("#settingsDialog");
    await dialog.getByRole("tab", { name: "Tilesets" }).click();
    const chooser = page.waitForEvent("filechooser");
    await dialog.getByRole("button", { name: "Re-import…" }).click();
    await (
      await chooser
    ).setFiles({ name: "sheet-v2.png", mimeType: "image/png", buffer: TINY_PNG });

    await expect(page.locator("#statMessage")).toContainText("Re-imported");
    await expect(dialog).toContainText("sheet-v2.png");
    expect(await cell(page, "def_2", 0, 18)).toBe(tilesBefore);
  });

  /** Width and height from a PNG file's IHDR chunk. */
  const pngSize = (bytes: Buffer) => ({
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
  });

  test("exports a level and a single layer as PNG at native size", async ({ page }) => {
    await page.locator('[data-command="open"]').click();
    await page
      .locator("project-browser")
      .getByRole("button", { name: /Platformer/ })
      .click();
    await expect.poll(() => app(page)).toBe("platformer");

    const exportButton = page.locator("#exportButton");
    const pick = async (name: RegExp) => {
      await exportButton.getByRole("button", { name: "More options" }).click();
      const download = page.waitForEvent("download");
      await exportButton.getByRole("menuitemradio", { name }).click();
      const file = await download;
      const path = await file.path();
      const { readFile } = await import("node:fs/promises");
      return { name: file.suggestedFilename(), bytes: await readFile(path) };
    };

    const level = await pick(/^Export \(PNG\)/);
    expect(level.name).toBe("platformer.png");
    expect(pngSize(level.bytes)).toEqual({ width: 640, height: 352 });

    const layer = await pick(/Export layer \(PNG\)/);
    expect(layer.name).toBe("platformer-terrain.png");
    expect(pngSize(layer.bytes)).toEqual({ width: 640, height: 352 });
  });
});
