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
  await expect(page.locator("#statMessage")).toHaveText("Updated 1, could not read bad.png");
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

/** Adds files through the + Images button. */
async function addFiles(page: Page, files: { name: string; buffer: Buffer }[]): Promise<void> {
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "+ Images" }).click();
  await (
    await chooser
  ).setFiles(files.map((f) => ({ ...f, mimeType: "application/octet-stream" })));
}

/** Runs an export (the ZIP by default) and returns the downloaded bytes by file name. */
async function exportFiles(page: Page, count: number): Promise<Map<string, Buffer>> {
  await packed(page);
  const downloads: Download[] = [];
  const listener = (d: Download) => downloads.push(d);
  page.on("download", listener);
  const button = page.locator("#exportButton");
  await button.getByRole("button", { name: "More options" }).click();
  await button.getByRole("menuitemradio", { name: /separate files/ }).click();
  await expect.poll(() => downloads.length).toBe(count);
  page.off("download", listener);
  const out = new Map<string, Buffer>();
  for (const d of downloads) out.set(d.suggestedFilename(), await readFile(await d.path()));
  return out;
}

/** The pixels of a sprite, as the app decoded them. */
const pixelsOf = (page: Page, name: string) =>
  page.evaluate(async (name) => {
    const app = window.foundry as unknown as {
      project: { sprites: { name: string; dataUrl: string }[] };
      images: {
        get(url: string): Promise<{ width: number; height: number; data: Uint8ClampedArray }>;
      };
    };
    const sprite = app.project.sprites.find((s) => s.name === name)!;
    const { width, height, data } = await app.images.get(sprite.dataUrl);
    return { width, height, data: [...data] };
  }, name);

test("numbered sprites play as an animation and are exported as one", async ({ page }) => {
  await addSprites(page, {
    "walk_1.png": [10, 20, "#f00"],
    "walk_2.png": [12, 20, "#0f0"],
    "idle.png": [8, 8, "#00f"],
  });
  await expect(page.locator("#previewSelect option")).toHaveText(["walk (2)"]);
  const shown = () =>
    page.locator("#previewCanvas").evaluate((canvas: HTMLCanvasElement) => {
      const { data } = canvas
        .getContext("2d")!
        .getImageData(canvas.width / 2, canvas.height / 2, 1, 1);
      return [data[0], data[1]].join();
    });
  // Both frames come by, then it stands still while paused.
  await expect.poll(shown).toBe("255,0");
  await expect.poll(shown).toBe("0,255");
  await page.getByRole("button", { name: "Pause" }).click();
  const still = await shown();
  await page.waitForTimeout(400);
  expect(await shown()).toBe(still);

  const files = await exportFiles(page, 2);
  const data = JSON.parse(files.get("untitled.json")!.toString()) as { animations: unknown };
  expect(data.animations).toEqual({ walk: ["walk_1.png", "walk_2.png"] });

  await setting(page, "animations").uncheck();
  await expect(page.locator("#animationPreview")).toBeHidden();
});

test("pivots of the selected sprites are edited, undone and exported", async ({ page }) => {
  await addSprites(page, { "a.png": [10, 20, "#f00"], "b.png": [10, 10, "#0f0"] });
  await expect(page.locator("#selection")).toBeHidden();
  await page.locator("#spriteList").focus();
  await page.keyboard.press("Control+a");
  await expect(page.locator("#selectionTitle")).toHaveText("2 sprites");
  await page.locator("#pivotPreset").selectOption("bottom");
  await page.locator("#spriteList .sprite-item", { hasText: "a" }).first().click();
  await expect(page.locator("#pivotPreset")).toHaveValue("bottom");
  await page.locator("#pivotX").fill("0.25");
  await page.locator("#pivotX").press("Enter");
  await expect(page.locator("#pivotPreset")).toHaveValue("custom");
  const files = await exportFiles(page, 2);
  const { frames } = JSON.parse(files.get("untitled.json")!.toString()) as {
    frames: Record<string, { anchor: unknown }>;
  };
  expect(frames["a.png"].anchor).toEqual({ x: 0.25, y: 1 });
  expect(frames["b.png"].anchor).toEqual({ x: 0.5, y: 1 });
  await page.keyboard.press("Control+z");
  await expect(page.locator("#pivotPreset")).toHaveValue("bottom");
  await setting(page, "dataFormat").selectOption("css");
  await expect(page.locator("#pivotHint")).toBeVisible();
});

test("scales and WebP", async ({ page }) => {
  await addSprites(page, { "a.png": [10, 20, "#f00"] });
  await setting(page, "imageFormat").selectOption("webp");
  await page.locator('[data-scale="2"]').check();
  const files = await exportFiles(page, 4);
  expect([...files.keys()].sort()).toEqual([
    "untitled.json",
    "untitled.webp",
    "untitled@2x.json",
    "untitled@2x.webp",
  ]);
  expect(files.get("untitled@2x.webp")!.subarray(8, 12).toString()).toBe("WEBP");
  // The last scale can't be unticked.
  await page.locator('[data-scale="1"]').uncheck();
  await page.locator('[data-scale="2"]').click();
  await expect(page.locator('[data-scale="2"]')).toBeChecked();
});

test("a sheet with its data is unpacked into its sprites, pixel for pixel", async ({ page }) => {
  await addSprites(page, {
    "walk_1.png": [10, 21, "#f00"],
    "walk_2.png": [12, 20, "rgba(0, 255, 0, 0.02)"],
    "wide.png": [40, 6, "#00f"],
  });
  await setting(page, "allowRotation").check();
  const before = new Map<string, unknown>();
  for (const name of await names(page)) before.set(name, await pixelsOf(page, name));
  const files = await exportFiles(page, 2);

  await page.locator('[data-command="open"]').click();
  await page
    .locator("project-browser")
    .getByRole("button", { name: /Empty pack/ })
    .click();
  await expect(page.locator("#spriteCount")).toHaveText("0");
  await addFiles(
    page,
    [...files].map(([name, buffer]) => ({ name, buffer }))
  );
  await expect.poll(() => names(page)).toEqual(["walk_1", "walk_2", "wide"]);
  for (const [name, pixels] of before) expect(await pixelsOf(page, name)).toEqual(pixels);

  // Data without its image says what is missing.
  await addFiles(page, [{ name: "lonely.json", buffer: files.get("untitled.json")! }]);
  await expect(page.locator("#statMessage")).toContainText(
    "lonely.json (add untitled.png with it)"
  );
});

test("pixel-editor sprites come in frame by frame", async ({ page }) => {
  const document = (color: number) => ({
    width: 2,
    height: 1,
    activeLayerId: "l",
    layers: [
      { id: "l", name: "L", visible: true, locked: false, opacity: 1, data: [1, color, 1, 0] },
    ],
  });
  const sprite = {
    format: "foundry2d.pixel",
    version: 2,
    name: "hero",
    fps: 8,
    frames: [
      { duration: null, document: document(0xff0000ff) },
      { duration: null, document: document(0xff00ff00) },
    ],
  };
  await addFiles(page, [
    { name: "hero.f2dsprite", buffer: Buffer.from(JSON.stringify(sprite)) },
    { name: "package.json", buffer: Buffer.from("{}") },
  ]);
  await expect.poll(() => names(page)).toEqual(["hero_0", "hero_1"]);
  await expect(page.locator("#statMessage")).toHaveText("Added 2 sprites");
  expect((await pixelsOf(page, "hero_1")).data).toEqual([0, 255, 0, 255, 0, 0, 0, 0]);
});

test("a live folder adds, updates and removes sprites as files change", async ({ page }) => {
  // The browser's private file system stands in for a picked folder.
  await page.evaluate(async () => {
    const root = await navigator.storage.getDirectory();
    const dir = await root.getDirectoryHandle("art", { create: true });
    Object.assign(window, { showDirectoryPicker: () => Promise.resolve(dir) });
  });
  const write = async (name: string, data: Buffer | null) => {
    await page.evaluate(
      async ({ name, bytes }) => {
        const root = await navigator.storage.getDirectory();
        const dir = await root.getDirectoryHandle("art");
        if (bytes === null) return dir.removeEntry(name);
        const stream = await (await dir.getFileHandle(name, { create: true })).createWritable();
        await stream.write(new Uint8Array(bytes));
        await stream.close();
      },
      { name, bytes: data && [...data] }
    );
  };
  await write("a.png", await png(page, 8, 8, "#f00"));
  await write("b.png", await png(page, 8, 8, "#0f0"));
  await page.getByRole("button", { name: "Live folder" }).click();
  await expect.poll(() => names(page)).toEqual(["art/a", "art/b"]);
  await expect(page.locator("#liveFolders")).toContainText("art");

  await write("b.png", await png(page, 20, 8, "#0f0"));
  await write("c.png", await png(page, 8, 8, "#00f"));
  await write("a.png", null);
  await expect.poll(() => names(page)).toEqual(["art/b", "art/c"]);
  await expect.poll(async () => (await pixelsOf(page, "art/b")).width).toBe(20);

  // Another file type under the same name keeps the sprite.
  const webp = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 5;
    canvas.getContext("2d")!.fillRect(0, 0, 5, 5);
    return canvas.toDataURL("image/webp", 1).split(",")[1];
  });
  await write("c.webp", Buffer.from(webp, "base64"));
  await write("c.png", null);
  await expect.poll(async () => (await pixelsOf(page, "art/c")).width).toBe(5);
  expect(await names(page)).toEqual(["art/b", "art/c"]);

  await page.getByRole("button", { name: /Stop watching art/ }).click();
  await write("d.png", await png(page, 8, 8, "#fff"));
  await page.waitForTimeout(2500);
  expect(await names(page)).toEqual(["art/b", "art/c"]);
});
