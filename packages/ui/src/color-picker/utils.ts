import { ColorFormat, type ParsedColor, type SupportedColorFormat } from "./types";

const CSS_COLOR_REGEX =
  /^(?:#([0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})|rgba?\(\s*(?:\d{1,3}%?|\d+(?:\.\d+)?)\s*,\s*(?:\d{1,3}%?|\d+(?:\.\d+)?)\s*,\s*(?:\d{1,3}%?|\d+(?:\.\d+)?)\s*(?:,\s*(?:0|1|0?\.\d+|[0-9]{1,3}%)\s*)?\)|rgba?\(\s*(?:\d{1,3}%?|\d+(?:\.\d+)?)\s+(?:\d{1,3}%?|\d+(?:\.\d+)?)\s+(?:\d{1,3}%?|\d+(?:\.\d+)?)\s*(?:\/\s*(?:0|1|0?\.\d+|[0-9]{1,3}%)\s*)?\)|hsla?\(\s*(?:\d+(?:\.\d+)?(?:deg|rad|turn)?)\s*,\s*\d{1,3}%\s*,\s*\d{1,3}%\s*(?:,\s*(?:0|1|0?\.\d+|[0-9]{1,3}%)\s*)?\)|hsla?\(\s*(?:\d+(?:\.\d+)?(?:deg|rad|turn)?)\s+\d{1,3}%\s+\d{1,3}%\s*(?:\/\s*(?:0|1|0?\.\d+|[0-9]{1,3}%)\s*)?\))$/i;

const HEX_PARSE_REGEX = /^#([0-9a-f]{3,8})$/;
const FUNC_PARSE_REGEX =
  /^(rgb|hsl)a?\s*\(\s*([\d.%]+)(deg|rad|turn)?\s*[, ]\s*([\d.%]+)\s*[, ]\s*([\d.%]+)(?:\s*[/,]\s*([\d.%]+))?\s*\)$/;

export const SUPPORTED_COLOR_FORMATS: SupportedColorFormat[] = [
  ColorFormat.HEX,
  ColorFormat.RGB,
  ColorFormat.HSL,
] as const;

export class ColorUtils {
  static clamp(val: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, val));
  }

  static wrapHue(hue: number): number {
    return ((hue % 360) + 360) % 360;
  }

  static hsvToRgb(h: number, s: number, v: number): [number, number, number] {
    const f = (n: number, k = (n + h / 60) % 6) => v - v * s * Math.max(Math.min(k, 4 - k, 1), 0);
    return [Math.round(f(5) * 255), Math.round(f(3) * 255), Math.round(f(1) * 255)];
  }

  static rgbToHsv(r: number, g: number, b: number): [number, number, number] {
    r /= 255;
    g /= 255;
    b /= 255;
    const v = Math.max(r, g, b);
    const n = v - Math.min(r, g, b);
    const h =
      n === 0 ? 0 : n && v === r ? (g - b) / n : v === g ? 2 + (b - r) / n : 4 + (r - g) / n;
    return [60 * (h < 0 ? h + 6 : h), v && n / v, v];
  }

  static hslToHsv(h: number, s: number, l: number): [number, number, number] {
    s /= 100;
    l /= 100;
    const v = l + s * Math.min(l, 1 - l);
    const hsvS = v === 0 ? 0 : 2 * (1 - l / v);
    return [this.wrapHue(h), hsvS, v];
  }

  static rgbToHex(r: number, g: number, b: number, a: number = 1): string {
    const hex = [r, g, b].map((x) => x.toString(16).padStart(2, "0")).join("");
    const alpha =
      a < 1
        ? Math.round(a * 255)
            .toString(16)
            .padStart(2, "0")
        : "";
    return `#${hex}${alpha}`;
  }

  static rgbToHsl(r: number, g: number, b: number): [number, number, number] {
    r /= 255;
    g /= 255;
    b /= 255;
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const d = max - min;

    let h = 0;
    let s: number;

    if (max === min) {
      h = s = 0;
    } else {
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      if (max === r) {
        h = (g - b) / d + (g < b ? 6 : 0);
      } else if (max === g) {
        h = (b - r) / d + 2;
      } else if (max === b) {
        h = (r - g) / d + 4;
      }
      h /= 6;
    }

    return [Math.round(h * 360), s, l];
  }

  static hexToRgb(hex: string): [number, number, number, number] {
    hex = hex.replace("#", "");
    if (hex.length === 3) {
      hex = hex
        .split("")
        .map((c) => c + c)
        .join("");
    }
    const r = parseInt(hex.substring(0, 2), 16) || 0;
    const g = parseInt(hex.substring(2, 4), 16) || 0;
    const b = parseInt(hex.substring(4, 6), 16) || 0;
    const a = hex.length === 8 ? (parseInt(hex.substring(6, 8), 16) || 0) / 255 : 1;
    return [r, g, b, a];
  }

  static hexToHsv(matcher: RegExpMatchArray | null): ParsedColor | null {
    if (!matcher) return null;
    const hex = matcher[1];
    let r: number;
    let g: number;
    let b: number;
    let a = 1;

    if (hex.length === 3 || hex.length === 4) {
      r = parseInt(hex[0] + hex[0], 16);
      g = parseInt(hex[1] + hex[1], 16);
      b = parseInt(hex[2] + hex[2], 16);
      if (hex.length === 4) a = parseInt(hex[3] + hex[3], 16) / 255;
    } else if (hex.length === 6 || hex.length === 8) {
      r = parseInt(hex.substring(0, 2), 16);
      g = parseInt(hex.substring(2, 4), 16);
      b = parseInt(hex.substring(4, 6), 16);
      if (hex.length === 8) a = parseInt(hex.substring(6, 8), 16) / 255;
    } else {
      return null;
    }

    return {
      hsv: this.rgbToHsv(r, g, b),
      alpha: this.clamp(a, 0, 1),
      format: ColorFormat.HEX,
    };
  }

  static rgbMatchToHsv(match: RegExpMatchArray): ParsedColor {
    const [, , p1, , p2, p3, p4] = match;
    let alpha = 1;
    if (p4 !== undefined) {
      alpha = p4.endsWith("%") ? parseFloat(p4) / 100 : parseFloat(p4);
    }
    const parseRgbVal = (val: string) =>
      val.endsWith("%") ? (parseFloat(val) / 100) * 255 : parseFloat(val);
    const r = parseRgbVal(p1);
    const g = parseRgbVal(p2);
    const b = parseRgbVal(p3);

    return {
      hsv: this.rgbToHsv(r, g, b),
      alpha: this.clamp(alpha, 0, 1),
      format: ColorFormat.RGB,
    };
  }

  static hslMatchToHsv(match: RegExpMatchArray): ParsedColor {
    const [, , p1, unit, p2, p3, p4] = match;
    let alpha = 1;
    if (p4 !== undefined) {
      alpha = p4.endsWith("%") ? parseFloat(p4) / 100 : parseFloat(p4);
    }
    let h = parseFloat(p1);
    if (unit === "rad") h = h * (180 / Math.PI);
    if (unit === "turn") h = h * 360;

    const s = parseFloat(p2);
    const l = parseFloat(p3);

    return {
      hsv: this.hslToHsv(h, s, l),
      alpha: this.clamp(alpha, 0, 1),
      format: ColorFormat.HSL,
    };
  }

  /**
   * Tries parsing color string value by first checking the format
   * against a RegEx expression for the supported color formats.
   *
   * If color value type is invalid or format is not supported, the returned value is `null`.
   *
   * The support color string formats are hex(a), rgb(a), hsl(a).
   */
  static parseColor(colorStr: unknown): ParsedColor | null {
    if (typeof colorStr !== "string") return null;
    const str = colorStr.trim().toLowerCase();
    const hexMatch = str.match(HEX_PARSE_REGEX);
    if (hexMatch) return this.hexToHsv(hexMatch);

    const funcMatch = str.match(FUNC_PARSE_REGEX);
    if (funcMatch) {
      const type = funcMatch[1];
      if (type === "rgb") return this.rgbMatchToHsv(funcMatch);
      if (type === "hsl") return this.hslMatchToHsv(funcMatch);
    }
    return null;
  }

  static isValidColorString(value: unknown): value is string {
    if (typeof value !== "string") return false;
    return CSS_COLOR_REGEX.test(value.trim());
  }

  static getRgbString(r: number, g: number, b: number, a: number = 1) {
    a = Math.max(0, Math.min(a, 1));
    const alpha = a.toFixed(2);
    return a < 1 ? `rgba(${r}, ${g}, ${b}, ${alpha})` : (`rgb(${r}, ${g}, ${b})` as const);
  }

  static getHslString(h: number, s: number, l: number, a: number = 1) {
    s *= 100;
    l *= 100;
    a = Math.max(0, Math.min(a, 1));

    const alpha = a.toFixed(2);

    return a < 1
      ? `hsla(${h}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%, ${alpha})`
      : `hsl(${h}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`;
  }
}
