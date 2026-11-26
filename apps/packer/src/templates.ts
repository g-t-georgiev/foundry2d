import type { ToolTemplate } from "@gs2d/workspace";
import type { PackSettings } from "./model/settings";

/** New packs set up for an engine (read by Packer and the studio's hub). */
export const TEMPLATES: readonly (ToolTemplate & { settings: Partial<PackSettings> })[] = [
  {
    id: "empty",
    label: "Empty pack",
    description: "TexturePacker JSON (Phaser, PixiJS), tight MaxRects packing.",
    settings: {},
  },
  {
    id: "godot",
    label: "Godot 4",
    description: "SpriteFrames resource next to the sheet.",
    settings: { dataFormat: "godot-tres" },
  },
  {
    id: "libgdx",
    label: "LibGDX",
    description: "TextureAtlas file, power-of-two sheets.",
    settings: { dataFormat: "libgdx-atlas", powerOfTwo: true },
  },
  {
    id: "css",
    label: "Web (CSS sprites)",
    description: "One class per sprite.",
    settings: { dataFormat: "css" },
  },
];
