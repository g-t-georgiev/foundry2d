/**
 * Takes the manual's screenshots (`docs/images/`) from the running site:
 * start it (`vp run dev`), then run `vpx scripts/screenshots.ts`
 * (`GS2D_SITE` points it elsewhere). The tools are driven in a fresh browser
 * profile, so your own work never shows up; each saves its work, which the
 * hub's picture then shows.
 */
import { Buffer } from "node:buffer";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { chromium, type Page } from "@playwright/test";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "docs/images");
const SITE = process.env.GS2D_SITE ?? "http://localhost:3000/";
const viewport = { width: 1400, height: 860 };

interface Camera {
  worldToLocal(x: number, y: number): { x: number; y: number };
}
declare global {
  interface Window {
    foundry?: { workspace: { camera: Camera } };
  }
}

/** Screen position of a world point on the canvas. */
async function at(page: Page, canvas: string, x: number, y: number) {
  const local = await page.evaluate(
    ([x, y]) => window.foundry!.workspace.camera.worldToLocal(x, y),
    [x, y]
  );
  const box = (await page.locator(canvas).boundingBox())!;
  return { x: box.x + local.x, y: box.y + local.y };
}

async function drag(page: Page, canvas: string, from: number[], to: number[], shift = false) {
  const a = await at(page, canvas, from[0], from[1]);
  const b = await at(page, canvas, to[0], to[1]);
  if (shift) await page.keyboard.down("Shift");
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 6 });
  await page.mouse.up();
  if (shift) await page.keyboard.up("Shift");
}

async function setColor(page: Page, hex: string) {
  // What the colour picker sends when a colour is chosen in it.
  await page.evaluate((hex) => {
    const picker = document.querySelector("#colorPicker")!;
    picker.dispatchEvent(new CustomEvent("color-changed", { detail: { hex } }));
  }, hex);
}

async function pixelEditor(page: Page): Promise<Buffer> {
  await page.goto(`${SITE}pixel/`);
  await page.waitForFunction(() => window.foundry !== undefined);
  const canvas = "#paintCanvas";
  await page.locator("#spriteName").fill("slime");
  await page.locator("#spriteName").press("Enter");
  // Give the keyboard back to the shortcuts.
  await page.locator("#spriteName").blur();
  const frame = async (squash: number) => {
    await setColor(page, "#4ade80");
    await page.keyboard.press("c");
    await drag(page, canvas, [6.5, 12.5 + squash], [25.5, 27.5], true);
    await setColor(page, "#166534");
    await page.keyboard.press("b");
    for (const [x, y] of [
      [12, 18 + squash],
      [19, 18 + squash],
    ]) {
      await drag(page, canvas, [x + 0.5, y + 0.5], [x + 0.5, y + 2.5]);
    }
    await setColor(page, "#bbf7d0");
    await drag(page, canvas, [10.5, 15.5 + squash], [12.5, 15.5 + squash]);
  };
  await frame(0);
  await page.keyboard.press("Shift+N");
  await frame(3);
  await page.locator("#onionSkin").check();
  await page.keyboard.press("f");
  await page.waitForTimeout(400);
  return page.screenshot();
}

async function levelDesigner(page: Page): Promise<Buffer> {
  await page.goto(`${SITE}levels/`);
  await page.waitForFunction(() => window.foundry !== undefined);
  await page.keyboard.press("Control+o");
  await page
    .locator("project-browser")
    .getByRole("button", { name: /Platformer/ })
    .click();
  await page.waitForTimeout(800);
  await page.keyboard.press("f");
  await page.waitForTimeout(500);
  return page.screenshot();
}

async function spritePacker(page: Page): Promise<Buffer> {
  await page.goto(`${SITE}packer/`);
  await page.waitForFunction(() => window.foundry !== undefined);
  const files = await page.evaluate(() => {
    const image = (w: number, h: number, draw: (c: CanvasRenderingContext2D) => void) => {
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      draw(canvas.getContext("2d")!);
      return canvas.toDataURL("image/png").split(",")[1];
    };
    const list: { name: string; data: string }[] = [];
    for (let i = 1; i <= 6; i++) {
      list.push({
        name: `hero/walk_${i}.png`,
        data: image(24, 32, (c) => {
          c.fillStyle = "#60a5fa";
          c.fillRect(6, 4 + (i % 2), 12, 14);
          c.fillStyle = "#1e3a8a";
          c.fillRect(6 + (i % 3), 18, 4, 12);
          c.fillRect(14 - (i % 3), 18, 4, 12);
          c.fillStyle = "#fde68a";
          c.fillRect(8, 0, 8, 6);
        }),
      });
    }
    for (let i = 1; i <= 4; i++) {
      list.push({
        name: `items/coin_${i}.png`,
        data: image(16, 16, (c) => {
          c.fillStyle = "#facc15";
          c.beginPath();
          c.ellipse(8, 8, 7 - i * 1.5, 7, 0, 0, Math.PI * 2);
          c.fill();
        }),
      });
    }
    const colors = ["#f87171", "#a78bfa", "#34d399", "#fb923c", "#f472b6"];
    colors.forEach((color, i) =>
      list.push({
        name: `enemies/blob_${String.fromCharCode(97 + i)}.png`,
        data: image(20 + i * 6, 16 + i * 4, (c) => {
          c.fillStyle = color;
          c.beginPath();
          c.ellipse(10 + i * 3, 8 + i * 2, 10 + i * 3, 8 + i * 2, 0, 0, Math.PI * 2);
          c.fill();
        }),
      })
    );
    list.push({
      name: "ui/panel.png",
      data: image(64, 40, (c) => {
        c.fillStyle = "#334155";
        c.fillRect(0, 0, 64, 40);
        c.strokeStyle = "#94a3b8";
        c.strokeRect(2, 2, 60, 36);
      }),
    });
    return list;
  });
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "+ Images" }).click();
  await (
    await chooser
  ).setFiles(
    files.map((f) => ({
      name: f.name.replace(/\//g, "_"),
      mimeType: "image/png",
      buffer: Buffer.from(f.data, "base64"),
    }))
  );
  await page.waitForFunction(() => !(window.foundry as unknown as { packing: boolean }).packing);
  await page.locator("#projectName").fill("game");
  await page.locator("#projectName").press("Enter");
  await page.locator("#spriteList .sprite-item").first().click();
  await page.keyboard.press("f");
  await page.waitForTimeout(600);
  return page.screenshot();
}

/** The three side by side, for the README. */
async function combined(page: Page, shots: Buffer[]): Promise<Buffer> {
  const urls = shots.map((s) => `data:image/png;base64,${s.toString("base64")}`);
  const png = await page.evaluate(async (urls) => {
    const images = await Promise.all(
      urls.map(
        (url) =>
          new Promise<HTMLImageElement>((resolve) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.src = url;
          })
      )
    );
    const w = 700;
    const h = Math.round((images[0].height / images[0].width) * w);
    const gap = 16;
    const canvas = document.createElement("canvas");
    canvas.width = w * 3 + gap * 2;
    canvas.height = h;
    const ctx = canvas.getContext("2d")!;
    images.forEach((img, i) => ctx.drawImage(img, i * (w + gap), 0, w, h));
    return canvas.toDataURL("image/png").split(",")[1];
  }, urls);
  return Buffer.from(png, "base64");
}

/** The hub, with the work the tools saved. */
async function studio(page: Page): Promise<Buffer> {
  await page.goto(SITE);
  await page.waitForFunction(() => "studio" in window);
  await page.evaluate(async () => {
    await (window as unknown as { studio: { ready: Promise<unknown> } }).studio.ready;
  });
  await page.waitForTimeout(400);
  return page.screenshot();
}

const browser = await chromium.launch();
try {
  // One profile for all of them, so the hub sees what the tools saved.
  const context = await browser.newContext({ viewport, colorScheme: "dark" });
  // The first-run tours would cover the pages.
  await context.addInitScript(() => {
    for (const app of ["studio", "pixel", "levels", "packer"]) {
      localStorage.setItem(`gs2d.tours.${app}`, JSON.stringify(["intro"]));
    }
  });
  const page = await context.newPage();
  page.on("dialog", (d) => void d.accept());
  const shots: Buffer[] = [];
  mkdirSync(out, { recursive: true });
  for (const [name, take] of [
    ["pixel", pixelEditor],
    ["levels", levelDesigner],
    ["packer", spritePacker],
  ] as const) {
    const shot = await take(page);
    shots.push(shot);
    writeFileSync(join(out, `${name}.png`), shot);
    console.log(`wrote docs/images/${name}.png`);
    // Kept in the browser, for the hub's picture.
    await page.keyboard.press("Control+s");
    await page.waitForTimeout(600);
  }
  writeFileSync(join(out, "studio.png"), await studio(page));
  console.log("wrote docs/images/studio.png");
  writeFileSync(join(out, "apps.png"), await combined(page, shots));
  console.log("wrote docs/images/apps.png");
} finally {
  await browser.close();
}
