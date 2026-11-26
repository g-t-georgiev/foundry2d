import { describe, it, expect } from "vite-plus/test";
import { regionToRgba, rgbaToRegion } from "../src/editing/systemClipboard";

describe("system clipboard pixel conversion", () => {
  it("round-trips regions through RGBA bytes", () => {
    // 0xAABBGGRR words: opaque red, half-transparent green, empty.
    const region = { width: 3, height: 1, values: [0xff0000ff, 0x8000ff00, 0] };
    const rgba = regionToRgba(region);
    expect(Array.from(rgba)).toEqual([255, 0, 0, 255, 0, 255, 0, 128, 0, 0, 0, 0]);
    expect(rgbaToRegion(rgba, 3, 1)).toEqual(region);
  });

  it("turns fully transparent pixels into empty cells, whatever their colour", () => {
    const rgba = new Uint8ClampedArray([10, 20, 30, 0, 10, 20, 30, 1]);
    expect(rgbaToRegion(rgba, 2, 1).values).toEqual([0, 0x011e140a]);
  });
});
