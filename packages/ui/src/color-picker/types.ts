export enum ColorFormat {
  HEX = "hex",
  HEXA = "hexa",
  RGB = "rgb",
  RGBA = "rgba",
  HSL = "hsl",
  HSLA = "hsla",
}
export interface ParsedColor {
  hsv: [number, number, number]; // [0-360, 0-1, 0-1]
  alpha: number; // 0-1
  format: SupportedColorFormat;
}

export type SupportedColorFormat = ColorFormat.HEX | ColorFormat.RGB | ColorFormat.HSL;

export type onMoveCallback = (x: number, y: number) => void;

export type ColorChangeEventShape = {
  hex: string;
  r: number;
  g: number;
  b: number;
  alpha: number;
  displayString: string;
};
