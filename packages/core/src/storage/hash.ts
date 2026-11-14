/** SHA-256 of `bytes` as lowercase hex (Web Crypto; available in browsers and Node 18+). */
export async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Decodes a base64 `data:` URL into its MIME type and bytes. */
export function dataUrlToBytes(dataUrl: string): { type: string; bytes: Uint8Array } {
  const match = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(dataUrl);
  if (!match) throw new Error("Not a data URL");
  const [, type, base64, payload] = match;
  if (!base64) return { type, bytes: new TextEncoder().encode(decodeURIComponent(payload)) };
  const binary = atob(payload);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return { type, bytes };
}

/** Encodes bytes as a base64 `data:` URL. */
export function bytesToDataUrl(bytes: Uint8Array, type: string): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return `data:${type};base64,${btoa(binary)}`;
}
