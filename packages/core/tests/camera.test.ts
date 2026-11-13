import { describe, it, expect } from "vite-plus/test";
import { Camera, PixelUtils } from "../src";

describe("Camera", () => {
  it("maps between local, world and grid space", () => {
    const camera = new Camera({ cellSize: { width: 8, height: 8 } });
    camera.x = 100;
    camera.y = 50;
    camera.zoom = 2;
    const world = camera.localToWorld(132, 66);
    expect(world).toEqual({ x: 16, y: 8 });
    expect(camera.worldToGrid(world.x, world.y)).toEqual({ x: 2, y: 1 });
    expect(camera.worldToLocal(16, 8)).toEqual({ x: 132, y: 66 });
  });

  it("keeps the world point under the cursor fixed while zooming", () => {
    const camera = new Camera();
    camera.x = 10;
    camera.y = 20;
    camera.zoom = 4;
    const before = camera.localToWorld(200, 150);
    camera.zoomAt(200, 150, 2.5);
    const after = camera.localToWorld(200, 150);
    expect(camera.zoom).toBe(10);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it("clamps zoom to the configured range", () => {
    const camera = new Camera({ maxZoom: 8 });
    camera.zoom = 4;
    camera.zoomAt(0, 0, 10);
    expect(camera.zoom).toBe(8);
  });

  it("fits bounds centered in the area right of/below the UI inset", () => {
    const camera = new Camera({ uiPadding: 20, viewportPadding: 10 });
    camera.fitToBounds(220, 120, { x: 0, y: 0, width: 16, height: 16 });
    // Available: 220-20-20 = 180, 120-20-20 = 80 -> zoom 5
    expect(camera.zoom).toBe(5);
    const center = camera.getCenter(220, 120);
    expect(center.x).toBeCloseTo(8);
    expect(center.y).toBeCloseTo(8);
  });

  it("clamp keeps content partly visible after a far pan", () => {
    const camera = new Camera({ uiPadding: 0 });
    camera.zoom = 1;
    camera.x = -10_000;
    camera.clamp(100, 100, { x: 0, y: 0, width: 50, height: 50 });
    // Right edge of the content must remain on screen.
    expect(camera.x + 50).toBeGreaterThan(0);
  });

  it("interpolates states", () => {
    const mid = Camera.lerpState({ x: 0, y: 0, zoom: 1 }, { x: 10, y: 20, zoom: 4 }, 0.5);
    expect(mid).toEqual({ x: 5, y: 10, zoom: 2 });
  });
});

describe("PixelUtils", () => {
  it("round-trips hex colors through packed ABGR", () => {
    const packed = PixelUtils.hexToUint32("#ff8000");
    expect(packed).toBe(0xff0080ff);
    expect(PixelUtils.uint32ToHex(packed)).toBe("#ff8000");
    expect(PixelUtils.uint32ToHex(PixelUtils.hexToUint32("#11223344"), true)).toBe("#11223344");
    expect(PixelUtils.hexToUint32("#f00")).toBe(0xff0000ff);
  });
});
