// Unit tests for the secret redactor used before webhook delivery.

'use strict';

const { redactString, redactDeep, REDACTION_MARKER } = require('./secretRedactor');

describe('secretRedactor.redactString', () => {
  test('redacts a Bearer token', () => {
    const result = redactString('Authorization: Bearer abc.def.ghijklmnop');
    expect(result.value).toContain('Bearer ' + REDACTION_MARKER);
    expect(result.value).not.toContain('abc.def.ghijklmnop');
    expect(result.redactionCount).toBe(1);
  });

  test('redacts a password= assignment but keeps the label', () => {
    const result = redactString('login with password=hunter2longvalue please');
    expect(result.value).toContain('password=' + REDACTION_MARKER);
    expect(result.value).not.toContain('hunter2longvalue');
    expect(result.redactionCount).toBe(1);
  });

  test('redacts basic-auth credentials embedded in a URL', () => {
    const result = redactString('clone https://user:s3cretpass@github.com/x.git');
    expect(result.value).toContain('https://user:' + REDACTION_MARKER + '@');
    expect(result.value).not.toContain('s3cretpass');
    expect(result.redactionCount).toBe(1);
  });

  test('redacts an Atlassian ATATT token', () => {
    const result = redactString('token is ATATT3xFfGF0abcDEF12345 done');
    expect(result.value).toContain(REDACTION_MARKER);
    expect(result.value).not.toContain('ATATT3xFfGF0abcDEF12345');
    expect(result.redactionCount).toBe(1);
  });

  test('leaves ordinary report text untouched', () => {
    const text = 'DENP-1234 status changed to Done by Jane Smith';
    const result = redactString(text);
    expect(result.value).toBe(text);
    expect(result.redactionCount).toBe(0);
  });

  test('returns non-strings unchanged', () => {
    expect(redactString(null)).toEqual({ value: null, redactionCount: 0 });
    expect(redactString('')).toEqual({ value: '', redactionCount: 0 });
  });
});

describe('secretRedactor.redactDeep', () => {
  test('redacts string values nested in objects and arrays and sums the count', () => {
    const input = {
      title: 'Sprint report',
      notes: ['all good', 'secret=topsecretvalue here'],
      meta: { auth: 'Bearer zzzzzzzzzzzzzzzz' },
      count: 7,
    };
    const result = redactDeep(input);
    expect(result.redactionCount).toBe(2);
    expect(result.value.notes[1]).toContain('secret=' + REDACTION_MARKER);
    expect(result.value.meta.auth).toContain('Bearer ' + REDACTION_MARKER);
    expect(result.value.title).toBe('Sprint report');
    expect(result.value.count).toBe(7);
  });

  test('reports zero redactions for clean content', () => {
    const result = redactDeep({ a: 'hello', b: ['world'] });
    expect(result.redactionCount).toBe(0);
  });
});
