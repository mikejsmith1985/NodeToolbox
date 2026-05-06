// textTransformUtils.test.ts — Unit tests for the pure text transformation utilities.

import { describe, expect, it } from 'vitest';

import {
  buildCaseVariants,
  convertToMarkdown,
  convertToPlainText,
  formatJson,
  transformBase64,
  transformUrl,
} from './textTransformUtils.ts';

describe('convertToMarkdown', () => {
  it('returns input unchanged when no HTML tags are present', () => {
    const plainText = 'Hello world, this is plain text.';
    expect(convertToMarkdown(plainText)).toBe(plainText);
  });

  it('converts <strong> to **bold**', () => {
    const result = convertToMarkdown('<strong>bold</strong>');
    expect(result).toContain('**bold**');
  });

  it('converts <h1> to # heading', () => {
    const result = convertToMarkdown('<h1>My Heading</h1>');
    expect(result).toContain('# My Heading');
  });
});

describe('convertToPlainText', () => {
  it('strips all HTML tags', () => {
    const result = convertToPlainText('<p>Hello <strong>world</strong></p>');
    expect(result).toContain('Hello world');
    expect(result).not.toContain('<');
    expect(result).not.toContain('>');
  });
});

describe('formatJson', () => {
  it('formats valid JSON with 2-space indent', () => {
    const { output, errorMessage } = formatJson('{"key":"value"}', 2);
    expect(errorMessage).toBeNull();
    expect(output).toBe(JSON.stringify({ key: 'value' }, null, 2));
  });

  it('formats valid JSON with 4-space indent', () => {
    const { output, errorMessage } = formatJson('{"key":"value"}', 4);
    expect(errorMessage).toBeNull();
    expect(output).toBe(JSON.stringify({ key: 'value' }, null, 4));
  });

  it('minifies valid JSON when indent is 0', () => {
    const { output, errorMessage } = formatJson('{"key":  "value"}', 0);
    expect(errorMessage).toBeNull();
    expect(output).toBe('{"key":"value"}');
  });

  it('returns errorMessage for invalid JSON', () => {
    const { output, errorMessage } = formatJson('{invalid json}', 2);
    expect(output).toBe('');
    expect(errorMessage).not.toBeNull();
  });
});

describe('buildCaseVariants', () => {
  it('returns 10 variants for a simple phrase', () => {
    const variants = buildCaseVariants('hello world');
    expect(variants).toHaveLength(10);
  });

  it('camelCase variant is correct', () => {
    const variants = buildCaseVariants('hello world');
    const camelCaseVariant = variants.find((variant) => variant.label === 'camelCase');
    expect(camelCaseVariant?.value).toBe('helloWorld');
  });

  it('snake_case variant is correct', () => {
    const variants = buildCaseVariants('hello world');
    const snakeCaseVariant = variants.find((variant) => variant.label === 'snake_case');
    expect(snakeCaseVariant?.value).toBe('hello_world');
  });

  it('kebab-case variant is correct', () => {
    const variants = buildCaseVariants('hello world');
    const kebabCaseVariant = variants.find((variant) => variant.label === 'kebab-case');
    expect(kebabCaseVariant?.value).toBe('hello-world');
  });
});

describe('transformUrl', () => {
  it('encodes a component string', () => {
    const { output, errorMessage } = transformUrl('hello world&foo=bar', 'encode', 'component');
    expect(errorMessage).toBeNull();
    expect(output).toBe(encodeURIComponent('hello world&foo=bar'));
  });

  it('decodes a component string', () => {
    const encoded = encodeURIComponent('hello world&foo=bar');
    const { output, errorMessage } = transformUrl(encoded, 'decode', 'component');
    expect(errorMessage).toBeNull();
    expect(output).toBe('hello world&foo=bar');
  });
});

describe('transformBase64', () => {
  it('encodes a plain string', () => {
    const { output, errorMessage } = transformBase64('hello', 'encode');
    expect(errorMessage).toBeNull();
    // btoa('hello') = 'aGVsbG8='
    expect(output).toBe(btoa('hello'));
  });

  it('decodes a valid base64 string', () => {
    const encoded = btoa('hello');
    const { output, errorMessage } = transformBase64(encoded, 'decode');
    expect(errorMessage).toBeNull();
    expect(output).toBe('hello');
  });

  it('returns errorMessage for invalid base64 decode input', () => {
    const { output, errorMessage } = transformBase64('!!!not-valid-base64!!!', 'decode');
    expect(output).toBe('');
    expect(errorMessage).not.toBeNull();
  });
});
