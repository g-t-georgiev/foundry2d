/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Where the apps are, for the manual's "Open in app" links. */
  readonly VITE_PIXEL_URL?: string;
  readonly VITE_LEVELS_URL?: string;
  readonly VITE_PACKER_URL?: string;
}
