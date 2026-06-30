// browseUrl.ts — Derives the human "open in Jira" link for a created issue from the REST self URL.
// Pure. The create response's `self` is like https://host/rest/api/2/issue/10000; the browse
// link is https://host/browse/KEY. Falls back to a relative path if self can't be parsed.

export function buildBrowseUrl(selfUrl: string, issueKey: string): string {
  try {
    return `${new URL(selfUrl).origin}/browse/${issueKey}`;
  } catch {
    return `/browse/${issueKey}`;
  }
}
