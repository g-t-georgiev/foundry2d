/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Where the apps are, for the manual's "Open in app" links. */
  readonly VITE_PIXEL_EDITOR_URL?: string;
  readonly VITE_LEVEL_DESIGNER_URL?: string;
  readonly VITE_SPRITE_PACKER_URL?: string;
}
