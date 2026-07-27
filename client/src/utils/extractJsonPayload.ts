// extractJsonPayload.ts — Pulls the JSON object out of an assistant reply that may be wrapped in prose,
// and best-effort REPAIRS the common ways an LLM's JSON is *almost* valid.
//
// The passphrase-gated AI round-trips across the app (bulk re-write, feature composition, component mapping,
// PI review/plan, canvas, aging triage, personal-flow coaching) all copy a prompt out and paste a reply
// back. Assistants usually wrap their JSON in a sentence or ```json fences (narrowed away here), but they
// also frequently emit JSON that a strict parser rejects for one of a few predictable reasons — an
// unescaped `"` inside a long description, a raw newline/tab inside a string, or a trailing comma. This
// module repairs those so the reply parses instead of failing with a cryptic "position 10827" error. The
// repair is STRING-AWARE and a strict no-op on already-valid JSON, so it can never corrupt a good reply.

/** JSON tokens that legitimately follow a closing string quote (after optional whitespace). */
const STRUCTURAL_AFTER_STRING = new Set([',', '}', ']', ':']);

/**
 * Repairs the three most common LLM JSON defects, string-aware:
 *  1. an **unescaped double-quote inside a string** — detected by looking past the quote: if the next
 *     non-whitespace character is not a structural token, the quote is content and is escaped;
 *  2. **raw control characters inside a string** (newline, tab, carriage return, other C0) — escaped;
 *  3. a **trailing comma** before a `}` or `]` — dropped.
 * On valid JSON none of these fire (every inner quote is already escaped, no raw control chars, no trailing
 * commas), so the input is returned byte-for-byte unchanged.
 */
export function repairJsonPayload(jsonText: string): string {
  let repaired = '';
  let isInString = false;
  let isEscaped = false;

  for (let index = 0; index < jsonText.length; index += 1) {
    const character = jsonText[index];

    if (!isInString) {
      if (character === '"') {
        isInString = true;
        repaired += character;
        continue;
      }
      if (character === ',') {
        // Drop a trailing comma sitting before a closing brace/bracket (skipping whitespace).
        let lookahead = index + 1;
        while (lookahead < jsonText.length && /\s/.test(jsonText[lookahead])) {
          lookahead += 1;
        }
        if (jsonText[lookahead] === '}' || jsonText[lookahead] === ']') {
          continue;
        }
      }
      repaired += character;
      continue;
    }

    // Inside a string.
    if (isEscaped) {
      repaired += character;
      isEscaped = false;
      continue;
    }
    if (character === '\\') {
      repaired += character;
      isEscaped = true;
      continue;
    }
    if (character === '"') {
      // A closing quote only if the next non-whitespace character is structural; otherwise it is an
      // unescaped content quote the assistant forgot to escape — escape it and stay in the string.
      let lookahead = index + 1;
      while (lookahead < jsonText.length && /\s/.test(jsonText[lookahead])) {
        lookahead += 1;
      }
      const nextCharacter = jsonText[lookahead];
      if (nextCharacter === undefined || STRUCTURAL_AFTER_STRING.has(nextCharacter)) {
        isInString = false;
        repaired += character;
      } else {
        repaired += '\\"';
      }
      continue;
    }
    // Escape a raw control character that a strict parser would reject inside a string.
    if (character === '\n') { repaired += '\\n'; continue; }
    if (character === '\r') { repaired += '\\r'; continue; }
    if (character === '\t') { repaired += '\\t'; continue; }
    const codePoint = character.charCodeAt(0);
    if (codePoint < 0x20) {
      repaired += `\\u${codePoint.toString(16).padStart(4, '0')}`;
      continue;
    }
    repaired += character;
  }

  return repaired;
}

/**
 * Strips markdown code fences and surrounding prose, returning the substring from the first "{" to the
 * last "}" — then applies a best-effort repair (see repairJsonPayload) so a reply that is *almost* valid
 * JSON parses instead of failing. Throws a descriptive error when no JSON object is present, so callers can
 * surface a clear "couldn't read the response" message.
 */
export function extractJsonPayload(responseText: string): string {
  const withoutFences = responseText.replace(/```(?:json)?/gi, '');
  const firstBrace = withoutFences.indexOf('{');
  const lastBrace = withoutFences.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) {
    throw new Error('No JSON object found in the assistant response.');
  }
  return repairJsonPayload(withoutFences.slice(firstBrace, lastBrace + 1));
}
