// extractJsonPayload.ts — Pulls the JSON object out of an assistant reply that may be wrapped in prose.
//
// The passphrase-gated AI round-trips across the app (canvas suggestions, aging triage, personal-flow
// coaching) all copy a prompt out and paste a reply back. Assistants often wrap their JSON in a
// sentence or ```json fences, so before parsing we narrow the text to the outermost { … } object. This
// is the single shared implementation so every ingestion path treats a fenced or chatty reply the same.

/**
 * Strips markdown code fences and surrounding prose, returning the substring from the first "{" to the
 * last "}" so a reply wrapped in commentary still parses. Throws a descriptive error when no JSON object
 * is present, so callers can surface a clear "couldn't read the response" message.
 */
export function extractJsonPayload(responseText: string): string {
  const withoutFences = responseText.replace(/```(?:json)?/gi, '');
  const firstBrace = withoutFences.indexOf('{');
  const lastBrace = withoutFences.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || lastBrace < firstBrace) {
    throw new Error('No JSON object found in the assistant response.');
  }
  return withoutFences.slice(firstBrace, lastBrace + 1);
}
