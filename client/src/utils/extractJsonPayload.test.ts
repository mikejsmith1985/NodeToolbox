// extractJsonPayload.test.ts — Verifies the shared assistant-reply JSON extractor.

import { describe, expect, it } from 'vitest';

import { extractJsonPayload } from './extractJsonPayload.ts';

describe('extractJsonPayload', () => {
  it('returns the object untouched when the reply is already bare JSON', () => {
    expect(extractJsonPayload('{"a":1}')).toBe('{"a":1}');
  });

  it('strips markdown fences and surrounding prose', () => {
    const reply = 'Sure thing:\n```json\n{"a":1,"b":2}\n```\nLet me know!';
    expect(JSON.parse(extractJsonPayload(reply))).toEqual({ a: 1, b: 2 });
  });

  it('narrows to the outermost braces when prose contains stray characters', () => {
    expect(extractJsonPayload('prefix {"x":true} suffix')).toBe('{"x":true}');
  });

  it('throws a descriptive error when no JSON object is present', () => {
    expect(() => extractJsonPayload('no braces here')).toThrow(/No JSON object/);
  });
});
