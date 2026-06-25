// colorFunctionFallback.test.ts — Unit tests for rewriting modern CSS color functions to rgb().

import { describe, expect, it, vi } from 'vitest';

import {
  applyExportColorFallbacks,
  containsUnsupportedColorFunction,
  sanitizeColorValue,
} from './colorFunctionFallback.ts';

// A deterministic stand-in for the canvas resolver so the parsing logic is tested in isolation.
const FAKE_RESOLVED_COLOR = 'rgba(9, 9, 9, 1)';
const fakeResolveColorToken = (): string => FAKE_RESOLVED_COLOR;

describe('containsUnsupportedColorFunction', () => {
  it('detects modern color functions html2canvas cannot parse', () => {
    expect(containsUnsupportedColorFunction('color-mix(in srgb, red 10%, blue)')).toBe(true);
    expect(containsUnsupportedColorFunction('color(srgb 0.2 0.3 0.4)')).toBe(true);
    expect(containsUnsupportedColorFunction('oklch(0.7 0.1 200)')).toBe(true);
  });

  it('leaves values html2canvas already understands alone', () => {
    expect(containsUnsupportedColorFunction('rgb(88, 166, 255)')).toBe(false);
    expect(containsUnsupportedColorFunction('rgba(0, 0, 0, 0.5)')).toBe(false);
    expect(containsUnsupportedColorFunction('var(--color-accent)')).toBe(false);
    expect(containsUnsupportedColorFunction('#58a6ff')).toBe(false);
    // "discolor(" must not be mistaken for the color() function.
    expect(containsUnsupportedColorFunction('discolor(1)')).toBe(false);
  });
});

describe('sanitizeColorValue', () => {
  it('returns supported values unchanged without invoking the resolver', () => {
    const resolveSpy = vi.fn(fakeResolveColorToken);
    expect(sanitizeColorValue('rgb(88, 166, 255)', resolveSpy)).toBe('rgb(88, 166, 255)');
    expect(resolveSpy).not.toHaveBeenCalled();
  });

  it('replaces a standalone color-mix() value', () => {
    const result = sanitizeColorValue('color-mix(in srgb, rgb(88, 166, 255) 6%, rgb(20, 20, 20))', fakeResolveColorToken);
    expect(result).toBe(FAKE_RESOLVED_COLOR);
  });

  it('replaces a standalone color() value', () => {
    expect(sanitizeColorValue('color(srgb 0.2 0.3 0.4)', fakeResolveColorToken)).toBe(FAKE_RESOLVED_COLOR);
  });

  it('replaces only the color function inside a gradient, preserving structure and rgb stops', () => {
    const gradientValue = 'linear-gradient(180deg, color-mix(in srgb, rgb(1, 2, 3) 6%, rgb(4, 5, 6)) 0%, rgb(7, 8, 9) 100%)';
    const result = sanitizeColorValue(gradientValue, fakeResolveColorToken);
    expect(result).toBe(`linear-gradient(180deg, ${FAKE_RESOLVED_COLOR} 0%, rgb(7, 8, 9) 100%)`);
  });

  it('treats a nested color function as a single outer token (no double processing)', () => {
    const resolveSpy = vi.fn(fakeResolveColorToken);
    const nestedValue = 'color-mix(in srgb, color(srgb 0 0 0) 50%, rgb(255, 255, 255))';
    const result = sanitizeColorValue(nestedValue, resolveSpy);

    expect(result).toBe(FAKE_RESOLVED_COLOR);
    expect(resolveSpy).toHaveBeenCalledTimes(1);
    expect(resolveSpy).toHaveBeenCalledWith(nestedValue);
  });

  it('replaces multiple color functions within one value (e.g. a layered box-shadow)', () => {
    const resolveSpy = vi.fn(fakeResolveColorToken);
    const boxShadowValue = '0 0 4px color-mix(in srgb, red 12%, transparent), inset 0 0 2px color-mix(in srgb, blue 8%, transparent)';
    const result = sanitizeColorValue(boxShadowValue, resolveSpy);

    expect(result).toBe(`0 0 4px ${FAKE_RESOLVED_COLOR}, inset 0 0 2px ${FAKE_RESOLVED_COLOR}`);
    expect(resolveSpy).toHaveBeenCalledTimes(2);
  });
});

describe('applyExportColorFallbacks', () => {
  it('rewrites an element style that uses a color function and leaves clean siblings untouched', () => {
    const exportRoot = document.createElement('div');
    const tintedChild = document.createElement('span');
    const plainChild = document.createElement('span');

    // Inline styles are what jsdom reports through getComputedStyle in this test environment.
    tintedChild.style.backgroundColor = 'color-mix(in srgb, red 10%, blue)';
    plainChild.style.backgroundColor = 'rgb(7, 8, 9)';
    exportRoot.appendChild(tintedChild);
    exportRoot.appendChild(plainChild);
    document.body.appendChild(exportRoot);

    try {
      applyExportColorFallbacks(exportRoot, fakeResolveColorToken);
      // The unsupported function must be gone (jsdom may re-serialise the rgba string, so assert intent).
      expect(containsUnsupportedColorFunction(tintedChild.style.backgroundColor)).toBe(false);
      expect(tintedChild.style.backgroundColor).not.toBe('');
      expect(plainChild.style.backgroundColor).toBe('rgb(7, 8, 9)');
    } finally {
      exportRoot.remove();
    }
  });
});
