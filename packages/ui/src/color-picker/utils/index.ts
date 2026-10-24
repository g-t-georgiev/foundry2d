import { ColorFormat, type SupportedColorFormat } from "../types";
import ColorUtilsModuleExport from "./ColorUtils";

export const ColorUtils = ColorUtilsModuleExport;
export const SUPPORTED_COLOR_FORMATS: SupportedColorFormat[] = [
  ColorFormat.HEX,
  ColorFormat.RGB,
  ColorFormat.HSL,
] as const;
