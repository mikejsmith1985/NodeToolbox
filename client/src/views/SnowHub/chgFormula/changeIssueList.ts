// changeIssueList.ts — Adds one Jira issue to an existing change's text, touching nothing else.
//
// A change's Jira scope lives only in its description: one "- [KEY] summary" line per issue under a fixed heading,
// written when the change was built. CAB prep, test evidence and the risk check all read the keys back from that
// text. Adding one late story used to mean editing the description by hand (easy to get the format wrong) or
// "Start Over", which rebuilds every field. This adds the one line where the list already is, and counts the issue
// in the "N issue(s)" phrases the builder wrote, so the change reads as if it had been built with it.

/** The heading the change builder writes above a change's issue list. */
export const ISSUE_LIST_HEADING = 'The following Jira issues are included in this release:';

/** The change text an added issue can touch. */
export interface ChangeIssueText {
  description: string;
  justification: string;
  riskImpactAnalysis: string;
}

/** What adding an issue produced: the new text, and whether the change already named that issue. */
export interface AddIssueResult {
  fields: ChangeIssueText;
  wasAlreadyListed: boolean;
}

// A Jira key as typed: a project key, a hyphen and a number.
const ISSUE_KEY_PATTERN = /^[A-Z][A-Z0-9]{1,9}-\d+$/;
// One line of the builder's issue list: "- [KEY] summary".
const ISSUE_LIST_LINE_PATTERN = /^\s*-\s*\[[A-Z][A-Z0-9]{1,9}-\d+\]/;
// The issue count the builder writes into the justification and risk text: "2 issue(s)".
const ISSUE_COUNT_PATTERN = /\b(\d+) issue\(s\)/g;

/** A typed key, upper-cased and trimmed, or null when it is not a Jira key. */
export function normaliseIssueKey(typedKey: string): string | null {
  const issueKey = typedKey.trim().toUpperCase();
  return ISSUE_KEY_PATTERN.test(issueKey) ? issueKey : null;
}

/** True when the text already names the key as a whole word — "ENCUC-7" is not found inside "ENCUC-77". */
function isKeyNamed(text: string, issueKey: string): boolean {
  return new RegExp(`(^|[^A-Z0-9-])${issueKey}(?![0-9])`).test(text);
}

/** The description with the issue's line after the last line of its issue list, or a new list when it has none. */
function addIssueLine(description: string, issueLine: string): string {
  const descriptionLines = description.split('\n');
  const lastListLineIndex = descriptionLines.reduce(
    (lastIndex, line, lineIndex) => (ISSUE_LIST_LINE_PATTERN.test(line) ? lineIndex : lastIndex),
    -1,
  );
  if (lastListLineIndex === -1) {
    const existingText = description.trimEnd();
    return `${existingText}${existingText === '' ? '' : '\n\n'}${ISSUE_LIST_HEADING}\n\n${issueLine}`;
  }
  descriptionLines.splice(lastListLineIndex + 1, 0, issueLine);
  return descriptionLines.join('\n');
}

/** The text with every "N issue(s)" counted up by one. */
function countOneMoreIssue(text: string): string {
  return text.replace(ISSUE_COUNT_PATTERN, (_wholeMatch, issueCount: string) => `${Number(issueCount) + 1} issue(s)`);
}

/**
 * The change text with one more Jira issue in it: a "- [KEY] summary" line in the description's issue list and
 * the issue counted in the builder's "N issue(s)" phrases. A change that already names the key is left unchanged.
 */
export function addIssueToChangeText(changeText: ChangeIssueText, issue: { key: string; summary: string }): AddIssueResult {
  const isAlreadyNamed = Object.values(changeText).some((fieldText) => isKeyNamed(fieldText, issue.key));
  if (isAlreadyNamed) {
    return { fields: changeText, wasAlreadyListed: true };
  }
  return {
    wasAlreadyListed: false,
    fields: {
      description: countOneMoreIssue(addIssueLine(changeText.description, `- [${issue.key}] ${issue.summary.trim()}`)),
      justification: countOneMoreIssue(changeText.justification),
      riskImpactAnalysis: countOneMoreIssue(changeText.riskImpactAnalysis),
    },
  };
}
