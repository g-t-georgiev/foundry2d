import { Buffer } from "node:buffer";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { expect, test, type Download, type Page } from "@playwright/test";
import { openApp, reloadAfterRecovery, toScreen, type FoundryApp } from "./helpers";

interface PackerApp extends FoundryApp {
  packing: boolean;
  project: {
    sprites: { name: string }[];
    settings: { algorithm: string; allowRotation: boolean };
  };
  atlas: {
    aliased: number;
    sheets: {
      image: { width: number; height: number };
      frames: { filename: string; frame: { x: number; y: number; w: number; h: number } }[];
    }[];
  } | null;
}

/** A PNG of one colour, made in the page. */
async function png(page: Page, width: number, height: number, color: string): Promise<Buffer> {
  const base64 = await page.evaluate(
    ({ width, height, color }) => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, width, height);
      return canvas.toDataURL("image/png").split(",")[1];
    },
    { width, height, color }
  );
  return Buffer.from(base64, "base64");
}

/** Waits until the sheets show the latest edit. */
const packed = (page: Page) =>
  expect.poll(() => page.evaluate(() => (window.foundry as PackerApp).packing)).toBe(false);

const names = (page: Page) =>
  page.evaluate(() => (window.foundry as PackerApp).project.sprites.map((s) => s.name));

const sheets = (page: Page) =>
  page.evaluate(
    () =>
      (window.foundry as PackerApp).atlas?.sheets.map((s) => [s.image.width, s.image.height]) ?? []
  );

/** Adds sprites (name → [width, height, colour]) through the + Images button. */
async function addSprites(page: Page, sprites: Record<string, [number, number, string]>) {
  const files = [];
  for (const [name, [w, h, color]] of Object.entries(sprites)) {
    files.push({ name, mimeType: "image/png", buffer: await png(page, w, h, color) });
  }
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "+ Images" }).click();
  await (await chooser).setFiles(files);
  await expect.poll(async () => (await names(page)).length).toBeGreaterThan(0);
  await packed(page);
}

const BASIC: Record<string, [number, number, string]> = {
  "walk_10.png": [20, 30, "#f00"],
  "walk_2.png": [30, 20, "#0f0"],
  "coin_a.png": [16, 16, "#ff0"],
  "coin_b.png": [16, 16, "#ff0"],
};

const setting = (page: Page, key: string) => page.locator(`[data-setting="${key}"]`);

test.beforeEach(async ({ page }) => {
  await openApp(page);
});

test("adds images, shares identical ones, and undoes", async ({ page }) => {
  await expect(page.locator("#emptyHint")).toBeVisible();
  await expect(page.locator("#exportButton")).toHaveAttribute("disabled", "");
  await addSprites(page, BASIC);
  expect(await names(page)).toEqual(["coin_a", "coin_b", "walk_2", "walk_10"]);
  await expect(page.locator("#spriteList .sprite-name")).toHaveText([
    "coin_a",
    "coin_b",
    "walk_2",
    "walk_10",
  ]);
  await expect(page.locator("#statShared")).toHaveText("1");
  await expect(page.locator("#emptyHint")).toBeHidden();

  await page.keyboard.press("Control+z");
  await expect(page.locator("#spriteCount")).toHaveText("0");
  await packed(page);
  expect(await sheets(page)).toEqual([]);
  await page.keyboard.press("Control+y");
  await expect(page.locator("#spriteCount")).toHaveText("4");
});

test("re-adding a file updates its sprite; unreadable files are reported", async ({ page }) => {
  await addSprites(page, { "a.png": [8, 8, "#f00"] });
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "+ Images" }).click();
  await (
    await chooser
  ).setFiles([
    { name: "a.png", mimeType: "image/png", buffer: await png(page, 12, 8, "#00f") },
    { name: "bad.png", mimeType: "image/png", buffer: Buffer.from("not an image") },
  ]);
  await expect(page.locator("#statMessage")).toContainText("updated 1, could not read bad.png");
  expect(await names(page)).toEqual(["a"]);
  await packed(page);
  expect(await sheets(page)).toEqual([[12, 8]]);
});

test("a folder's sprites keep their path", async ({ page }, info) => {
  const dir = info.outputPath("hero");
  await mkdir(`${dir}/run`, { recursive: true });
  await writeFile(`${dir}/idle.png`, await png(page, 8, 8, "#f00"));
  await writeFile(`${dir}/run/0.png`, await png(page, 8, 8, "#0f0"));
  await writeFile(`${dir}/readme.txt`, "ignored");
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "+ Folder" }).click();
  await (await chooser).setFiles(dir);
  await expect.poll(() => names(page)).toEqual(["hero/idle", "hero/run/0"]);
});

test("images dropped on the page are added", async ({ page }) => {
  const bytes = [...(await png(page, 8, 8, "#f00"))];
  const data = await page.evaluateHandle((bytes) => {
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array(bytes)], "dropped.png", { type: "image/png" }));
    return transfer;
  }, bytes);
  await page.dispatchEvent("#viewport", "drop", { dataTransfer: data });
  await expect.poll(() => names(page)).toEqual(["dropped"]);
});

test("settings repack, limits split sheets, and problems are shown", async ({ page }) => {
  await addSprites(page, {
    "a.png": [30, 30, "#f00"],
    "b.png": [30, 30, "#0f0"],
    "c.png": [30, 30, "#00f"],
  });
  await setting(page, "padding").fill("0");
  await setting(page, "padding").press("Enter");
  await setting(page, "algorithm").selectOption("horizontal");
  await packed(page);
  expect(await sheets(page)).toEqual([[90, 30]]);

  await setting(page, "maxWidth").fill("64");
  await setting(page, "maxWidth").press("Enter");
  await packed(page);
  expect(await sheets(page)).toEqual([
    [60, 30],
    [30, 30],
  ]);

  await setting(page, "maxWidth").fill("20");
  await setting(page, "maxWidth").press("Enter");
  await expect(page.locator("#packError")).toContainText("bigger than the maximum");
  await expect(page.locator("#exportButton")).toHaveAttribute("disabled", "");

  // An emptied number keeps its value.
  await setting(page, "maxWidth").fill("");
  await setting(page, "maxWidth").press("Enter");
  await expect(setting(page, "maxWidth")).toHaveValue("20");

  // Rotation is off where the layout or the format can't do it, and comes back.
  await expect(setting(page, "allowRotation")).toBeDisabled();
  await setting(page, "algorithm").selectOption("maxrects");
  await setting(page, "allowRotation").check();
  await setting(page, "dataFormat").selectOption("godot-tres");
  await expect(setting(page, "allowRotation")).toBeDisabled();
  await expect(page.locator("#rotationHint")).toContainText("rotation");
  await setting(page, "dataFormat").selectOption("json-array");
  await expect(setting(page, "allowRotation")).toBeChecked();
});

test("selects on the sheet, searches, renames and removes", async ({ page }) => {
  await addSprites(page, BASIC);
  const frame = await page.evaluate(
    () =>
      (window.foundry as PackerApp).atlas!.sheets[0].frames.find(
        (f) => f.filename === "walk_2.png"
      )!.frame
  );
  const at = await toScreen(page, "#sheetCanvas", { x: frame.x + 5, y: frame.y + 5 });
  await page.mouse.click(at.x, at.y);
  const selected = page.locator('#spriteList [aria-selected="true"] .sprite-name');
  await expect(selected).toHaveText(["walk_2"]);
  await expect(page.locator("#statSprite")).toHaveText("walk_2");

  // Sprites stored once are picked together.
  const coin = await page.evaluate(
    () =>
      (window.foundry as PackerApp).atlas!.sheets[0].frames.find(
        (f) => f.filename === "coin_a.png"
      )!.frame
  );
  const coinAt = await toScreen(page, "#sheetCanvas", { x: coin.x + 5, y: coin.y + 5 });
  await page.mouse.click(coinAt.x, coinAt.y);
  await expect(selected).toHaveText(["coin_a", "coin_b"]);

  await page.locator("#spriteSearch").fill("WALK");
  await expect(page.locator("#spriteList .sprite-name")).toHaveText(["walk_2", "walk_10"]);
  await page.locator("#spriteSearch").fill("");

  await page.locator("#spriteList .sprite-item", { hasText: "coin_b" }).click();
  await page.keyboard.press("F2");
  await page.keyboard.type("coin_a");
  await page.keyboard.press("Enter");
  await expect(page.locator("#statMessage")).toContainText("already a sprite");
  expect(await names(page)).toContain("coin_b");
  await page.keyboard.press("F2");
  await page.keyboard.type("gem");
  await page.keyboard.press("Enter");
  expect(await names(page)).toEqual(["coin_a", "gem", "walk_2", "walk_10"]);

  await page.locator("#spriteList .sprite-item", { hasText: "coin_a" }).click();
  await page
    .locator("#spriteList .sprite-item", { hasText: "walk_2" })
    .click({ modifiers: ["Shift"] });
  await page.keyboard.press("Delete");
  expect(await names(page)).toEqual(["walk_10"]);
});

test("exports a ZIP, and separate files in the chosen format", async ({ page }) => {
  await addSprites(page, BASIC);
  const exportButton = page.locator("#exportButton");
  const zip = page.waitForEvent("download");
  await exportButton.getByRole("button", { name: "Export (ZIP)" }).click();
  const download = await zip;
  expect(download.suggestedFilename()).toBe("untitled.zip");
  const bytes = await readFile(await download.path());
  expect(bytes.subarray(0, 2).toString("latin1")).toBe("PK");
  expect(bytes.includes("untitled.png")).toBe(true);
  expect(bytes.includes("untitled.json")).toBe(true);

  await setting(page, "dataFormat").selectOption("godot-tres");
  await packed(page);
  const downloads: Download[] = [];
  page.on("download", (d) => downloads.push(d));
  await exportButton.getByRole("button", { name: "More options" }).click();
  await exportButton.getByRole("menuitemradio", { name: /separate files/ }).click();
  await expect
    .poll(() => downloads.map((d) => d.suggestedFilename()).sort())
    .toEqual(["untitled.png", "untitled.tres"]);
  const tres = downloads.find((d) => d.suggestedFilename().endsWith(".tres"))!;
  const text = await readFile(await tres.path(), "utf8");
  expect(text).toContain('path="res://untitled.png"');
  const image = downloads.find((d) => d.suggestedFilename().endsWith(".png"))!;
  const pngBytes = await readFile(await image.path());
  const [size] = await sheets(page);
  expect([pngBytes.readUInt32BE(16), pngBytes.readUInt32BE(20)]).toEqual(size);
});

test("unsaved work survives a reload, and saved packs reopen from the start screen", async ({
  page,
}) => {
  await addSprites(page, BASIC);
  await setting(page, "algorithm").selectOption("grid");
  await reloadAfterRecovery(page);
  await expect(page.locator("#statMessage")).toContainText("Restored");
  await expect(setting(page, "algorithm")).toHaveValue("grid");
  await packed(page);
  expect((await sheets(page)).length).toBe(1);

  // Ctrl+Z right after picking from a dropdown undoes it.
  await setting(page, "algorithm").selectOption("shelf");
  await setting(page, "algorithm").focus();
  await page.keyboard.press("Control+z");
  await expect(setting(page, "algorithm")).toHaveValue("grid");

  // Ctrl+S while typing commits the field and saves.
  await page.locator("#projectName").fill("heroes");
  await page.keyboard.press("Control+s");
  await expect(page.locator("#statFile")).toHaveText("browser library");
  await page.locator('[data-command="open"]').click();
  await page
    .locator("project-browser")
    .getByRole("button", { name: /Godot 4/ })
    .click();
  await expect(page.locator("#spriteCount")).toHaveText("0");
  await expect(setting(page, "dataFormat")).toHaveValue("godot-tres");

  await page.locator('[data-command="open"]').click();
  await page
    .locator("project-browser")
    .getByRole("button", { name: /heroes/ })
    .first()
    .click();
  await expect(page.locator("#spriteCount")).toHaveText("4");
  await expect(page.locator("#projectName")).toHaveValue("heroes");
});
