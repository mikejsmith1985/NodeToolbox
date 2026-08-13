// operatorSignature.test.js — Confirms the operator marker is applied exactly once and recognised
// only as a standalone trailing token, so a signed comment never reads as a typo and an ordinary
// comment is never mistaken for a signed one.

'use strict';

const {
  OPERATOR_SIGNATURE,
  appendOperatorSignature,
  hasOperatorSignature,
} = require('../../src/services/operatorSignature');

describe('appendOperatorSignature', () => {
  test('appends the marker to a plain comment', () => {
    expect(appendOperatorSignature('Work is complete.')).toBe('Work is complete. ' + OPERATOR_SIGNATURE);
  });

  test('is idempotent — an already-signed comment is returned unchanged', () => {
    const signedOnce = appendOperatorSignature('Work is complete.');
    expect(appendOperatorSignature(signedOnce)).toBe(signedOnce);
  });

  test('does not leave trailing whitespace before the marker', () => {
    expect(appendOperatorSignature('Done.   ')).toBe('Done. ' + OPERATOR_SIGNATURE);
  });

  test('an empty comment becomes the marker alone rather than a leading space', () => {
    expect(appendOperatorSignature('')).toBe(OPERATOR_SIGNATURE);
    expect(appendOperatorSignature(null)).toBe(OPERATOR_SIGNATURE);
  });

  test('signs a multi-line comment at the end', () => {
    expect(appendOperatorSignature('Line one\nLine two')).toBe('Line one\nLine two ' + OPERATOR_SIGNATURE);
  });
});

describe('hasOperatorSignature', () => {
  test('recognises the marker as a trailing token', () => {
    expect(hasOperatorSignature('Ready for testing. -ms')).toBe(true);
    expect(hasOperatorSignature('Ready for testing.\n-ms')).toBe(true);
  });

  test('tolerates trailing whitespace after the marker', () => {
    expect(hasOperatorSignature('Ready. -ms  ')).toBe(true);
  });

  test('does not match a word that merely ends in those letters', () => {
    expect(hasOperatorSignature('This affects 40ms')).toBe(false);
    expect(hasOperatorSignature('Latency dropped to 12-ms')).toBe(false);
  });

  test('does not match the marker mid-comment', () => {
    expect(hasOperatorSignature('-ms was mentioned earlier in this note')).toBe(false);
  });

  test('an unsigned or non-string comment reads as unsigned', () => {
    expect(hasOperatorSignature('Just a normal comment.')).toBe(false);
    expect(hasOperatorSignature(undefined)).toBe(false);
  });
});
