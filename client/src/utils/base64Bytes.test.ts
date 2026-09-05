// base64Bytes.test.ts — Bytes to base64 text, exactly, at any size.

import { describe, expect, it } from 'vitest';

import { encodeBytesToBase64 } from './base64Bytes.ts';

describe('encodeBytesToBase64', () => {
  it('encodes a short byte run the way the platform would', () => {
    const bytes = new TextEncoder().encode('test evidence');

    expect(encodeBytesToBase64(bytes)).toBe(btoa('test evidence'));
  });

  it('encodes an empty run as empty text', () => {
    expect(encodeBytesToBase64(new Uint8Array(0))).toBe('');
  });

  it('encodes every byte value, including those btoa alone cannot take from a string', () => {
    const allByteValues = new Uint8Array(256).map((_unused, byteIndex) => byteIndex);

    const encoded = encodeBytesToBase64(allByteValues);

    const decoded = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
    expect(Array.from(decoded)).toEqual(Array.from(allByteValues));
  });

  it('survives a run far longer than one call-stack of arguments', () => {
    // String.fromCharCode.apply over a whole file blows the stack around ~100k arguments; a zip of
    // screenshots is far bigger than that.
    const largeRun = new Uint8Array(300_000).map((_unused, byteIndex) => byteIndex % 251);

    const encoded = encodeBytesToBase64(largeRun);

    const decoded = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
    expect(decoded.length).toBe(largeRun.length);
    expect(decoded[299_999]).toBe(largeRun[299_999]);
  });
});
