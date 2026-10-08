// changeJiraStories.ts — Finds the Jira stories an existing change names, and reads them for the risk check (GH #415).
//
// A new change is built from Jira stories the owner selects, and the AI prompts read those stories in full. An
// existing change opened in Modify has no selected stories — but its text names them ("Deploys ENCUC-77…"). Without
// the stories the risk check asked the owner for facts the stories already state, so the keys the change names are
// read back from Jira with the same fields the Enhance prompt uses.

import { jiraGet } from '../../../services/jiraApi.ts';
import type { JiraIssue } from '../../../types/jira.ts';
import { CRG_ISSUE_FIELD_LIST } from '../hooks/useCrgState.ts';

/** The most stories one change is read for — enough for any release, and a cap so a long change cannot flood Jira. */
export const MAX_CHANGE_STORY_KEYS = 25;

// A Jira key: an upper-case project key, a hyphen and a number. ServiceNow numbers (CHG0012345) have no hyphen.
const JIRA_KEY_PATTERN = /\b[A-Z][A-Z0-9]{1,9}-\d+\b/g;

/** Every Jira key the change's text names, once each, in the order they first appear. */
export function findJiraKeysInChangeText(changeTexts: readonly string[]): string[] {
  const foundKeys = new Set<string>();
  for (const changeText of changeTexts) {
    for (const keyMatch of changeText.matchAll(JIRA_KEY_PATTERN)) {
      foundKeys.add(keyMatch[0]);
    }
  }
  return [...foundKeys].slice(0, MAX_CHANGE_STORY_KEYS);
}

/**
 * Reads each named story from Jira. A key Jira cannot find — a look-alike such as "SHA-256", or a story the owner
 * cannot see — is skipped rather than failing the rest, so the check still gets every story that can be read.
 */
export async function fetchChangeJiraStories(issueKeys: readonly string[]): Promise<JiraIssue[]> {
  const readResults = await Promise.allSettled(issueKeys.map((issueKey) =>
    jiraGet<JiraIssue>(`/rest/api/2/issue/${encodeURIComponent(issueKey)}?fields=${CRG_ISSUE_FIELD_LIST}`)));
  return readResults.flatMap((readResult) => (readResult.status === 'fulfilled' ? [readResult.value] : []));
}
