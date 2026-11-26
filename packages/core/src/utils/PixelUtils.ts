/**
 * Colors are packed as 0xAABBGGRR so that on little-endian machines a
 * `Uint32Array` shares its memory layout with `ImageData` RGBA bytes.
 */
export class PixelUtils {
  static rgbaToUint32(r: number, g: number, b: number, a = 255): number {
    return (((a & 0xff) << 24) | ((b & 0xff) << 16) | ((g & 0xff) << 8) | (r & 0xff)) >>> 0;
  }

  static uint32ToRgba(val: number): { r: number; g: number; b: number; a: number } {
    return {
      r: val & 0xff,
      g: (val >>> 8) & 0xff,
      b: (val >>> 16) & 0xff,
      a: (val >>> 24) & 0xff,
    };
  }

  /** Converts "#rgb", "#rrggbb" or "#rrggbbaa" to 0xAABBGGRR. */
  static hexToUint32(hex: string): number {
    let clean = hex.replace("#", "");
    if (clean.length === 3 || clean.length === 4) {
      clean = clean
        .split("")
        .map((c) => c + c)
        .join("");
    }
    const r = parseInt(clean.substring(0, 2), 16) || 0;
    const g = parseInt(clean.substring(2, 4), 16) || 0;
    const b = parseInt(clean.substring(4, 6), 16) || 0;
    const a = clean.length === 8 ? parseInt(clean.substring(6, 8), 16) : 255;
    return PixelUtils.rgbaToUint32(r, g, b, a);
  }

  /** Converts 0xAABBGGRR to "#rrggbb", or "#rrggbbaa" when `withAlpha` is set. */
  static uint32ToHex(val: number, withAlpha = false): string {
    const { r, g, b, a } = PixelUtils.uint32ToRgba(val);
    const hex = (n: number) => n.toString(16).padStart(2, "0");
    return `#${hex(r)}${hex(g)}${hex(b)}${withAlpha ? hex(a) : ""}`;
  }

  /** CSS `rgba()` string, suitable for `fillStyle`. */
  static uint32ToCss(val: number): string {
    const { r, g, b, a } = PixelUtils.uint32ToRgba(val);
    return `rgba(${r}, ${g}, ${b}, ${+(a / 255).toFixed(3)})`;
  }
}

/** True when the host stores multi-byte numbers little-endian (every current browser). */
export const HOST_IS_LITTLE_ENDIAN = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;

/**
 * Pixel layers pack RGBA as `0xAABBGGRR` words and are read back as RGBA
 * bytes (bitmaps, exports, compositing), which only holds on little-endian
 * hosts. Call once at startup to fail loudly rather than show wrong colours.
 */
export function assertPixelByteOrder(): void {
  if (!HOST_IS_LITTLE_ENDIAN) {
    throw new Error(
      "Game Studio 2D needs a little-endian host: pixel data is stored as 0xAABBGGRR words and read as RGBA bytes."
    );
  }
}
