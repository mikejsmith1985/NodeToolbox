// jiraBrowseUrl.ts — Builds a link to a Jira issue's browse page from the configured base URL.
//
// Opening the real Jira issue (rather than the in-app proxy) lets users do things
// the inline panel can't — most importantly, @-mention other people in a reply.

const JIRA_BROWSE_PATH = '/browse/';

/**
 * Returns the URL of a Jira issue's browse page.
 *
 * @param issueKey - The Jira issue key, e.g. "TBX-101".
 * @param jiraBaseUrl - The configured Jira base URL; when empty, a relative
 *   "/browse/KEY" path is returned so the link is still well-formed.
 */
export function buildJiraBrowseUrl(issueKey: string, jiraBaseUrl: string): string {
  const issuePath = `${JIRA_BROWSE_PATH}${encodeURIComponent(issueKey)}`;
  const trimmedBaseUrl = (jiraBaseUrl ?? '').trim();
  if (!trimmedBaseUrl) {
    return issuePath;
  }
  return `${trimmedBaseUrl.replace(/\/+$/, '')}${issuePath}`;
}
