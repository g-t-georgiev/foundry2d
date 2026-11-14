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
  state: { dirty: boolean };
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
export async function openApp(page: Page, path = "/"): Promise<void> {
  // Confirmations are accepted: tests reload and delete on purpose.
  // Prompts are accepted with their suggested value.
  page.on("dialog", (dialog) => void dialog.accept(dialog.defaultValue()));
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
