// operatorSignature.js — Owns the short marker appended to Jira comments this server writes
// on the operator's behalf.
//
// Why this exists: the server authenticates to Jira as the operator, so a comment or transition it
// writes is indistinguishable in Jira's history from one the operator typed by hand. When something
// unexpected turns up on an issue, there is no way to tell "I did that" from "the scheduled job did
// that for me". The marker is a short, consistent suffix that makes the difference checkable later.
//
// It is deliberately terse and says nothing about what produced it: teammates reading the issue see
// a person's initials, not an announcement that a separate system is operating on their board.

'use strict';

/** The operator's initials, appended to any comment written on their behalf. */
const OPERATOR_SIGNATURE = '-ms';

// Matches the marker only as a standalone trailing token, so a comment that merely ends with a word
// containing those letters is never mistaken for a signed one.
const TRAILING_SIGNATURE_PATTERN = /(?:^|\s)-ms\s*$/;

/**
 * Appends the operator marker to a comment body, leaving an already-signed body untouched.
 *
 * Idempotency matters because more than one code path can build the same comment text, and a body
 * carrying the marker twice would look like a typo to anyone reading the issue.
 *
 * @param {string} commentText
 * @returns {string} The comment body with exactly one trailing marker.
 */
function appendOperatorSignature(commentText) {
  const normalizedText = String(commentText === null || commentText === undefined ? '' : commentText).trimEnd();
  if (normalizedText === '') {
    return OPERATOR_SIGNATURE;
  }
  if (hasOperatorSignature(normalizedText)) {
    return normalizedText;
  }
  return normalizedText + ' ' + OPERATOR_SIGNATURE;
}

/**
 * Reports whether a comment body already carries the operator marker as its trailing token.
 *
 * @param {string} commentText
 * @returns {boolean}
 */
function hasOperatorSignature(commentText) {
  if (typeof commentText !== 'string') {
    return false;
  }
  return TRAILING_SIGNATURE_PATTERN.test(commentText.trimEnd());
}

module.exports = {
  OPERATOR_SIGNATURE,
  appendOperatorSignature,
  hasOperatorSignature,
};
