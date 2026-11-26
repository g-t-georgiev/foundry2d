import { expect, test, type Download, type Page } from "@playwright/test";
import {
  expectFirstRunTour,
  expectLaunchedFileOpens,
  expectOneCopyPerFile,
  drag,
  openApp,
  reloadAfterRecovery,
  toScreen,
  type FoundryApp,
} from "./helpers";

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
  await expect(browser.getByText("untitled", { exact: true })).toBeVisible();
});

test("reopens with the same zoom, tool and toggles (work file editor state)", async ({ page }) => {
  await page.keyboard.press("#"); // grid off
  await page.locator('[data-command="zoom-in"]').click();
  const zoom = await page.evaluate(() => window.foundry!.workspace.zoom);
  const p = await at(page, 4, 4);
  await page.mouse.click(p.x, p.y); // an edit, so unsaved work is snapshotted
  await page.keyboard.press("e"); // eraser

  // Tool changes alone don't mark the sprite dirty; another edit does.
  await page.mouse.click(p.x, p.y);
  await reloadAfterRecovery(page);
  await expect(page.locator("#messageDisplay")).toContainText("Restored");
  await expect.poll(() => page.evaluate(() => window.foundry!.workspace.zoom)).toBeCloseTo(zoom, 5);
  await expect(page.locator('[data-tool="eraser"]')).toHaveClass(/active/);
  await expect(page.locator("#gridToggle")).not.toBeChecked();
});

test("saves a copy in the browser and duplicates it from the start screen", async ({ page }) => {
  const p = await at(page, 1, 1);
  await page.mouse.click(p.x, p.y);
  await page.keyboard.press("Control+s");
  await expect(page.locator("#messageDisplay")).toContainText("Saved");

  // Save as ▾ → "Save a copy in this browser…" (the name prompt is accepted as suggested).
  const saveAs = page.locator("#saveAsButton");
  await saveAs.getByRole("button", { name: "More options" }).click();
  await saveAs.getByRole("menuitemradio", { name: /Save a copy in this browser/ }).click();
  await expect(page.locator("#messageDisplay")).toContainText('Saved a copy as "untitled copy"');

  await page.locator('[data-command="open"]').click();
  const browser = page.locator("project-browser");
  await expect(browser.getByText("untitled copy", { exact: true })).toBeVisible();
  await browser.getByRole("button", { name: "Duplicate untitled copy" }).click();
  await expect(browser.getByText("untitled copy copy", { exact: true })).toBeVisible();
  await expect(browser.locator("#usage")).toContainText("used");
});

test("flips and rotates the selection, each as one undo step", async ({ page }) => {
  const p = await at(page, 2, 1);
  await page.mouse.click(p.x, p.y); // one pixel at (2, 1)
  await page.keyboard.press("m");
  await drag(page, await at(page, 0, 0), await at(page, 3, 1)); // select 4×2 at (0, 0)

  await page.keyboard.press("Shift+h"); // flip: x 2 → 1 within the 4-wide block
  await expect.poll(() => pixel(page, 1, 1)).not.toBe(0);
  expect(await pixel(page, 2, 1)).toBe(0);

  await page.keyboard.press("Shift+r"); // rotate the 4×2 block to 2×4 around its centre
  const rect = await page.evaluate(
    () => (window.foundry as unknown as { selection: { rect: unknown } }).selection.rect
  );
  expect(rect).toEqual({ x: 1, y: 0, width: 2, height: 4 });

  await page.keyboard.press("Control+z");
  await page.keyboard.press("Control+z");
  await expect.poll(() => pixel(page, 2, 1)).not.toBe(0);
  expect(await pixel(page, 1, 1)).toBe(0);
});

test.describe("system clipboard", () => {
  test.beforeEach(async ({ context }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  });

  test("Ctrl+C also puts the selection on the system clipboard as a PNG", async ({ page }) => {
    const p = await at(page, 1, 1);
    await page.mouse.click(p.x, p.y);
    await page.keyboard.press("m");
    await drag(page, await at(page, 0, 0), await at(page, 2, 2));
    await page.keyboard.press("Control+c");

    // The PNG is written asynchronously, so poll until it's there.
    const readClipboardImage = () =>
      page.evaluate(async () => {
        const item = (await navigator.clipboard.read()).find((i) => i.types.includes("image/png"));
        if (!item) return null;
        const bitmap = await createImageBitmap(await item.getType("image/png"));
        const ctx = new OffscreenCanvas(bitmap.width, bitmap.height).getContext("2d")!;
        ctx.drawImage(bitmap, 0, 0);
        return {
          size: [bitmap.width, bitmap.height],
          centreAlpha: ctx.getImageData(1, 1, 1, 1).data[3],
          cornerAlpha: ctx.getImageData(0, 0, 1, 1).data[3],
        };
      });
    await expect
      .poll(readClipboardImage)
      .toEqual({ size: [3, 3], centreAlpha: 255, cornerAlpha: 0 });
  });

  test("pastes an image copied in another app as a new selection", async ({ page }) => {
    // A 2×1 PNG (red, green) delivered by a paste event, as from another app.
    await page.evaluate(async () => {
      const canvas = new OffscreenCanvas(2, 1);
      const ctx = canvas.getContext("2d")!;
      ctx.fillStyle = "#ff0000";
      ctx.fillRect(0, 0, 1, 1);
      ctx.fillStyle = "#00ff00";
      ctx.fillRect(1, 0, 1, 1);
      const blob = await canvas.convertToBlob({ type: "image/png" });
      const data = new DataTransfer();
      data.items.add(new File([blob], "copied.png", { type: "image/png" }));
      document.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true }));
    });
    await expect.poll(() => pixel(page, 0, 0)).toBe(0xff0000ff >>> 0);
    expect(await pixel(page, 1, 0)).toBe(0xff00ff00 >>> 0);
    const rect = await page.evaluate(
      () => (window.foundry as unknown as { selection: { rect: unknown } }).selection.rect
    );
    expect(rect).toEqual({ x: 0, y: 0, width: 2, height: 1 });

    await page.keyboard.press("Control+z");
    await expect.poll(() => pixel(page, 0, 0)).toBe(0);
  });
});

test("the magic wand selects connected colour; Delete clears only that; Shift adds, Alt subtracts", async ({
  page,
}) => {
  // A 2×1 block at (1,1)-(2,1) and a lone pixel of the same colour at (5,5).
  await drag(page, await at(page, 1, 1), await at(page, 2, 1));
  const lone = await at(page, 5, 5);
  await page.mouse.click(lone.x, lone.y);

  await page.keyboard.press("w");
  const block = await at(page, 1, 1);
  await page.mouse.click(block.x, block.y);
  await page.keyboard.press("Delete");
  await expect.poll(() => pixel(page, 1, 1)).toBe(0);
  expect(await pixel(page, 2, 1)).toBe(0);
  expect(await pixel(page, 5, 5)).not.toBe(0); // not connected: untouched

  const selectionRect = () =>
    page.evaluate(
      () => (window.foundry as unknown as { selection: { rect: unknown } }).selection.rect
    );

  // Ctrl+click: the colour everywhere on the layer.
  await page.keyboard.press("Control+z");
  await page.keyboard.down("Control");
  await page.mouse.click(block.x, block.y);
  await page.keyboard.up("Control");
  expect(await selectionRect()).toEqual({ x: 1, y: 1, width: 5, height: 5 });

  // Plain click on the block, then Shift adds the lone pixel and Alt takes it away again
  // (Alt doesn't switch to the eyedropper while a selection tool is active).
  await page.mouse.click(block.x, block.y);
  expect(await selectionRect()).toEqual({ x: 1, y: 1, width: 2, height: 1 });
  await page.keyboard.down("Shift");
  await page.mouse.click(lone.x, lone.y);
  await page.keyboard.up("Shift");
  expect(await selectionRect()).toEqual({ x: 1, y: 1, width: 5, height: 5 });
  await page.keyboard.down("Alt");
  await page.mouse.click(lone.x, lone.y);
  await page.keyboard.up("Alt");
  expect(await selectionRect()).toEqual({ x: 1, y: 1, width: 2, height: 1 });
});

test("the lasso selects a freehand shape; cut and paste keep its shape", async ({ page }) => {
  // Fill a 6×6 square, then lasso a triangle inside it.
  await page.keyboard.press("r");
  await page.keyboard.down("Shift"); // filled rectangle
  await drag(page, await at(page, 0, 0), await at(page, 5, 5));
  await page.keyboard.up("Shift");
  await expect.poll(() => pixel(page, 5, 5)).not.toBe(0);

  await page.keyboard.press("q");
  const corner = await at(page, 0, 0);
  await page.mouse.move(corner.x, corner.y);
  await page.mouse.down();
  for (const [x, y] of [
    [4, 0],
    [0, 4],
    [0, 0],
  ] as const) {
    const p = await at(page, x, y);
    await page.mouse.move(p.x, p.y, { steps: 6 });
  }
  await page.mouse.up();

  await page.keyboard.press("Control+x");
  // Inside the triangle cleared, outside it kept.
  await expect.poll(() => pixel(page, 1, 1)).toBe(0);
  expect(await pixel(page, 5, 5)).not.toBe(0);
  expect(await pixel(page, 4, 4)).not.toBe(0);
});

test.describe("export downloads (item 16)", () => {
  type File = { name: string; bytes: Buffer };

  /** Runs the export dialog with `setup` and returns every file it downloaded. */
  async function runExport(
    page: Page,
    tab: "Image" | "Spritesheet" | "GIF",
    setup: () => Promise<void>,
    expected: number
  ): Promise<File[]> {
    const files: Promise<File>[] = [];
    const listener = (download: Download) =>
      files.push(
        download.path().then(async (path) => {
          const { readFile } = await import("node:fs/promises");
          return { name: download.suggestedFilename(), bytes: await readFile(path) };
        })
      );
    page.on("download", listener);
    await page.keyboard.press("Control+e");
    const dialog = page.locator("#exportDialog");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("tab", { name: tab }).click();
    await setup();
    await dialog.locator("#exRun").click();
    await expect.poll(() => files.length).toBe(expected);
    page.off("download", listener);
    await expect(dialog).toBeHidden();
    return Promise.all(files);
  }

  const startsWith = (bytes: Buffer, ...sig: number[]) => sig.every((b, i) => bytes[i] === b);
  const ascii = (bytes: Buffer, from: number, to: number) =>
    bytes.subarray(from, to).toString("latin1");

  test.beforeEach(async ({ page }) => {
    // Something to export on two frames.
    const p = await at(page, 3, 3);
    await page.mouse.click(p.x, p.y);
    await page.locator('[data-frame-action="add"]').click();
    await page.mouse.click(p.x + 20, p.y);
  });

  test("image formats: PNG, WebP, JPEG, BMP and all frames as ZIP", async ({ page }) => {
    const format = async (value: string) => {
      await page.locator("#exFormat").selectOption(value);
    };

    const [png] = await runExport(page, "Image", () => format("png"), 1);
    expect(png.name).toMatch(/\.png$/);
    expect(startsWith(png.bytes, 0x89, 0x50, 0x4e, 0x47)).toBe(true);

    const [webp] = await runExport(page, "Image", () => format("webp"), 1);
    expect(webp.name).toMatch(/\.webp$/);
    expect(ascii(webp.bytes, 0, 4) + ascii(webp.bytes, 8, 12)).toBe("RIFFWEBP");

    const [lossy] = await runExport(page, "Image", () => format("webp-lossy"), 1);
    expect(ascii(lossy.bytes, 8, 12)).toBe("WEBP");

    const [jpeg] = await runExport(page, "Image", () => format("jpeg"), 1);
    expect(jpeg.name).toMatch(/\.jpe?g$/);
    expect(startsWith(jpeg.bytes, 0xff, 0xd8, 0xff)).toBe(true);

    const [bmp] = await runExport(page, "Image", () => format("bmp"), 1);
    expect(bmp.name).toMatch(/\.bmp$/);
    expect(ascii(bmp.bytes, 0, 2)).toBe("BM");

    const [zip] = await runExport(
      page,
      "Image",
      async () => {
        await format("png");
        await page.locator("#exFrames").selectOption("all");
      },
      1
    );
    expect(zip.name).toMatch(/\.zip$/);
    expect(startsWith(zip.bytes, 0x50, 0x4b, 0x03, 0x04)).toBe(true);
  });

  test("spritesheet as one ZIP, as separate files, and image only", async ({ page }) => {
    const [zip] = await runExport(
      page,
      "Spritesheet",
      () =>
        page
          .locator("#exOutput")
          .selectOption("zip")
          .then(() => {}),
      1
    );
    expect(zip.name).toMatch(/\.zip$/);
    expect(startsWith(zip.bytes, 0x50, 0x4b, 0x03, 0x04)).toBe(true);

    const separate = await runExport(
      page,
      "Spritesheet",
      () =>
        page
          .locator("#exOutput")
          .selectOption("files")
          .then(() => {}),
      2
    );
    const png = separate.find((f) => f.name.endsWith(".png"))!;
    const json = separate.find((f) => f.name.endsWith(".json"))!;
    expect(startsWith(png.bytes, 0x89, 0x50, 0x4e, 0x47)).toBe(true);
    const data = JSON.parse(json.bytes.toString("utf8")) as {
      frames: object;
      meta: { size: { w: number } };
    };
    expect(Object.keys(data.frames)).toHaveLength(2);
    expect(data.meta.size.w).toBeGreaterThan(0);

    const imageOnly = await runExport(
      page,
      "Spritesheet",
      async () => {
        await page.locator("#exData").selectOption("none");
        await page.locator("#exOutput").selectOption("files");
      },
      1
    );
    expect(imageOnly[0].name).toMatch(/\.png$/);

    // Engine formats come from @gs2d/formats, e.g. Godot SpriteFrames.
    const godot = await runExport(
      page,
      "Spritesheet",
      async () => {
        await page.locator("#exData").selectOption("godot-tres");
        await page.locator("#exOutput").selectOption("files");
      },
      2
    );
    const tres = godot.find((f) => f.name.endsWith(".tres"))!;
    expect(tres.bytes.toString("utf8")).toContain('[gd_resource type="SpriteFrames"');
  });

  test("animated GIF", async ({ page }) => {
    const [gif] = await runExport(page, "GIF", async () => {}, 1);
    expect(gif.name).toMatch(/\.gif$/);
    expect(ascii(gif.bytes, 0, 6)).toBe("GIF89a");
  });
});

test("Ctrl+S while typing the name commits it and saves", async ({ page }) => {
  await page.locator("#spriteName").fill("renamed");
  await page.keyboard.press("Control+s");
  await expect(page.locator("#fileDisplay")).toHaveText("browser library");
  await expect(page).toHaveTitle(/^renamed/);
});

test("a sprite the installed app is launched with opens without the start screen", async ({
  page,
}) => {
  await expectLaunchedFileOpens(page, "other.gs2dsprite");
});

test("opening a file again and saving updates its copy in the browser", async ({ page }) => {
  await expectOneCopyPerFile(page);
});

test("a first-run tour shows the app, and the Help menu brings it back", async ({ page }) => {
  await expectFirstRunTour(page);
});
