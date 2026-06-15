// src/utils/secretRedactor.js — Removes credential-looking values from a report
// payload before it leaves the machine.
//
// Defense-in-depth: report content is Jira text and should rarely contain
// secrets, but a stray token or password in a description must never be forwarded
// to a cloud webhook. Over-redaction is safe; under-redaction leaks — so the
// patterns lean conservative and the caller is told how many values were redacted
// so it can notify the user.

'use strict';

/** Marker substituted in place of any detected secret value. */
const REDACTION_MARKER = '«redacted»';

// Each rule matches a credential-shaped substring. Capture groups before the
// secret are preserved so surrounding context (e.g. "password=") stays readable.
const REDACTION_RULES = [
  // "Bearer <token>" / "Authorization: Bearer <token>"
  { pattern: /\b(bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi, replace: '$1' + REDACTION_MARKER },
  // key/value secrets: password= pwd= secret= token= apikey= api_key= (= or :)
  {
    pattern: /\b(pass(?:word)?|pwd|secret|token|api[_-]?key)(\s*[=:]\s*)(["']?)[^\s"',;]{4,}\3/gi,
    replace: '$1$2$3' + REDACTION_MARKER + '$3',
  },
  // basic-auth credentials embedded in a URL: https://user:pass@host
  { pattern: /(\bhttps?:\/\/[^\s:/@]+:)[^\s:/@]+(@)/gi, replace: '$1' + REDACTION_MARKER + '$2' },
  // Atlassian API tokens and similar long opaque ATATT… tokens
  { pattern: /\bATATT[A-Za-z0-9._~+/=-]{8,}/g, replace: REDACTION_MARKER },
];

/**
 * Redacts secret-looking substrings in a single string.
 *
 * @param {string} text - Text that may contain credentials.
 * @returns {{ value: string, redactionCount: number }} Cleaned text + count.
 */
function redactString(text) {
  if (typeof text !== 'string' || text.length === 0) {
    return { value: text, redactionCount: 0 };
  }
  let output = text;
  let redactionCount = 0;
  for (const rule of REDACTION_RULES) {
    const matches = output.match(rule.pattern);
    if (matches) {
      redactionCount += matches.length;
      output = output.replace(rule.pattern, rule.replace);
    }
  }
  return { value: output, redactionCount };
}

/**
 * Recursively redacts every string value inside a payload (string, array, or
 * object), summing how many values were redacted across the whole structure.
 *
 * @param {*} input - Any JSON-serialisable value.
 * @returns {{ value: *, redactionCount: number }} Cleaned value + total count.
 */
function redactDeep(input) {
  let redactionCount = 0;

  function walk(node) {
    if (typeof node === 'string') {
      const redacted = redactString(node);
      redactionCount += redacted.redactionCount;
      return redacted.value;
    }
    if (Array.isArray(node)) {
      return node.map(walk);
    }
    if (node && typeof node === 'object') {
      const cleaned = {};
      for (const [key, value] of Object.entries(node)) {
        cleaned[key] = walk(value);
      }
      return cleaned;
    }
    return node;
  }

  const value = walk(input);
  return { value, redactionCount };
}

module.exports = { redactString, redactDeep, REDACTION_MARKER };
