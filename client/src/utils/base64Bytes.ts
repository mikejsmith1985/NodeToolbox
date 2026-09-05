// base64Bytes.ts — Turning raw bytes into base64 text so they can ride inside a JSON envelope.
//
// The browser's own `btoa` only takes a string, and building that string with
// `String.fromCharCode.apply(null, wholeFile)` overflows the call stack on anything larger than a
// small image. So the bytes are walked in fixed slices — the same technique the SharePoint relay
// bookmarklet uses in the other direction.

/** How many bytes go through String.fromCharCode per call — well inside every engine's argument cap. */
const ENCODING_SLICE_BYTES = 8192;

/**
 * Encodes bytes as standard base64 (with padding), safe for any length.
 */
export function encodeBytesToBase64(bytes: Uint8Array): string {
  let binaryText = '';
  for (let sliceStart = 0; sliceStart < bytes.length; sliceStart += ENCODING_SLICE_BYTES) {
    const slice = bytes.subarray(sliceStart, sliceStart + ENCODING_SLICE_BYTES);
    binaryText += String.fromCharCode.apply(null, Array.from(slice));
  }
  return btoa(binaryText);
}
