// extractJsonPayload.test.ts — Verifies the shared assistant-reply JSON extractor.

import { describe, expect, it } from 'vitest';

import { extractJsonPayload, repairJsonPayload } from './extractJsonPayload.ts';

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

  it('auto-repairs an unescaped quote inside a string so it parses (the GH #220 failure)', () => {
    // The assistant wrote a description containing a stray " it forgot to escape.
    const reply = '{"kind":"featureRewriteBatch","items":[{"key":"ABC-1","description":"Add the "refund" flow","acceptanceCriteria":"done"}]}';
    const parsed = JSON.parse(extractJsonPayload(reply));
    expect(parsed.items[0].description).toBe('Add the "refund" flow');
    expect(parsed.items[0].key).toBe('ABC-1');
  });

  it('auto-repairs raw newlines/tabs inside a string', () => {
    const reply = '{"description":"line one\nline two\ttabbed"}';
    expect(JSON.parse(extractJsonPayload(reply)).description).toBe('line one\nline two\ttabbed');
  });

  it('auto-repairs a trailing comma before a closing brace/bracket', () => {
    expect(JSON.parse(extractJsonPayload('{"items":[1,2,],}'))).toEqual({ items: [1, 2] });
  });
});

describe('repairJsonPayload', () => {
  it('is a strict no-op on already-valid JSON (never corrupts a good reply)', () => {
    const valid = '{"a":1,"b":"he said \\"hi\\"","c":[true,null]}';
    expect(repairJsonPayload(valid)).toBe(valid);
    expect(JSON.parse(repairJsonPayload(valid))).toEqual(JSON.parse(valid));
  });

  it('keeps a legitimately-escaped quote escaped', () => {
    const value = '{"q":"already \\"escaped\\""}';
    expect(JSON.parse(repairJsonPayload(value)).q).toBe('already "escaped"');
  });
});
