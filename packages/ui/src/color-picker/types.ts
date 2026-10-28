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

export type ColorChangedEventShape = {
  hex: string;
  r: number;
  g: number;
  b: number;
  alpha: number;
  displayString: string;
};

export const ColorPickerEvents = {
  ColorChanged: "color-changed",
} as const;

export type ColorPickerEventPayloads = {
  [ColorPickerEvents.ColorChanged]: ColorChangedEventShape;
};

export type ColorPickerEventName = (typeof ColorPickerEvents)[keyof typeof ColorPickerEvents];
export type ColorPickerEventPayload<T extends ColorPickerEventName> = ColorPickerEventPayloads[T];

export type ColorPickerEventMap<T extends ColorPickerEventName = ColorPickerEventName> =
  HTMLElementEventMap & {
    [EventName in T]: CustomEvent<ColorPickerEventPayload<EventName>>;
  };
