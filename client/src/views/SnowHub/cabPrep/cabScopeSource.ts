// cabScopeSource.ts — Deciding which Jira issues a CAB pack draws its context from.
//
// Nothing in ServiceNow links a change to its Jira work: the create flow gathers issues by fix
// version or JQL and writes their keys into the description, and that text is the only trace left
// on the record. So the keys are read back out of it — as a STARTING POINT, which the operator then
// edits.
//
// That editability is the point. A pack built from keys nobody could see or change is a pack whose
// scope you have to trust; one built from a list on screen is one you can correct before it matters.
//
// Deliberately NOT the Confluence page-title scanner: that one tolerates "DENP 842" with a space,
// because that is a habit of how people title pages. A change description is written prose, where a
// bare "PROJ 123" is far more likely to be a sentence than a key, so this one requires the hyphen.

/** A Jira key as it is written in prose: hyphenated, on a word boundary. */
const STRICT_JIRA_KEY_PATTERN = /\b([A-Z][A-Z0-9]{1,9}-\d{1,6})\b/g;

/**
 * Every Jira key mentioned in a block of text, in order, de-duplicated.
 *
 * Case-sensitive on the project prefix by design. Jira keys are upper-case, and matching
 * case-insensitively turns ordinary words followed by a number — "step-1", "phase-2" — into keys
 * that then fail to fetch and look like a broken scope.
 */
export function readJiraKeysFromText(sourceText: string): string[] {
  const foundKeys = new Set<string>();

  for (const match of String(sourceText ?? '').matchAll(STRICT_JIRA_KEY_PATTERN)) {
    foundKeys.add(match[1]);
  }

  return [...foundKeys];
}

/**
 * Every key mentioned anywhere on a loaded change.
 *
 * Reads the description AND the short description, because a small change sometimes names its only
 * issue in the title and nowhere else.
 */
export function readJiraKeysFromChange(shortDescription: string, description: string): string[] {
  return readJiraKeysFromText(`${shortDescription ?? ''}\n${description ?? ''}`);
}

/**
 * Reads the key list an operator typed or pasted.
 *
 * Accepts whatever separator came to hand — commas, spaces, newlines — because this field is filled
 * by pasting from Jira, a spreadsheet, or a chat message, and refusing a paste over its punctuation
 * is the kind of friction that sends somebody back to doing it by hand.
 *
 * Upper-cased so "encuc-1" matches the key Jira holds. Invalid entries are dropped rather than sent:
 * a malformed key fails the whole fetch in some Jira versions and takes the good ones with it.
 */
export function readTypedIssueKeys(typedText: string): string[] {
  const candidateKeys = String(typedText ?? '')
    .split(/[\s,;]+/)
    .map((candidate) => candidate.trim().toUpperCase())
    .filter((candidate) => candidate !== '');

  const validKeys = new Set<string>();
  candidateKeys.forEach((candidate) => {
    if (/^[A-Z][A-Z0-9]{1,9}-\d{1,6}$/.test(candidate)) {
      validKeys.add(candidate);
    }
  });

  return [...validKeys];
}

/** What a typed list contained that could not be used, so a silent drop is never silent. */
export function readRejectedIssueKeys(typedText: string): string[] {
  const acceptedKeys = new Set(readTypedIssueKeys(typedText));

  return String(typedText ?? '')
    .split(/[\s,;]+/)
    .map((candidate) => candidate.trim())
    .filter((candidate) => candidate !== '' && !acceptedKeys.has(candidate.toUpperCase()));
}
