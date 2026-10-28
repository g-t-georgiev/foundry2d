export class PixelUtils {
  /** Converts "#ffee00" or "#ffee00ff" to a 32-bit Uint32Array integer (0xAABBGGRR) */
  static hexToUint32(hex: string): number {
    const clean = hex.replace("#", "");
    const r = parseInt(clean.substring(0, 2), 16) || 0;
    const g = parseInt(clean.substring(2, 4), 16) || 0;
    const b = parseInt(clean.substring(4, 6), 16) || 0;
    const a = clean.length === 8 ? parseInt(clean.substring(6, 8), 16) : 255;
    return ((a << 24) | (b << 16) | (g << 8) | r) >>> 0;
  }

  /** Converts a 32-bit Uint32Array integer (0xAABBGGRR) back to "#rrggbb" */
  static uint32ToHex(val: number): string {
    const r = (val & 0xff).toString(16).padStart(2, "0");
    const g = ((val >> 8) & 0xff).toString(16).padStart(2, "0");
    const b = ((val >> 16) & 0xff).toString(16).padStart(2, "0");
    return `#${r}${g}${b}`;
  }
}
