/**
 * Palette files:
 * - `.hex` (Lospec): one `RRGGBB` per line, `#` optional.
 * - `.gpl` (GIMP, also read by Aseprite and Krita): header lines, then
 *   `R G B<tab>name` rows with decimal channels.
 */

export class PaletteFormatError extends Error {
  override name = "PaletteFormatError";
}

const toHex2 = (n: number) => Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0");

/** Lowercase `#rrggbb`, or null for anything else. */
export function normalizeColor(value: string): string | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(value.trim());
  return m ? `#${m[1].toLowerCase()}` : null;
}

export function parseHexPalette(text: string): string[] {
  const colors: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(";") || trimmed.startsWith("//")) continue;
    const color = normalizeColor(trimmed.split(/\s+/)[0]);
    if (!color) throw new PaletteFormatError(`Not a hex colour: "${trimmed}"`);
    colors.push(color);
  }
  return colors;
}

export function parseGplPalette(text: string): string[] {
  const lines = text.split(/\r?\n/);
  if (!lines[0]?.trim().startsWith("GIMP Palette")) {
    throw new PaletteFormatError('Missing "GIMP Palette" header.');
  }
  const colors: string[] = [];
  for (const line of lines.slice(1)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || /^(Name|Columns):/i.test(trimmed)) continue;
    const parts = trimmed.split(/\s+/);
    const [r, g, b] = parts.slice(0, 3).map(Number);
    if ([r, g, b].some((n) => !Number.isInteger(n) || n < 0 || n > 255)) {
      throw new PaletteFormatError(`Bad colour row: "${trimmed}"`);
    }
    colors.push(`#${toHex2(r)}${toHex2(g)}${toHex2(b)}`);
  }
  return colors;
}

/** Picks the parser from the file name, falling back to sniffing the content. */
export function parsePaletteFile(fileName: string, text: string): string[] {
  const isGpl = /\.gpl$/i.test(fileName) || text.trimStart().startsWith("GIMP Palette");
  const colors = isGpl ? parseGplPalette(text) : parseHexPalette(text);
  if (colors.length === 0) throw new PaletteFormatError("The palette is empty.");
  // Keep the first occurrence of each colour.
  return [...new Set(colors)];
}

export function toHexPalette(colors: readonly string[]): string {
  return colors.map((c) => c.replace("#", "").toUpperCase()).join("\n") + "\n";
}

export function toGplPalette(colors: readonly string[], name: string): string {
  const rows = colors.map((c) => {
    const n = parseInt(c.slice(1), 16);
    const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    return `${String(r).padStart(3)} ${String(g).padStart(3)} ${String(b).padStart(3)}\t${c.slice(1).toUpperCase()}`;
  });
  return ["GIMP Palette", `Name: ${name}`, `Columns: 8`, "#", ...rows].join("\n") + "\n";
}
