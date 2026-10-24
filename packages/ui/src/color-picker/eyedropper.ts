declare global {
  /** Defines the structure of the result returned by the EyeDropper open method */
  interface ColorSelectionResult {
    sRGBHex: string;
  }

  /** Defines the EyeDropper options if needed in the future */
  interface ColorSelectionOptions {
    signal?: AbortSignal;
  }

  // Adds the EyeDropper constructor to the global scope
  /** Declares the EyeDropper class constructor and instance method */
  var EyeDropper: {
    prototype: typeof EyeDropper;
    new (): typeof EyeDropper;
    open(options?: ColorSelectionOptions): Promise<ColorSelectionResult>;
  };

  // Extend the Window interface to recognize window.EyeDropper
  interface Window {
    EyeDropper?: typeof EyeDropper;
  }
}

// Makes this file a module so TypeScript can track its imports
export {};
